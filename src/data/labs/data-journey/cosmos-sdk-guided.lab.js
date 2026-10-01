// Data journey Lab 1 (Task 8): "Guided: Conversation History with the
// Cosmos DB SDK". Mirrors the structure of aks-journey/ai-guided.lab.js -
// a `task(...)` builder closing over shared predicates, Tasks grouped into
// display Stages, Solutions as `{ steps }` that the behavioral replay
// helper (tests/helpers/dataLab.js) and the real UI both drive through
// `applyRunAction`.
import { COSMOS_MANIFEST, COSMOS_SOLUTION_FILES, COSMOS_STARTER_FILES } from '../../templates/data-python/cosmos.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { writeCharge } from '../../../lib/data/cosmos-cost.js'
import { DEFAULT_INDEXING_POLICY } from '../../../lib/sandbox/cosmosdb-policies.js'
import {
  ASSISTANT_ACCOUNT, ASSISTANT_CLUSTER_ID, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_NAMESPACE, ASSISTANT_REGISTRY,
  cosmosEvidence, cosmosRequestScenario, cosmosTask,
} from './cosmos-helpers.js'
import { seedCosmosSdkGuided } from './cosmos-seeds.js'

// --- Lab 1's starter app.py: only save_message/get_session/recent_sessions_for_user
// (this Lab's Tasks) are left raising NotImplementedError; remember_answer/
// find_similar_questions (a later Lab's Tasks) are pre-filled from the
// solution so the shared manifest.editZones list still parses as a whole
// (ADR-0003 - parseDataApp lowers every editZone function, not just the
// ones a given Lab exercises). worker.py is unused by Lab 1, so it starts
// fully solved too (COSMOS_SOLUTION_FILES and COSMOS_STARTER_FILES already
// share its non-app.py/worker.py file text).
const starterCut = COSMOS_STARTER_FILES['app.py'].indexOf('def remember_answer')
const solutionTail = COSMOS_SOLUTION_FILES['app.py'].indexOf('def remember_answer')
const LAB1_APP_PY = COSMOS_STARTER_FILES['app.py'].slice(0, starterCut) + COSMOS_SOLUTION_FILES['app.py'].slice(solutionTail)
const initialFiles = { ...COSMOS_SOLUTION_FILES, 'app.py': LAB1_APP_PY }

const IMAGE_V2 = `${ASSISTANT_REGISTRY}.azurecr.io/assistant:v2`
const DEPLOYMENT_V2 = COSMOS_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:v2')

// --- Task-order note (self-review): the Stage table displays Tasks as
// provision -> code -> deploy -> verify (point-read, cross-partition) ->
// tune (indexing, ordered) -> consistency, but the `tasks` array below runs
// `indexing` right after `container`, before every other Task. Two reasons,
// both load-bearing:
// 1. `recent_sessions_for_user`'s solution query (ORDER BY c.userId ASC,
//    c.createdAt DESC - a 2-property ORDER BY) needs the composite index
//    `indexing` adds (cosmos-query.js's `runCosmosQuery`), so
//    `cross-partition`'s own scenario cannot return 200 before `indexing`
//    runs.
// 2. Every verification Task here shares one dependency key (`dataDependencies`
//    keys only on cluster/namespace/account/database, not the Task id), which
//    includes the `sessions` container's current indexing policy. Recording
//    `point-read`'s evidence and only then running `indexing` would
//    immediately stale that evidence (the policy its snapshot captured would
//    no longer match current state) - so `indexing` has to precede every
//    Task that records evidence under that shared key, not just `cross-partition`.
// Stages here are a display grouping only (as in ai-guided.lab.js), not
// `capstoneStages`, so this reordering changes nothing about how the Lab is
// presented - only the order a straight-through replay (or a learner
// working the Task list instead of the Stage table) completes Tasks in.
const SEED_READ = { id: 'message-1', sessionId: 'session-1', userId: 'user-1', role: 'user', text: 'How long are backups kept?', createdAt: '2026-01-01T09:00:00Z' }
const SEED_CROSS = { id: 'message-2', sessionId: 'session-2', userId: 'user-1', role: 'user', text: 'Where is the support contact?', createdAt: '2026-01-01T09:05:00Z' }
const SEED_ORDERED = { id: 'message-3', sessionId: 'session-3', userId: 'user-1', role: 'user', text: 'What is the retention window?', createdAt: '2026-01-01T09:10:00Z' }
const SEED_WRITE_THEN_READ = { id: 'message-4', sessionId: 'session-4', userId: 'user-2', role: 'user', text: 'Confirm read after write.', createdAt: '2026-01-01T09:15:00Z' }

const INDEXING_POLICY_JSON = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"},{"path":"/text/?"}],"compositeIndexes":[[{"path":"/userId","order":"ascending"},{"path":"/createdAt","order":"descending"}]]}'

const file = (path) => ({ kind: 'file', path, content: COSMOS_SOLUTION_FILES[path] })
const commands = (...lines) => lines.map((line) => ({ kind: 'command', line }))
const scenario = (scenarioId) => ({ kind: 'scenario', scenarioId })

const parsed = (context) => parsePythonProject(context.project.savedFiles, COSMOS_MANIFEST).appSpec
const findReturnCall = (ops = []) => {
  for (const op of ops) {
    if (op.op === 'return' && op.value?.kind === 'call-sdk') return op.value
    if (op.op === 'if') { const found = findReturnCall(op.then) ?? findReturnCall(op.else); if (found) return found }
    if (op.op === 'for') { const found = findReturnCall(op.body); if (found) return found }
  }
  return null
}

const codeCrudReady = (context) => {
  const spec = parsed(context)
  if (!spec) return false
  const save = findReturnCall(spec.data.functions.save_message?.body)
  const get = findReturnCall(spec.data.functions.get_session?.body)
  const recent = findReturnCall(spec.data.functions.recent_sessions_for_user?.body)
  return save?.call === 'cosmos.container.upsert_item' && save.receiver === 'sessions'
    && get?.call === 'cosmos.container.read_item' && get.receiver === 'sessions' && get.args?.partition_key !== undefined
    && recent?.call === 'cosmos.container.query_items' && recent.receiver === 'sessions' && recent.args?.parameters !== undefined
}

const deployed = (context) => {
  const state = context.runtime.kubernetes?.clusters?.[ASSISTANT_CLUSTER_ID]
  const artifactId = context.artifacts.publishedTags?.[IMAGE_V2]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const deployment = state?.resources?.[`Deployment/${ASSISTANT_NAMESPACE}/assistant-api`]
  const pods = getDeploymentPods(context.run ?? context, ASSISTANT_CLUSTER_ID, ASSISTANT_NAMESPACE, 'assistant-api')
  return codeCrudReady(context) && deployment?.spec?.template?.spec?.containers?.[0]?.image === IMAGE_V2
    && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, COSMOS_MANIFEST))
    && pods.length === 2 && pods.every((pod) => state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}

const cosmosAccount = (context) => (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === ASSISTANT_ACCOUNT && item.resourceGroup === ASSISTANT_GROUP)
const cosmosDatabase = (context) => cosmosAccount(context)?.databases?.find((item) => item.name === ASSISTANT_DATABASE)
const sessionsContainer = (context) => cosmosDatabase(context)?.containers?.find((item) => item.name === 'sessions')

const accountReady = (context) => cosmosAccount(context)?.defaultConsistencyLevel === 'Session'
const databaseReady = (context) => !!cosmosDatabase(context)
const containerReady = (context) => {
  const container = sessionsContainer(context)
  return !!container && container.partitionKeyPath === '/sessionId' && container.throughputMode === 'autoscale' && container.maxThroughput === 1000
}
const indexingReady = (context) => {
  const policy = sessionsContainer(context)?.indexingPolicy
  const excludesText = (policy?.excludedPaths ?? []).some((entry) => entry.path === '/text/?' || entry.path === '/text/*')
  const hasComposite = (policy?.compositeIndexes ?? []).some((entry) => entry.length === 2
    && entry.some((item) => item.path === '/userId' && item.order === 'ascending')
    && entry.some((item) => item.path === '/createdAt' && item.order === 'descending'))
  return excludesText && hasComposite
}

const pointReadReady = (context) => {
  if (!deployed(context)) return false
  const record = cosmosEvidence(context, 'point-read', 'get-session')
  const readCall = record?.measurements.calls?.find((call) => call.call === 'cosmos.container.read_item')
  return !!readCall && record.measurements.status === 200 && readCall.charge <= 2
}
const crossPartitionReady = (context) => {
  if (!deployed(context) || !indexingReady(context)) return false
  const record = cosmosEvidence(context, 'cross-partition', 'user-sessions')
  const queryCall = record?.measurements.calls?.find((call) => call.call === 'cosmos.container.query_items')
  return !!queryCall && record.measurements.status === 200 && (queryCall.stats?.partitionsTouched ?? 0) > 1
}
const orderedReady = (context) => {
  if (!indexingReady(context)) return false
  const record = cosmosEvidence(context, 'ordered', 'user-sessions-ordered')
  const writeCall = record?.measurements.calls?.find((call) => call.call === 'cosmos.container.upsert_item')
  if (!writeCall || record.measurements.status !== 200) return false
  // Simpler ruling (task-8-brief.md): compare the live write charge against
  // the default-policy charge for the same message shape, rather than
  // against the specific evidence recorded by `point-read`'s own run.
  const baseline = writeCharge(SEED_ORDERED, DEFAULT_INDEXING_POLICY)
  return writeCall.charge < baseline
}
const readYourWritesReady = (context) => {
  if (!deployed(context)) return false
  const record = cosmosEvidence(context, 'read-your-writes', 'write-then-read')
  return !!record && record.measurements.status === 200 && record.measurements.stale === false
}

export const cosmosSdkGuidedLab = {
  id: 'data-cosmos-sdk-guided', title: 'Guided: Conversation History with the Cosmos DB SDK',
  brief: 'Provision a Cosmos DB for NoSQL account for the Knowledge Assistant\'s conversation history, implement its SDK calls, deploy it, and verify RU cost, cross-partition fan-out, indexing and read-your-writes consistency with real requests.',
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 1, labMode: 'guided',
  skillAreaId: 'data', service: 'cosmos-db', status: 'available',
  manifestId: COSMOS_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  dataTarget: { resourceGroup: ASSISTANT_GROUP, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE },
  // Teaching approximation (ADR-0001): pretend `sessions` is spread over 4
  // physical partitions, so a cross-partition query's fan-out is visible
  // without needing to seed thousands of items to force a real split.
  dataScale: { physicalPartitions: 4, logicalScale: 1 },
  initialProjectFiles: initialFiles, solutionFiles: COSMOS_SOLUTION_FILES, initializeSimulation: seedCosmosSdkGuided,
  stages: [
    { id: 'provision', title: 'Provision the Cosmos account, database and container', taskIds: ['account', 'database', 'container'] },
    { id: 'code', title: 'Implement the conversation history SDK calls', taskIds: ['code-crud'] },
    { id: 'deploy', title: 'Build and deploy the assistant API', taskIds: ['deployed'] },
    { id: 'verify', title: 'Verify RU cost and cross-partition fan-out', taskIds: ['point-read', 'cross-partition'] },
    { id: 'tune', title: 'Tune indexing for write cost and ordering', taskIds: ['indexing', 'ordered'] },
    { id: 'consistency', title: 'Verify session consistency', taskIds: ['read-your-writes'] },
  ],
  scenarios: {
    'get-session': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_READ] },
      { route: 'GET /sessions/{id}', args: [SEED_READ.id, SEED_READ.sessionId] },
    ]),
    'user-sessions': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_CROSS] },
      { route: 'GET /users/{id}/sessions', args: [SEED_CROSS.userId] },
    ]),
    'user-sessions-ordered': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_ORDERED] },
      { route: 'GET /users/{id}/sessions', args: [SEED_ORDERED.userId] },
    ]),
    'write-then-read': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_WRITE_THEN_READ] },
      { route: 'GET /sessions/{id}', args: [SEED_WRITE_THEN_READ.id, SEED_WRITE_THEN_READ.sessionId] },
    ]),
  },
  tasks: [
    cosmosTask({
      id: 'account', stageId: 'provision',
      text: 'Create the Cosmos DB for NoSQL account cosmos-assistant in rg-assistant with Session consistency.',
      explanation: 'The assistant API and this Lab\'s client both assume Session consistency; the account\'s default sets the ceiling every client consistency level is checked against.',
      hints: ['An account is a separate resource from its databases and containers - it only carries the default consistency level and region.', 'Use `az cosmosdb create` with `--default-consistency-level Session` and a single `--locations regionName=... failoverPriority=0 isZoneRedundant=False`.'],
      examNote: 'Session is the default and most-used level: read-your-writes within a session token at lower cost than Strong.',
      check: accountReady,
      solution: { steps: commands(`az cosmosdb create --name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --default-consistency-level Session --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False`) },
    }),
    cosmosTask({
      id: 'database', stageId: 'provision',
      text: 'Create the SQL database assistant under cosmos-assistant.',
      explanation: 'The database is just a namespace for containers unless you provision shared throughput on it; this Lab provisions throughput per container instead.',
      hints: ['A SQL database is created inside an existing account with `az cosmosdb sql database create`.', 'Pass `--account-name` and `--resource-group`, matching the account from the previous Task.'],
      examNote: 'Throughput can be provisioned at database (shared) or container level.',
      check: databaseReady,
      solution: { steps: commands(`az cosmosdb sql database create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --name ${ASSISTANT_DATABASE}`) },
    }),
    cosmosTask({
      id: 'container', stageId: 'provision',
      text: 'Create the sessions container with partition key /sessionId and autoscale max throughput 1000 RU/s.',
      explanation: 'Every conversation turn is scoped to one sessionId, so partitioning on it keeps a session\'s messages together for the point reads and per-session queries this Lab verifies.',
      hints: ['The partition key is permanent once the container exists - choose the property every point read and the most common query already filters on.', 'Use `az cosmosdb sql container create` with `--partition-key-path /sessionId` and `--max-throughput 1000` (autoscale; do not pass `--throughput`).'],
      examNote: 'The partition key can\'t be changed after creation. Pick a high-cardinality key that matches the most common filter.',
      check: containerReady,
      solution: { steps: commands(`az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name sessions --partition-key-path /sessionId --max-throughput 1000`) },
    }),
    cosmosTask({
      id: 'indexing', stageId: 'tune',
      text: 'Update the sessions container\'s indexing policy to exclude /text and add a composite index on userId ascending, createdAt descending.',
      explanation: 'Message text is never filtered or sorted on, so indexing it only adds write cost; sorting by two properties needs a composite index Cosmos can serve the ORDER BY from.',
      hints: ['An indexing policy update is online and does not require recreating the container (unlike the partition key).', 'Use `az cosmosdb sql container update --idx` with an inline JSON policy that both excludes `/text/?` and adds the two-path `compositeIndexes` entry.'],
      examNote: 'Excluding unqueried paths lowers write RU; multi-property ORDER BY needs a composite index.',
      check: indexingReady,
      solution: { steps: commands(`az cosmosdb sql container update --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name sessions --idx '${INDEXING_POLICY_JSON}'`) },
    }),
    cosmosTask({
      id: 'code-crud', stageId: 'code',
      text: 'Implement save_message with upsert_item, get_session with read_item (id + partition key), and recent_sessions_for_user with a parameterized query_items.',
      explanation: 'These three functions are the only way the deployed API reaches the sessions container - server.py\'s routes dispatch straight into them.',
      hints: ['`save_message`/`get_session` are single Cosmos calls each; `recent_sessions_for_user` needs `enable_cross_partition_query=True` since it does not filter on /sessionId.', 'Bind the query text\'s `@userId` through `parameters=[{"name": "@userId", "value": user_id}]` rather than formatting it into the SQL string.'],
      examNote: 'Parameterized queries prevent injection and allow plan reuse.',
      check: codeCrudReady,
      solution: { steps: [file('app.py')] },
    }),
    cosmosTask({
      id: 'deployed', stageId: 'deploy',
      text: 'Build assistant:v2 from the completed source and deploy it to assistant-api.',
      explanation: 'The image acrassistant builds captures the saved app.py/clients.py/server.py/Dockerfile; the running assistant-api Deployment only picks it up once its Pods use the new tag.',
      hints: ['Build before editing the Deployment so the tag you reference already exists in the registry.', 'Use `az acr build --registry acrassistant --image assistant:v2 .`, retag `k8s/deployment.yaml`\'s image to `acrassistant.azurecr.io/assistant:v2`, then `kubectl apply -f k8s/deployment.yaml`.'],
      examNote: 'Building an image doesn\'t change the running app. Only a deployment does.',
      check: deployed,
      solution: { steps: [...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v2 .`), { kind: 'file', path: 'k8s/deployment.yaml', content: DEPLOYMENT_V2 }, ...commands('kubectl apply -f k8s/deployment.yaml')] },
    }),
    cosmosTask({
      id: 'point-read', stageId: 'verify',
      text: 'Verify a point read: save one message, then read it back by id and partition key, and confirm its charge is at most 2 RU.',
      explanation: 'get_session supplies both the item id and the partition key, so Cosmos can go straight to the right physical partition instead of scanning.',
      hints: ['Run the get-session scenario - it saves then reads the same message in one request.', 'A point read\'s charge is driven by item size (roughly 1 RU per KB), not by query complexity.'],
      examNote: 'A point read (id + partition key) is the cheapest operation: ~1 RU per 1 KB.',
      check: pointReadReady,
      solution: { steps: [scenario('get-session')] },
      verification: { scenarioId: 'get-session', scenarioVersion: 1 },
    }),
    cosmosTask({
      id: 'cross-partition', stageId: 'verify',
      text: 'Verify a cross-partition query: list a user\'s sessions across partitions and confirm it touches more than one physical partition.',
      explanation: 'recent_sessions_for_user filters on userId, not the /sessionId partition key, so Cosmos must fan the query out to every physical partition.',
      hints: ['Run the user-sessions scenario - it saves one message then lists that user\'s sessions.', 'A query with no partition-key filter always touches every physical partition, regardless of how many items actually match.'],
      examNote: 'A query without the partition key fans out to every physical partition, and cost grows with them.',
      check: crossPartitionReady,
      solution: { steps: [scenario('user-sessions')] },
      verification: { scenarioId: 'user-sessions', scenarioVersion: 1 },
    }),
    cosmosTask({
      id: 'ordered', stageId: 'tune',
      text: 'Verify the ordered query still succeeds after indexing, and that saving a message now costs fewer RU than before the text exclusion.',
      explanation: 'The same recent_sessions_for_user solution already orders by userId then createdAt; before this Task that two-property ORDER BY had no composite index to run against.',
      hints: ['Run the user-sessions-ordered scenario - it saves then re-queries, so you can compare the save\'s RU charge directly.', 'Excluding /text from indexing lowers every future write\'s RU charge, not just this one request\'s.'],
      examNote: 'Indexing policy is mutable and applied online; partition key and vector policy aren\'t.',
      check: orderedReady,
      solution: { steps: [scenario('user-sessions-ordered')] },
      verification: { scenarioId: 'user-sessions-ordered', scenarioVersion: 1 },
    }),
    cosmosTask({
      id: 'read-your-writes', stageId: 'consistency',
      text: 'Verify read-your-writes: save a message and read it back in the same request, and confirm the read was not stale.',
      explanation: 'clients.py already requests Session consistency; this Task proves what that guarantees empirically rather than by inspecting the client code.',
      hints: ['Run the write-then-read scenario - it saves then reads the same message in one request, like point-read, but the check here is about staleness, not cost.', 'Session consistency guarantees the writer\'s own next read sees that write; Eventual does not.'],
      examNote: 'Session consistency guarantees read-your-writes for the client holding the session token.',
      check: readYourWritesReady,
      solution: { steps: [scenario('write-then-read')] },
      verification: { scenarioId: 'write-then-read', scenarioVersion: 1 },
    }),
  ],
}

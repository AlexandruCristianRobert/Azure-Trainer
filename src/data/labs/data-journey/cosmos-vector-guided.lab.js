// Data journey Lab 2 (Task 9): "Guided: Similar questions and a change feed
// processor". Mirrors the structure of cosmos-sdk-guided.lab.js (Lab 1):
// a `cosmosTask(...)` builder closing over shared predicates, Tasks grouped
// into display Stages, Solutions as `{ steps }` the behavioral replay helper
// (tests/helpers/dataLab.js) and the real UI both drive through
// `applyRunAction`.
//
// Lab order (vectors -> feed) is a single safe completion path: enable the
// account's vector capability before creating the vector container (fixed
// at creation, per task-9-brief.md), implement+verify remember_answer/
// find_similar_questions before ever touching the change feed processor,
// then provision the lease checkpoint container, implement+deploy the
// worker, and finally verify its at-least-once/idempotent delivery. No
// later Task invalidates an earlier one's evidence - see cosmos-helpers.js's
// new `images:<deploymentName>` dependency field for why 'similar' and
// 'no-miss' each name only the one Deployment they actually depend on.
import { COSMOS_MANIFEST, COSMOS_SOLUTION_FILES, COSMOS_STARTER_FILES } from '../../templates/data-python/cosmos.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { DATA_FIXTURES } from '../../fixtures/data/knowledge.js'
import {
  ASSISTANT_ACCOUNT, ASSISTANT_CLUSTER_ID, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_NAMESPACE, ASSISTANT_REGISTRY,
  cosmosEvidence, cosmosRequestScenario, cosmosWorkerScenario, cosmosTask,
} from './cosmos-helpers.js'
import { seedCosmosVectorGuided } from './cosmos-seeds.js'

// Lab 2's own starter/solution cut is the mirror image of Lab 1's: the three
// conversation-history functions (Lab 1's own Tasks) are already solved from
// the start - the seed-deployed assistant-api Pod's build depends on them
// parsing, and they are simply not this Lab's concern - while
// remember_answer/find_similar_questions (app.py) and worker.py's three
// functions (save_lease/process_changes/apply_feedback) start as starters,
// per task-9-brief.md.
const starterCut = COSMOS_STARTER_FILES['app.py'].indexOf('def remember_answer')
const solutionTail = COSMOS_SOLUTION_FILES['app.py'].indexOf('def remember_answer')
const LAB2_APP_PY = COSMOS_SOLUTION_FILES['app.py'].slice(0, solutionTail) + COSMOS_STARTER_FILES['app.py'].slice(starterCut)
const initialFiles = { ...COSMOS_STARTER_FILES, 'app.py': LAB2_APP_PY }

const IMAGE_V3 = `${ASSISTANT_REGISTRY}.azurecr.io/assistant:v3`
const WORKER_DEPLOYMENT_V3 = COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v3')

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
// Finds every 'call-sdk' / 'call-local' / 'sdk-attribute' expression anywhere
// in a function body (recursing through if/for), for process_changes's
// looser shape check (several statements, not one direct return).
const collectExprCalls = (expr, matches) => {
  if (!expr || typeof expr !== 'object') return matches
  if (['call-sdk', 'call-local', 'sdk-attribute'].includes(expr.kind)) matches.push(expr)
  if (expr.kind === 'call-sdk' || expr.kind === 'call-local') Object.values(expr.args ?? {}).forEach((arg) => collectExprCalls(arg, matches))
  if (expr.kind === 'dict') Object.values(expr.entries ?? {}).forEach((value) => collectExprCalls(value, matches))
  if (expr.kind === 'list' || expr.kind === 'builtin') (expr.items ?? expr.args ?? []).forEach((value) => collectExprCalls(value, matches))
  if (['get', 'subscript', 'attribute'].includes(expr.kind)) collectExprCalls(expr.target, matches)
  return matches
}
const walkOps = (ops = [], matches = []) => {
  for (const op of ops) {
    if (['assign', 'return', 'expr'].includes(op.op)) collectExprCalls(op.value, matches)
    if (op.op === 'for') { collectExprCalls(op.iterable, matches); walkOps(op.body, matches) }
    if (op.op === 'if') { walkOps(op.then, matches); walkOps(op.else, matches) }
  }
  return matches
}

const cosmosAccount = (context) => (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === ASSISTANT_ACCOUNT && item.resourceGroup === ASSISTANT_GROUP)
const cosmosDatabase = (context) => cosmosAccount(context)?.databases?.find((item) => item.name === ASSISTANT_DATABASE)
const containerNamed = (context, name) => cosmosDatabase(context)?.containers?.find((item) => item.name === name)

const capabilityReady = (context) => (cosmosAccount(context)?.capabilities ?? []).includes('EnableNoSQLVectorSearch')

const qaContainerReady = (context) => {
  const container = containerNamed(context, 'qa_history')
  if (!container || container.partitionKeyPath !== '/product' || container.throughputMode !== 'manual' || container.throughput !== 400) return false
  const embedding = (container.vectorEmbeddingPolicy?.vectorEmbeddings ?? []).find((entry) => entry.path === '/embedding')
  if (!embedding || embedding.dataType !== 'float32' || embedding.dimensions !== 8 || embedding.distanceFunction !== 'cosine') return false
  const vectorIndex = (container.indexingPolicy?.vectorIndexes ?? []).find((entry) => entry.path === '/embedding')
  if (!vectorIndex || !['quantizedFlat', 'diskANN'].includes(vectorIndex.type)) return false
  return (container.indexingPolicy?.excludedPaths ?? []).some((entry) => entry.path === '/embedding/*')
}

const codeVectorsReady = (context) => {
  const spec = parsed(context)
  if (!spec) return false
  const remember = findReturnCall(spec.data.functions.remember_answer?.body)
  const similar = findReturnCall(spec.data.functions.find_similar_questions?.body)
  if (remember?.call !== 'cosmos.container.upsert_item' || remember.receiver !== 'qa_history') return false
  if (similar?.call !== 'cosmos.container.query_items' || similar.receiver !== 'qa_history' || similar.args?.parameters === undefined) return false
  const query = typeof similar.args?.query?.value === 'string' ? similar.args.query.value.toLowerCase() : ''
  return query.includes('vectordistance(') && query.includes('where c.product = @product') && query.includes('top @k')
}

// The canonical row's id as actually stored in qa_history (DATA_FIXTURES.
// qaHistory's own `id`, e.g. 'qa-1') - distinct from DATA_FIXTURES.questions'
// `id` (e.g. 'backup-retention'), which find_similar_questions never returns.
const CANONICAL_QUESTION = 'How many days are Contoso Backup snapshots retained?'
const CANONICAL = DATA_FIXTURES.qaHistory.find((entry) => entry.question === CANONICAL_QUESTION)
const NEAR_MISS_VECTOR = DATA_FIXTURES.nearMisses['How do I permanently delete a Contoso Backup snapshot before its retention period ends?'].vector
const PARAPHRASE_VECTOR = DATA_FIXTURES.paraphrases['How long does Contoso Backup keep my snapshots?'].vector

const similarReady = (context) => {
  const record = cosmosEvidence(context, 'similar', 'similar')
  if (!record || record.measurements.status !== 200) return false
  const arrays = (record.measurements.values ?? []).filter((value) => Array.isArray(value))
  const [nearMissRows, paraphraseRows] = arrays
  const top = paraphraseRows?.[0]
  if (!top || top.id !== CANONICAL.id || typeof top.score !== 'number' || top.score < 0.95) return false
  const nearMissTop = (nearMissRows ?? []).find((row) => row.id === CANONICAL.id)
  return !nearMissTop || nearMissTop.score <= 0.9
}

const leasesReady = (context) => containerNamed(context, 'leases')?.partitionKeyPath === '/id'

const codeFeedReady = (context) => {
  const spec = parsed(context)
  if (!spec) return false
  const saveLease = findReturnCall(spec.data.functions.save_lease?.body)
  const applyFeedback = findReturnCall(spec.data.functions.apply_feedback?.body)
  if (saveLease?.call !== 'cosmos.container.upsert_item' || saveLease.receiver !== 'leases') return false
  if (applyFeedback?.call !== 'cosmos.container.upsert_item' || applyFeedback.receiver !== 'tally') return false
  const processCalls = walkOps(spec.data.functions.process_changes?.body ?? [])
  const changeFeedCall = processCalls.find((call) => call.call === 'cosmos.container.query_items_change_feed' && call.receiver === 'feedback')
  const hasContinuationArg = !!changeFeedCall && Object.hasOwn(changeFeedCall.args ?? {}, 'continuation')
  const readsLastContinuation = processCalls.some((call) => call.call === 'cosmos.container.last_continuation' && call.receiver === 'feedback')
  const callsSaveLease = processCalls.some((call) => call.kind === 'call-local' && call.name === 'save_lease')
  return hasContinuationArg && readsLastContinuation && callsSaveLease
}

const workerDeployed = (context) => {
  const state = context.runtime.kubernetes?.clusters?.[ASSISTANT_CLUSTER_ID]
  const artifactId = context.artifacts.publishedTags?.[IMAGE_V3]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const deployment = state?.resources?.[`Deployment/${ASSISTANT_NAMESPACE}/feedback-worker`]
  const pods = getDeploymentPods(context.run ?? context, ASSISTANT_CLUSTER_ID, ASSISTANT_NAMESPACE, 'feedback-worker')
  return codeFeedReady(context) && deployment?.spec?.template?.spec?.containers?.[0]?.image === IMAGE_V3
    && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, COSMOS_MANIFEST))
    && pods.length === 1 && pods.every((pod) => state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}

const FEEDBACK_ITEMS = [
  { id: 'fb-1', questionId: 'qa-1', positive: true },
  { id: 'fb-2', questionId: 'qa-4', positive: false },
  { id: 'fb-3', questionId: 'qa-1', positive: true },
  { id: 'fb-4', questionId: 'qa-5', positive: true },
  { id: 'fb-5', questionId: 'qa-2', positive: false },
]

const noMissReady = (context) => {
  const record = cosmosEvidence(context, 'no-miss', 'feed-restart')
  if (!record || record.measurements.status !== 200 || record.measurements.value !== 2) return false
  const tally = containerNamed(context, 'tally')
  const ids = new Set((tally?.items ?? []).map((item) => item.id))
  return (tally?.items ?? []).length === 5 && FEEDBACK_ITEMS.every((item) => ids.has(item.id))
}

export const cosmosVectorGuidedLab = {
  id: 'data-cosmos-vector-guided', title: 'Guided: Similar questions and a change feed processor',
  brief: 'Enable vector search on the Knowledge Assistant\'s Cosmos account, implement and verify a similarity-ranked Q&A lookup, then build and deploy a pull-model change feed processor that tallies feedback exactly once per item.',
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 2, labMode: 'guided',
  skillAreaId: 'data', service: 'cosmos-db', status: 'available',
  manifestId: COSMOS_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  dataTarget: { resourceGroup: ASSISTANT_GROUP, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE },
  initialProjectFiles: initialFiles, solutionFiles: COSMOS_SOLUTION_FILES, initializeSimulation: seedCosmosVectorGuided,
  stages: [
    { id: 'vectors', title: 'Enable vector search and implement similarity Q&A', taskIds: ['capability', 'qa-container', 'code-vectors', 'similar'] },
    { id: 'feed', title: 'Build the feedback change feed processor', taskIds: ['leases', 'code-feed', 'worker-deployed', 'no-miss'] },
  ],
  scenarios: {
    similar: cosmosRequestScenario([
      ...DATA_FIXTURES.qaHistory.map((entry) => ({ route: 'POST /answers', args: [{ ...entry }] })),
      { route: 'GET /similar', args: [CANONICAL.product, [...NEAR_MISS_VECTOR], 1] },
      { route: 'GET /similar', args: [CANONICAL.product, [...PARAPHRASE_VECTOR], 1] },
    ]),
    'feed-restart': cosmosWorkerScenario([
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[0] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[1] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[2] },
      { action: 'batch' },
      { action: 'restart' },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[3] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[4] },
      { action: 'batch' },
    ]),
  },
  tasks: [
    cosmosTask({
      id: 'capability', stageId: 'vectors',
      text: 'Enable the EnableNoSQLVectorSearch capability on the cosmos-assistant account.',
      explanation: 'Vector search is an account-level capability; a container\'s vector policy can only be created once the account that holds it supports it.',
      hints: ['An account capability is a separate, additive update from its consistency level.', 'Use `az cosmosdb update --capabilities EnableNoSQLVectorSearch`.'],
      examNote: 'Vector search is enabled per account before creating vector containers.',
      check: capabilityReady,
      solution: { steps: commands(`az cosmosdb update --name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --capabilities EnableNoSQLVectorSearch`) },
    }),
    cosmosTask({
      id: 'qa-container', stageId: 'vectors',
      text: 'Create the qa_history container: partition key /product, 400 RU/s, a vector policy on /embedding (float32, 8 dimensions, cosine), a quantizedFlat or diskANN vector index on /embedding, and /embedding excluded from ordinary indexing.',
      explanation: 'The vector policy and its dimensions are fixed for the life of the container, so they must match the embedding model (8 dimensions here) from the start; excluding /embedding from ordinary indexing keeps writes cheap since nothing ever filters or sorts on it directly.',
      hints: ['A container\'s vector embedding policy can only be set at creation - there is no update path for it, unlike an ordinary indexing policy.', 'Use `az cosmosdb sql container create` with `--vector-embeddings` (path /embedding, dataType float32, dimensions 8, distanceFunction cosine) and `--idx` adding a vectorIndexes entry on /embedding plus excludedPaths for /embedding/*.'],
      examNote: 'Dimensions must match the embedding model; the vector policy is fixed at creation.',
      check: qaContainerReady,
      solution: { steps: commands(`az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name qa_history --partition-key-path /product --throughput 400 --vector-embeddings '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"}]}' --idx '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"},{"path":"/embedding/*"}],"vectorIndexes":[{"path":"/embedding","type":"quantizedFlat"}]}'`) },
    }),
    cosmosTask({
      id: 'code-vectors', stageId: 'vectors',
      text: 'Implement remember_answer with upsert_item (storing the embedding) and find_similar_questions with a parameterized query_items using ORDER BY VectorDistance, filtered by product, limited by TOP @k.',
      explanation: 'remember_answer is how a question/answer/embedding triple ever reaches qa_history; find_similar_questions is the only way the deployed API ranks stored questions by similarity to a new one.',
      hints: ['`remember_answer` is a single upsert_item of the whole entry dict, embedding included.', '`find_similar_questions` combines `ORDER BY VectorDistance(c.embedding, @embedding)` with `WHERE c.product = @product` and `TOP @k`, all parameterized.'],
      examNote: 'ORDER BY VectorDistance(...) ranks by similarity; combine it with filters to narrow the search.',
      check: codeVectorsReady,
      solution: { steps: [file('app.py')] },
    }),
    cosmosTask({
      id: 'similar', stageId: 'vectors',
      text: 'Verify similarity search: run the similar scenario and confirm a paraphrase returns the canonical question as the top row with score >= 0.95, and a near-miss question does not return the canonical question above 0.9.',
      explanation: 'A paraphrase of a stored question should rank it first with a high score; a related-but-different question should score lower, below a safe application threshold.',
      hints: ['Run the similar scenario - it stores several Q&A pairs, then queries once with a close paraphrase and once with a near-miss question.', 'Nearest is not the same as relevant: an application needs its own similarity threshold even when Cosmos faithfully ranks by distance.'],
      examNote: 'Similarity scores need an application threshold; nearest isn\'t always relevant.',
      check: similarReady,
      solution: { steps: [scenario('similar')] },
      verification: { scenarioId: 'similar', scenarioVersion: 1 },
      fields: ['images:assistant-api', 'indexing:qa_history'],
    }),
    cosmosTask({
      id: 'leases', stageId: 'feed',
      text: 'Create the leases container with partition key /id.',
      explanation: 'The change feed processor checkpoints its own progress as one item per worker in this container, keyed by its own id.',
      hints: ['One worker keeps one checkpoint row, keyed by its own identity - partition on /id.', 'Use `az cosmosdb sql container create` with `--partition-key-path /id`.'],
      examNote: 'The lease container stores processor checkpoints.',
      check: leasesReady,
      solution: { steps: commands(`az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name leases --partition-key-path /id --throughput 400`) },
    }),
    cosmosTask({
      id: 'code-feed', stageId: 'feed',
      text: 'Implement save_lease with leases.upsert_item, and process_changes to read feedback\'s change feed from the saved lease\'s continuation, apply each change, then save the new continuation from feedback\'s last_response_headers etag.',
      explanation: 'The Python SDK has no ChangeFeedProcessor class in this simulator; the pull model (query_items_change_feed plus a saved continuation) is how a restarted worker resumes without missing or re-reading the whole feed.',
      hints: ['Read the saved lease first; when there is none, start from the beginning instead of failing.', 'After processing, save `feedback.client_connection.last_response_headers["etag"]` as the new continuation so the next run resumes exactly where this one left off.'],
      examNote: 'Python has no ChangeFeedProcessor class; the pull model + continuation reproduces its checkpointing.',
      check: codeFeedReady,
      solution: { steps: [file('worker.py')] },
    }),
    cosmosTask({
      id: 'worker-deployed', stageId: 'feed',
      text: 'Build assistant:v3 from the completed source and deploy it to feedback-worker.',
      explanation: 'feedback-worker runs the same image as assistant-api but overrides its entrypoint to `python worker.py`, as its own Deployment with its own Pod lifecycle.',
      hints: ['Build before editing k8s/worker.yaml so the tag it references already exists in the registry.', 'Use `az acr build --registry acrassistant --image assistant:v3 .`, retag k8s/worker.yaml\'s image to `acrassistant.azurecr.io/assistant:v3`, then `kubectl apply -f k8s/worker.yaml`.'],
      examNote: 'The processor runs as its own worker, separate from the API.',
      check: workerDeployed,
      solution: { steps: [...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v3 .`), { kind: 'file', path: 'k8s/worker.yaml', content: WORKER_DEPLOYMENT_V3 }, ...commands('kubectl apply -f k8s/worker.yaml')] },
    }),
    cosmosTask({
      id: 'no-miss', stageId: 'feed',
      text: 'Verify at-least-once delivery: run the feed-restart scenario (post 3 feedback items, process a batch, restart the worker, post 2 more, process another batch) and confirm all 5 are tallied exactly once.',
      explanation: 'A restarted worker must resume from its saved checkpoint rather than re-reading from the beginning (which would double-count) or starting from "now" (which would drop the first batch); apply_feedback\'s own upsert-by-id keeps redelivery safe either way.',
      hints: ['Run the feed-restart scenario - it posts, batches, restarts, posts more, then batches again.', 'Delivery is at-least-once: checkpoint after handling, and make the handler idempotent.'],
      examNote: 'Delivery is at-least-once: checkpoint after handling, and make the handler idempotent. Latest-version mode doesn\'t surface deletes.',
      check: noMissReady,
      solution: { steps: [scenario('feed-restart')] },
      verification: { scenarioId: 'feed-restart', scenarioVersion: 1 },
      fields: ['images:feedback-worker'],
    }),
  ],
}

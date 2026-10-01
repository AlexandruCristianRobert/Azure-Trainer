import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { COSMOS_MANIFEST, COSMOS_SOLUTION_FILES } from '../../templates/data-python/cosmos.js'

// Data journey Lab helpers (Task 7 scaffold; Labs 1-4, Task 8+, add more here).
//
// `dataDependencies` is the data journey's evidence-dependency selector set
// (see `task.dependencies` / `recordVerification` in labEngine/evidence.js,
// and `integrationDependencies`/`kubernetesDependencies` in
// kubernetes/evidence.js for the pattern it mirrors). Review fix round 1
// (Task 8): a Task names exactly the fields it actually depends on, from:
//   - 'images': deployed source hashes for assistant-api and feedback-worker
//   - 'images:<deploymentName>': just that one Deployment's source hash
//     (Task 9: a Lab 2 Task that cares about only ONE of the two Deployments
//     must not use the combined 'images' field above, or every Task sharing
//     one Deployment would go stale together regardless of which function
//     each one actually depends on - see 'code:<deploymentName>:<functionName>'
//     below, the field Lab 2's own 'similar'/'no-miss' and Lab 4's Tasks use
//     instead, for exactly that reason, review fix round 2)
//   - 'clientConsistency': clients.py's own `consistency_level`
//   - 'accountConsistency': the account's default consistency level
//   - 'indexing:<container>': that container's current indexing policy
//   - 'code:<deploymentName>:<functionName>': the DEPLOYED (build-captured)
//     appSpec's op list for just that one function, from the same artifact
//     `podAppSpec` (kubernetes/data-actions.js) reads at request time - never
//     live `project.savedFiles` - so a Task that cares about one function's
//     *deployed* behavior doesn't go stale every time that Deployment is
//     rebuilt for an unrelated function's fix, only when ITS OWN function's
//     deployed behavior actually changes (Task 10 review fix round 1: Lab 3
//     Tasks sharing one Deployment across different incidents need this
//     narrower field, not the whole-image 'images:<deploymentName>' hash)
//   - 'deployedConsistency:<deploymentName>': the DEPLOYED appSpec's own
//     `client.consistency` (same build-captured artifact as 'code:', not
//     live clients.py) - narrower than 'clientConsistency' for a Task that
//     only cares about what's actually *running*, not the saved source
// The returned key is distinct per field set (sorted and joined into the
// key), so two Tasks only share a dependency key - and so only go stale
// together - when they truly depend on the exact same fields; a Task
// depending on fewer/different fields is unaffected by a change those
// fields don't cover. (Previously this returned one key covering every
// field regardless of which ones a Task asked for, over-coupling every
// verification Task in a Lab to every tracked field - Review Focus #5 /
// fix round 1 Important finding 2.)
const deploymentImageArtifact = (context, clusterId, namespace, deploymentName) => {
  const resources = context.runtime.kubernetes?.clusters?.[clusterId]?.resources ?? {}
  const image = resources[`Deployment/${namespace}/${deploymentName}`]?.spec?.template?.spec?.containers?.[0]?.image ?? null
  const artifactId = image ? context.artifacts.publishedTags?.[image] ?? null : null
  return artifactId ? context.artifacts.buildsById?.[artifactId] ?? null : null
}
const deploymentSourceHash = (context, clusterId, namespace, deploymentName) => deploymentImageArtifact(context, clusterId, namespace, deploymentName)?.sourceHash ?? null
// Mirrors `podAppSpec` (kubernetes/data-actions.js): the build-captured
// appSpec frozen on the artifact a Deployment's Pods are currently running,
// never the learner's live, possibly-unbuilt `project.savedFiles`.
const deployedAppSpec = (context, clusterId, namespace, deploymentName) => {
  const artifact = deploymentImageArtifact(context, clusterId, namespace, deploymentName)
  return artifact?.appSpec?.data ? artifact.appSpec : null
}

// Narrow "deployed matches current" guard (review ruling: a verification
// Task that grades a scenario run against a Deployment must also require
// that Deployment to be running a build of the functions it actually
// verifies, as Lab 1's own `deployed()` does for assistant-api) - compares
// the build-captured op list for the named functions (the same artifact
// `podAppSpec`/`deployedAppSpec` reads at request time) against a fresh
// parse of `context.project.savedFiles` right now. Narrower than a whole-
// image sourceHash comparison, which would also trip on an unrelated edit
// zone's own in-progress change (e.g. Lab 4's own worker.py edits must
// never stale assistant-api's already-correct, never-redeployed app.py).
export function deployedFunctionsCurrent(context, clusterId, namespace, deploymentName, functionNames) {
  const deployed = deployedAppSpec(context, clusterId, namespace, deploymentName)
  const current = parsed(context)
  if (!deployed || !current) return false
  return functionNames.every((name) => JSON.stringify(deployed.data.functions[name] ?? null) === JSON.stringify(current.data.functions[name] ?? null))
}

const DATA_DEPENDENCY_FIELDS = (context, { clusterId, namespace, account, database }, field) => {
  if (field === 'images') {
    return { assistantApiSourceHash: deploymentSourceHash(context, clusterId, namespace, 'assistant-api'), feedbackWorkerSourceHash: deploymentSourceHash(context, clusterId, namespace, 'feedback-worker') }
  }
  if (field.startsWith('images:')) {
    const deploymentName = field.slice('images:'.length)
    return { [field]: deploymentSourceHash(context, clusterId, namespace, deploymentName) }
  }
  if (field === 'clientConsistency') return { clientConsistencySource: context.project.savedFiles['clients.py'] ?? null }
  if (field === 'accountConsistency') {
    const cosmosAccount = (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === account)
    return { accountDefaultConsistency: cosmosAccount?.defaultConsistencyLevel ?? null }
  }
  if (field.startsWith('indexing:')) {
    const containerName = field.slice('indexing:'.length)
    const cosmosAccount = (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === account)
    const cosmosDatabase = cosmosAccount?.databases?.find((item) => item.name === database)
    return { [field]: cosmosDatabase?.containers?.find((item) => item.name === containerName)?.indexingPolicy ?? null }
  }
  if (field.startsWith('code:')) {
    const rest = field.slice('code:'.length)
    const separator = rest.indexOf(':')
    if (separator === -1) throw new Error(`Invalid data dependency field '${field}': expected 'code:<deploymentName>:<functionName>'.`)
    const deploymentName = rest.slice(0, separator)
    const functionName = rest.slice(separator + 1)
    if (!deploymentName || !functionName) throw new Error(`Invalid data dependency field '${field}': expected 'code:<deploymentName>:<functionName>'.`)
    return { [field]: deployedAppSpec(context, clusterId, namespace, deploymentName)?.data?.functions?.[functionName] ?? null }
  }
  if (field.startsWith('deployedConsistency:')) {
    const deploymentName = field.slice('deployedConsistency:'.length)
    if (!deploymentName) throw new Error(`Invalid data dependency field '${field}': expected 'deployedConsistency:<deploymentName>'.`)
    return { [field]: deployedAppSpec(context, clusterId, namespace, deploymentName)?.data?.client?.consistency ?? null }
  }
  throw new Error(`Unknown data dependency field '${field}'.`)
}

export function dataDependencies(target, fields) {
  const { clusterId, namespace, account, database } = target ?? {}
  const sortedFields = [...fields].sort()
  const key = `data:${clusterId}:${namespace}:${account}:${database}:${sortedFields.join(',')}`
  return {
    [key]: (context) => ({
      version: 1,
      ...Object.assign({}, ...sortedFields.map((field) => DATA_DEPENDENCY_FIELDS(context, { clusterId, namespace, account, database }, field))),
    }),
  }
}

// Shared identity for the Knowledge Assistant infrastructure that every Data
// journey Lab (1-4) deploys against: one AKS cluster/ACR/resource group, one
// Cosmos account/database, reused across Labs the same way
// aks-journey/capstone-helpers.js's CAPSTONE_TARGET is reused across its own
// stages. SUBSCRIPTION_ID matches the sandbox's single simulated
// subscription (src/lib/sandbox/model.js).
export const ASSISTANT_GROUP = 'rg-assistant'
export const ASSISTANT_REGISTRY = 'acrassistant'
export const ASSISTANT_CLUSTER = 'aks-assistant'
export const ASSISTANT_CLUSTER_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${ASSISTANT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${ASSISTANT_CLUSTER}`
export const ASSISTANT_NAMESPACE = 'assistant'
export const ASSISTANT_ACCOUNT = 'cosmos-assistant'
export const ASSISTANT_DATABASE = 'assistant'

// Lab 2's own `capability`/`leases`/`worker-deployed` command text (Task 10
// review fix round 1 Minor finding): seedCosmosTroubleshooting (cosmos-seeds.js)
// needs to replay these same three steps to reach "full Lab 2 end state"
// before baking in its own incidents, so they're shared constants here
// rather than copied literals - this module must never import a Lab module
// itself (that's what caused the Task 10 ESM import-cycle bug), so these
// stay plain strings built from the identifiers already above, not read off
// cosmosVectorGuidedLab.tasks.
export const VECTOR_CAPABILITY_COMMAND = `az cosmosdb update --name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --capabilities EnableNoSQLVectorSearch`
export const LEASES_CREATE_COMMAND = `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name leases --partition-key-path /id --throughput 400`
export const WORKER_BUILD_V3_COMMAND = `az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v3 .`
export const WORKER_DEPLOYMENT_YAML_V3 = COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v3')
export const WORKER_APPLY_COMMAND = 'kubectl apply -f k8s/worker.yaml'

// The assistant-api Deployment/Service pair (Task 7's template) is the
// `data-request` target for every Lab 1-4 scenario that calls through the
// deployed app, mirroring `integrationScenario`'s fixed target in
// aks-journey/integration-helpers.js.
export function cosmosRequestScenario(steps) {
  return Object.freeze({
    kind: 'data-request', version: 1,
    target: Object.freeze({ clusterId: ASSISTANT_CLUSTER_ID, namespace: ASSISTANT_NAMESPACE, serviceName: 'assistant-api', deploymentName: 'assistant-api' }),
    steps: Object.freeze(steps.map((step) => Object.freeze({ ...step, args: Object.freeze([...step.args]) }))),
  })
}

// The feedback-worker Deployment (Task 9's own feed-processor template) is
// the `data-worker` target for every Lab 2+ scenario that drives the pull-
// model change feed processor. feedback-worker has no Service (see
// COSMOS_MANIFEST's k8s files), so its target carries no `serviceName`,
// unlike `cosmosRequestScenario` above.
export function cosmosWorkerScenario(steps) {
  return Object.freeze({
    kind: 'data-worker', version: 1,
    target: Object.freeze({ clusterId: ASSISTANT_CLUSTER_ID, namespace: ASSISTANT_NAMESPACE, deploymentName: 'feedback-worker' }),
    steps: Object.freeze(steps.map((step) => Object.freeze(
      step.action === 'post' ? { action: step.action, route: step.route, args: Object.freeze({ ...step.args }) } : { action: step.action },
    ))),
  })
}

// Mirrors `integrationTask` (aks-journey/integration-helpers.js): bundles a
// Task's narrative fields with its verification + the shared Cosmos
// dependency selector, so each Lab only has to name its own id/text/check
// plus the `dataDependencies` fields that Task's own check actually reads.
export function cosmosTask({ id, stageId, text, explanation, hints, examNote, check, solution, verification, dependencies, fields }) {
  return {
    id, stageId, text, explanation, hints, examNote, check, solution,
    ...(verification
      ? { verification, dependencies: dependencies ?? dataDependencies({ clusterId: ASSISTANT_CLUSTER_ID, namespace: ASSISTANT_NAMESPACE, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE }, fields) }
      : {}),
  }
}

// Solution-step builders and the appSpec parse helper (Review ruling 13):
// moved here verbatim from cosmos-sdk-guided.lab.js and cosmos-vector-guided.lab.js,
// where both Labs defined them identically. `file` always writes the Lab's
// *solution* content for that path (a Task's Solution is always the fix, never
// a Lab-specific starter variant), mirroring aks-journey's own file()/commands()
// Solution-step builders.
export const file = (path) => ({ kind: 'file', path, content: COSMOS_SOLUTION_FILES[path] })
export const commands = (...lines) => lines.map((line) => ({ kind: 'command', line }))
export const scenario = (scenarioId) => ({ kind: 'scenario', scenarioId })

export const parsed = (context) => parsePythonProject(context.project.savedFiles, COSMOS_MANIFEST).appSpec
export const findReturnCall = (ops = []) => {
  for (const op of ops) {
    if (op.op === 'return' && op.value?.kind === 'call-sdk') return op.value
    if (op.op === 'if') { const found = findReturnCall(op.then) ?? findReturnCall(op.else); if (found) return found }
    if (op.op === 'for') { const found = findReturnCall(op.body); if (found) return found }
  }
  return null
}

// Reads back a Task's own current, passed verification evidence (see
// aks-journey/resource-helpers.js's `resourceReceipt` / connectivity-
// troubleshooting.lab.js's `recordFor` for the pattern). A Task's `check`
// uses this to assert on `measurements` (charge, partitions, staleness)
// that `data-actions.js` records but never itself grades pass/fail on.
export function cosmosEvidence(context, taskId, scenarioId) {
  const id = context.evidence?.currentEvidenceByTask?.[taskId]
  const record = id && context.evidence?.experimentsById?.[id]
  return record && record.taskId === taskId && record.scenarioId === scenarioId
    && record.completed === true && record.outcome === 'passed' ? record : null
}

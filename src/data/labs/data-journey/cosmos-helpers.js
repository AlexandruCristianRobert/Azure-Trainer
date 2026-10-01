import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'

// Data journey Lab helpers (Task 7 scaffold; Labs 1-4, Task 8+, add more here).
//
// `dataDependencies` is the data journey's evidence-dependency selector set
// (see `task.dependencies` / `recordVerification` in labEngine/evidence.js,
// and `integrationDependencies`/`kubernetesDependencies` in
// kubernetes/evidence.js for the pattern it mirrors). Review fix round 1
// (Task 8): a Task names exactly the fields it actually depends on, from:
//   - 'images': deployed source hashes for assistant-api and feedback-worker
//   - 'clientConsistency': clients.py's own `consistency_level`
//   - 'accountConsistency': the account's default consistency level
//   - 'indexing:<container>': that container's current indexing policy
// The returned key is distinct per field set (sorted and joined into the
// key), so two Tasks only share a dependency key - and so only go stale
// together - when they truly depend on the exact same fields; a Task
// depending on fewer/different fields is unaffected by a change those
// fields don't cover. (Previously this returned one key covering every
// field regardless of which ones a Task asked for, over-coupling every
// verification Task in a Lab to every tracked field - Review Focus #5 /
// fix round 1 Important finding 2.)
const DATA_DEPENDENCY_FIELDS = (context, { clusterId, namespace, account, database }, field) => {
  if (field === 'images') {
    const resources = context.runtime.kubernetes?.clusters?.[clusterId]?.resources ?? {}
    const sourceHash = (deploymentName) => {
      const image = resources[`Deployment/${namespace}/${deploymentName}`]?.spec?.template?.spec?.containers?.[0]?.image ?? null
      const artifactId = image ? context.artifacts.publishedTags?.[image] ?? null : null
      return artifactId ? context.artifacts.buildsById?.[artifactId]?.sourceHash ?? null : null
    }
    return { assistantApiSourceHash: sourceHash('assistant-api'), feedbackWorkerSourceHash: sourceHash('feedback-worker') }
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

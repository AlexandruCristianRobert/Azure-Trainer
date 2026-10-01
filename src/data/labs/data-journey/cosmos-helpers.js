import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'

// Data journey Lab helpers (Task 7 scaffold; Labs 1-4, Task 8+, add more here).
//
// `dataDependencies` is the data journey's evidence-dependency selector set
// (see `task.dependencies` / `recordVerification` in labEngine/evidence.js,
// and `integrationDependencies`/`kubernetesDependencies` in
// kubernetes/evidence.js for the pattern it mirrors). A Task that names it in
// its `dependencies` gets fresh evidence requirements whenever the deployed
// assistant-api/feedback-worker image, a tracked container's indexing
// policy, the account's default consistency, or clients.py (the client's own
// consistency_level) changes - Review Focus #5.
export function dataDependencies(target, { containers = [] } = {}) {
  const { clusterId, namespace, account, database } = target ?? {}
  const key = `data:${clusterId}:${namespace}:${account}:${database}`
  return {
    [key]: (context) => {
      const resources = context.runtime.kubernetes?.clusters?.[clusterId]?.resources ?? {}
      const deployedSourceHash = (deploymentName) => {
        const image = resources[`Deployment/${namespace}/${deploymentName}`]?.spec?.template?.spec?.containers?.[0]?.image ?? null
        const artifactId = image ? context.artifacts.publishedTags?.[image] ?? null : null
        return artifactId ? context.artifacts.buildsById?.[artifactId]?.sourceHash ?? null : null
      }
      const cosmosAccount = (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === account)
      const cosmosDatabase = cosmosAccount?.databases?.find((item) => item.name === database)
      return {
        version: 1,
        assistantApiSourceHash: deployedSourceHash('assistant-api'),
        feedbackWorkerSourceHash: deployedSourceHash('feedback-worker'),
        accountDefaultConsistency: cosmosAccount?.defaultConsistencyLevel ?? null,
        clientConsistencySource: context.project.savedFiles['clients.py'] ?? null,
        containers: [...containers].sort().map((name) => ({
          name, indexingPolicy: cosmosDatabase?.containers?.find((item) => item.name === name)?.indexingPolicy ?? null,
        })),
      }
    },
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
// dependency selector, so each Lab only has to name its own id/text/check.
export function cosmosTask({ id, stageId, text, explanation, hints, examNote, check, solution, verification, dependencies, containers = ['sessions'] }) {
  return {
    id, stageId, text, explanation, hints, examNote, check, solution,
    ...(verification
      ? { verification, dependencies: dependencies ?? dataDependencies({ clusterId: ASSISTANT_CLUSTER_ID, namespace: ASSISTANT_NAMESPACE, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE }, { containers }) }
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

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

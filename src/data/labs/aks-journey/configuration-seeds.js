import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { CONFIG_CLUSTER, CONFIG_GROUP, CONFIG_REGISTRY } from './configuration-helpers.js'
import { CONFIG_INDEPENDENT_FILES } from '../../templates/aks-python/configuration-independent.js'
import { CONFIG_INDEPENDENT_CLUSTER, CONFIG_INDEPENDENT_GROUP, CONFIG_INDEPENDENT_REGISTRY } from './configuration-helpers.js'

export function seedConfigurationGuided(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Configuration seed failed: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  const deployment = CONFIG_SOLUTION_FILES['k8s/deployment.yaml']
    .replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_REGISTRY}.azurecr.io/assistant:seed\n          imagePullPolicy: Always`)
  act({ type: 'save-file', path: 'app.py', text: CONFIG_SOLUTION_FILES['app.py'] })
  act({ type: 'save-file', path: 'k8s/deployment.yaml', text: deployment })
  for (const line of [`az group create -n ${CONFIG_GROUP} -l eastus`, `az acr create -g ${CONFIG_GROUP} -n ${CONFIG_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_REGISTRY} -t assistant:seed .`, `az aks create -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONFIG_REGISTRY}`, `az aks get-credentials -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER}`]) act({ type: 'command', line })
  for (const [path, text] of Object.entries({ 'k8s/namespace.yaml': CONFIG_SOLUTION_FILES['k8s/namespace.yaml'], 'k8s/configmap.yaml': CONFIG_SOLUTION_FILES['k8s/configmap.yaml'], 'k8s/secret.yaml': CONFIG_SOLUTION_FILES['k8s/secret.yaml'], 'k8s/deployment.yaml': deployment, 'k8s/service.yaml': CONFIG_SOLUTION_FILES['k8s/service.yaml'] })) {
    act({ type: 'save-file', path, text }); act({ type: 'command', line: `kubectl apply -f ${path}` })
  }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

export function seedConfigurationIndependent(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Independent configuration seed failed: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  for (const line of [`az group create -n ${CONFIG_INDEPENDENT_GROUP} -l eastus`, `az acr create -g ${CONFIG_INDEPENDENT_GROUP} -n ${CONFIG_INDEPENDENT_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_INDEPENDENT_REGISTRY} -t assistant:shared .`, `az aks create -g ${CONFIG_INDEPENDENT_GROUP} -n ${CONFIG_INDEPENDENT_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONFIG_INDEPENDENT_REGISTRY}`, `az aks get-credentials -g ${CONFIG_INDEPENDENT_GROUP} -n ${CONFIG_INDEPENDENT_CLUSTER}`]) act({ type: 'command', line })
  for (const path of ['k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml']) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters.find(cluster => cluster.name === CONFIG_INDEPENDENT_CLUSTER)?.id
  const pods = clusterId ? seeded.runtime.kubernetes.clusters[clusterId] : null
  const artifactId = clusterId && Object.values(pods.podSnapshots).find(snapshot => snapshot)?.artifactId
  seeded = { ...seeded, runtime: { ...seeded.runtime, kubernetes: { ...seeded.runtime.kubernetes,
    configurationIndependent: { version: 1, artifactId, primaryFiles: Object.fromEntries(['app.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml'].map(path => [path, CONFIG_INDEPENDENT_FILES[path]])) } } } }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

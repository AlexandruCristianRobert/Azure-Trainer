import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { CONNECTIVITY_FILES } from '../../templates/aks-python/connectivity.js'

export const CONNECTIVITY_GROUP = 'rg-aks-connectivity-guided'
export const CONNECTIVITY_REGISTRY = 'acraksnetworkguided'
export const CONNECTIVITY_CLUSTER = 'aks-connectivity-guided'

export function seedConnectivityGuided(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Connectivity seed failed for ${action.type}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  const seedDeployment = CONNECTIVITY_FILES['k8s/deployment.yaml'].replace('assistant:starter', 'assistant:seed')
  act({ type: 'save-file', path: 'k8s/deployment.yaml', text: seedDeployment })
  for (const line of [
    `az group create -n ${CONNECTIVITY_GROUP} -l eastus`,
    `az acr create -g ${CONNECTIVITY_GROUP} -n ${CONNECTIVITY_REGISTRY} --sku Basic`,
    `az acr build -r ${CONNECTIVITY_REGISTRY} -t assistant:seed .`,
    `az aks create -g ${CONNECTIVITY_GROUP} -n ${CONNECTIVITY_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONNECTIVITY_REGISTRY}`,
    `az aks get-credentials -g ${CONNECTIVITY_GROUP} -n ${CONNECTIVITY_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml']) {
    act({ type: 'save-file', path, text: path === 'k8s/deployment.yaml' ? seedDeployment : CONNECTIVITY_FILES[path] })
    act({ type: 'command', line: `kubectl apply -f ${path}` })
  }
  const clusterId = seeded.sandbox.aksClusters[0].id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const uid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid, resourceVersion: '1', labels: { app: 'diagnostics' } },
    spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [uid]
  seeded = reconcileServices(seeded, clusterId)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

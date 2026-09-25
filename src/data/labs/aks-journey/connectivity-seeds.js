import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { CONNECTIVITY_FILES } from '../../templates/aks-python/connectivity.js'
import { CONNECTIVITY_TROUBLESHOOTING_CLUSTER, CONNECTIVITY_TROUBLESHOOTING_GROUP, CONNECTIVITY_TROUBLESHOOTING_IMAGE, CONNECTIVITY_TROUBLESHOOTING_LAB_ID, CONNECTIVITY_TROUBLESHOOTING_REGISTRY } from './connectivity-troubleshooting-incidents.js'

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

export function seedConnectivityTroubleshooting(run) {
  const lab = { id: CONNECTIVITY_TROUBLESHOOTING_LAB_ID, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: run.project.manifestId, tasks: [], capabilities: { acrBuild: true, kubernetes: true,
      kubernetesConfiguration: true, kubernetesConnectivity: true } }
  let seeded = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
    clusters: { ...run.runtime.kubernetes.clusters } } } }
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    const errors = (result.lines ?? []).filter(line => line.kind === 'err')
    if (result.diagnostics.length || errors.length) throw new Error(`Connectivity troubleshooting seed failed: ${JSON.stringify([...result.diagnostics, ...errors])}`)
    seeded = result.run
  }
  const deployment = CONNECTIVITY_FILES['k8s/deployment.yaml'].replace('acraksnetworkguided.azurecr.io/assistant:starter', CONNECTIVITY_TROUBLESHOOTING_IMAGE)
  const internalFault = `apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-internal\n  namespace: assistant\nspec:\n  type: ClusterIP\n  selector:\n    app: assistnat\n  ports:\n    - protocol: TCP\n      port: 80\n      targetPort: http\n`
  const external = `apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-public\n  namespace: assistant\nspec:\n  type: LoadBalancer\n  selector:\n    app: assistant\n  ports:\n    - protocol: TCP\n      port: 80\n      targetPort: http\n`
  for (const [path, text] of Object.entries({ ...CONNECTIVITY_FILES, 'k8s/deployment.yaml': deployment,
    'k8s/service-internal.yaml': internalFault, 'k8s/service-external.yaml': external })) act({ type: 'save-file', path, text })
  for (const line of [
    `az group create -n ${CONNECTIVITY_TROUBLESHOOTING_GROUP} -l eastus`,
    `az acr create -g ${CONNECTIVITY_TROUBLESHOOTING_GROUP} -n ${CONNECTIVITY_TROUBLESHOOTING_REGISTRY} --sku Basic`,
    `az acr build -r ${CONNECTIVITY_TROUBLESHOOTING_REGISTRY} -t assistant:configured .`,
    `az aks create -g ${CONNECTIVITY_TROUBLESHOOTING_GROUP} -n ${CONNECTIVITY_TROUBLESHOOTING_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONNECTIVITY_TROUBLESHOOTING_REGISTRY}`,
    `az aks get-credentials -g ${CONNECTIVITY_TROUBLESHOOTING_GROUP} -n ${CONNECTIVITY_TROUBLESHOOTING_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml'])
    act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters[0].id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const uid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid, resourceVersion: '1', labels: { app: 'diagnostics' } },
    spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [uid]
  state.connectivity.incident = { id: 'network-hops-v1', phase: 'selector', sequence: 1,
    observations: { selector: null, port: null, dependency: null }, recoveries: { selector: null, port: null, dependency: null } }
  seeded = reconcileServices(seeded, clusterId)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

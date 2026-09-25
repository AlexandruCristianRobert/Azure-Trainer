import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { INTEGRATION_FILES } from '../../templates/aks-python/integration.js'
import { AI_GUIDED_CLUSTER, AI_GUIDED_GROUP, AI_GUIDED_REGISTRY, AI_INDEPENDENT_CLUSTER, AI_INDEPENDENT_GROUP, AI_INDEPENDENT_REGISTRY } from './integration-helpers.js'
import { AI_TROUBLESHOOTING_CLUSTER, AI_TROUBLESHOOTING_GROUP, AI_TROUBLESHOOTING_REGISTRY } from './integration-incidents.js'

export function seedIntegrationGuided(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Integration seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  const deployment = seeded.project.savedFiles['k8s/deployment.yaml']
    .replace(/image: .+\/assistant:integration-v1/, `image: ${AI_GUIDED_REGISTRY}.azurecr.io/assistant:baseline`)
  act({ type: 'save-file', path: 'k8s/deployment.yaml', text: deployment })
  for (const line of [
    `az group create -n ${AI_GUIDED_GROUP} -l eastus`,
    `az acr create -g ${AI_GUIDED_GROUP} -n ${AI_GUIDED_REGISTRY} --sku Basic`,
    `az acr build -r ${AI_GUIDED_REGISTRY} -t assistant:baseline .`,
    `az aks create -g ${AI_GUIDED_GROUP} -n ${AI_GUIDED_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${AI_GUIDED_REGISTRY}`,
    `az aks get-credentials -g ${AI_GUIDED_GROUP} -n ${AI_GUIDED_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of INTEGRATION_FILES.filter(path => path.startsWith('k8s/'))) act({ type: 'command', line: `kubectl apply -f ${path}` })
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

export function seedIntegrationTroubleshooting(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId, tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true } }
  let seeded = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, integrationIncident: { version: 1, labId: run.labId, phase: 'deployment', transitions: [] } } } }
  const act = action => { const result = applyRunAction(seeded, action, lab); if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Integration troubleshooting seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`); seeded = result.run }
  if (!seeded.project.savedFiles['k8s/deployment.yaml'].includes('imagePullPolicy: Always')) act({ type: 'save-file', path: 'k8s/deployment.yaml', text: seeded.project.savedFiles['k8s/deployment.yaml'].replace('          ports:', '          imagePullPolicy: Always\n          ports:') })
  for (const path of ['k8s/service-internal.yaml', 'k8s/service-external.yaml']) act({ type: 'save-file', path, text: seeded.project.savedFiles[path].replace('    - port: 80', '    - port: 80\n      protocol: TCP') })
  for (const line of [`az group create -n ${AI_TROUBLESHOOTING_GROUP} -l eastus`, `az acr create -g ${AI_TROUBLESHOOTING_GROUP} -n ${AI_TROUBLESHOOTING_REGISTRY} --sku Basic`, `az acr build -r ${AI_TROUBLESHOOTING_REGISTRY} -t assistant:baseline .`, `az aks create -g ${AI_TROUBLESHOOTING_GROUP} -n ${AI_TROUBLESHOOTING_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${AI_TROUBLESHOOTING_REGISTRY}`, `az aks get-credentials -g ${AI_TROUBLESHOOTING_GROUP} -n ${AI_TROUBLESHOOTING_CLUSTER}`]) act({ type: 'command', line })
  for (const path of INTEGRATION_FILES.filter(path => path.startsWith('k8s/'))) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters[0].id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const uid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid, resourceVersion: '1', labels: { app: 'diagnostics' } }, spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [uid]
  seeded = reconcileServices(seeded, clusterId)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

export function seedIntegrationIndependent(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId, tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true } }
  let seeded = run
  const act = action => { const result = applyRunAction(seeded, action, lab); if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Independent integration seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`); seeded = result.run }
  for (const line of [`az group create -n ${AI_INDEPENDENT_GROUP} -l eastus`, `az acr create -g ${AI_INDEPENDENT_GROUP} -n ${AI_INDEPENDENT_REGISTRY} --sku Basic`, `az acr build -r ${AI_INDEPENDENT_REGISTRY} -t assistant:baseline .`, `az aks create -g ${AI_INDEPENDENT_GROUP} -n ${AI_INDEPENDENT_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${AI_INDEPENDENT_REGISTRY}`, `az aks get-credentials -g ${AI_INDEPENDENT_GROUP} -n ${AI_INDEPENDENT_CLUSTER}`]) act({ type: 'command', line })
  for (const path of INTEGRATION_FILES.filter(path => path.startsWith('k8s/'))) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters[0].id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const uid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid, resourceVersion: '1', labels: { app: 'diagnostics' } }, spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [uid]
  seeded = reconcileServices(seeded, clusterId)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

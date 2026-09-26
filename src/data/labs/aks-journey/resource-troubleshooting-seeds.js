import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { RESOURCE_MANIFEST, RESOURCE_SOLUTION_FILES } from '../../templates/aks-python/resources.js'

export const RESOURCES_TROUBLESHOOTING_GROUP = 'rg-aks-resources-troubleshooting'
export const RESOURCES_TROUBLESHOOTING_REGISTRY = 'acraksresourcestrouble'
export const RESOURCES_TROUBLESHOOTING_CLUSTER = 'aks-resources-troubleshooting'
export const RESOURCES_TROUBLESHOOTING_IMAGE = `${RESOURCES_TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:resources-v1`

const pendingDeployment = RESOURCE_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_TROUBLESHOOTING_IMAGE)
  .replace('          cpu: "250m"', '          cpu: "1250m"').replace('          cpu: "500m"', '          cpu: "1500m"')

export const RESOURCES_TROUBLESHOOTING_FILES = Object.freeze({ ...RESOURCE_SOLUTION_FILES, 'k8s/deployment.yaml': pendingDeployment })

export function seedResourcesTroubleshooting(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: RESOURCE_MANIFEST.id,
    healthFixture: { initializationSeconds: 6 }, tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true } }
  let seeded = run
  const act = action => { const result = applyRunAction(seeded, action, lab); if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Resource troubleshooting seed failed: ${JSON.stringify(action)}`); seeded = result.run }
  for (const line of [
    `az group create -n ${RESOURCES_TROUBLESHOOTING_GROUP} -l eastus`,
    `az acr create -g ${RESOURCES_TROUBLESHOOTING_GROUP} -n ${RESOURCES_TROUBLESHOOTING_REGISTRY} --sku Basic`,
    `az acr build -r ${RESOURCES_TROUBLESHOOTING_REGISTRY} -t assistant:resources-v1 .`,
    `az aks create -g ${RESOURCES_TROUBLESHOOTING_GROUP} -n ${RESOURCES_TROUBLESHOOTING_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${RESOURCES_TROUBLESHOOTING_REGISTRY}`,
    `az aks get-credentials -g ${RESOURCES_TROUBLESHOOTING_GROUP} -n ${RESOURCES_TROUBLESHOOTING_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of RESOURCE_MANIFEST.kubernetesFiles.filter(path => path !== 'k8s/hpa.yaml')) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === RESOURCES_TROUBLESHOOTING_CLUSTER)?.id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resourcesRuntime.incident = { version: 1, id: 'resource-faults-v1', phase: 'scheduling', sequence: 1, observations: {}, recoveries: {} }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

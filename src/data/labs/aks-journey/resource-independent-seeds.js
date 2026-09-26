import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { RESOURCE_INDEPENDENT_SOLUTION_FILES, RESOURCE_MANIFEST } from '../../templates/aks-python/resources.js'

export const RESOURCES_INDEPENDENT_GROUP = 'rg-aks-resources-independent'
export const RESOURCES_INDEPENDENT_REGISTRY = 'acraksresourcesindependent'
export const RESOURCES_INDEPENDENT_CLUSTER = 'aks-resources-independent'
export const RESOURCES_INDEPENDENT_IMAGE = `${RESOURCES_INDEPENDENT_REGISTRY}.azurecr.io/assistant:workload-v1`

export const RESOURCES_INDEPENDENT_FILES = Object.freeze({ ...RESOURCE_INDEPENDENT_SOLUTION_FILES,
  'k8s/deployment.yaml': RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml']
    .replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_INDEPENDENT_IMAGE)
    .replace(/          resources:\n(?:.*\n){6}/, ''),
  'k8s/hpa.yaml': '# Author an autoscaling/v2 CPU utilization HPA for assistant.\n',
})

export function seedResourcesIndependent(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: RESOURCE_MANIFEST.id,
    healthFixture: { initializationSeconds: 6 }, tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true } }
  let seeded = run
  const act = action => { const result = applyRunAction(seeded, action, lab); if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Independent resources seed failed: ${JSON.stringify(action)}`); seeded = result.run }
  for (const line of [
    `az group create -n ${RESOURCES_INDEPENDENT_GROUP} -l eastus`,
    `az acr create -g ${RESOURCES_INDEPENDENT_GROUP} -n ${RESOURCES_INDEPENDENT_REGISTRY} --sku Basic`,
    `az acr build -r ${RESOURCES_INDEPENDENT_REGISTRY} -t assistant:workload-v1 .`,
    `az aks create -g ${RESOURCES_INDEPENDENT_GROUP} -n ${RESOURCES_INDEPENDENT_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${RESOURCES_INDEPENDENT_REGISTRY}`,
    `az aks get-credentials -g ${RESOURCES_INDEPENDENT_GROUP} -n ${RESOURCES_INDEPENDENT_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of RESOURCE_MANIFEST.kubernetesFiles.filter(path => path !== 'k8s/hpa.yaml')) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === RESOURCES_INDEPENDENT_CLUSTER)?.id
  if (!clusterId) throw new Error('Independent resources seed did not create its AKS cluster.')
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  act({ type: 'aks-advance', seconds: 15 })
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

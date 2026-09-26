import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { RESOURCE_MANIFEST, RESOURCE_FILES } from '../../templates/aks-python/resources.js'

export const RESOURCES_GUIDED_GROUP = 'rg-aks-resources-guided'
export const RESOURCES_GUIDED_REGISTRY = 'acraksresourcesguided'
export const RESOURCES_GUIDED_CLUSTER = 'aks-resources-guided'
export const RESOURCES_GUIDED_IMAGE = `${RESOURCES_GUIDED_REGISTRY}.azurecr.io/assistant:resources-v1`
export const RESOURCES_STARTER_IMAGE = `${RESOURCES_GUIDED_REGISTRY}.azurecr.io/assistant:starter`
export const RESOURCES_GUIDED_FILES = Object.freeze({
  ...RESOURCE_FILES,
  'k8s/deployment.yaml': RESOURCE_FILES['k8s/deployment.yaml']
    .replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_STARTER_IMAGE)
    .replace('  replicas: 2\n', '  replicas: 1\n'),
})

export function seedResourcesGuided(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: RESOURCE_MANIFEST.id, healthFixture: { initializationSeconds: 6 },
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err'))
      throw new Error(`Guided resources seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  for (const line of [
    `az group create -n ${RESOURCES_GUIDED_GROUP} -l eastus`,
    `az acr create -g ${RESOURCES_GUIDED_GROUP} -n ${RESOURCES_GUIDED_REGISTRY} --sku Basic`,
    `az acr build -r ${RESOURCES_GUIDED_REGISTRY} -t assistant:starter .`,
    `az aks create -g ${RESOURCES_GUIDED_GROUP} -n ${RESOURCES_GUIDED_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${RESOURCES_GUIDED_REGISTRY}`,
    `az aks get-credentials -g ${RESOURCES_GUIDED_GROUP} -n ${RESOURCES_GUIDED_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of RESOURCE_MANIFEST.kubernetesFiles.filter(item => item !== 'k8s/hpa.yaml')) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === RESOURCES_GUIDED_CLUSTER)?.id
  if (!clusterId) throw new Error('Guided resources seed did not create its AKS cluster.')
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  act({ type: 'aks-advance', seconds: 15 })
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

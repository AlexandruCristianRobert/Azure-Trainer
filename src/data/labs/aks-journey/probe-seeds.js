import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { HEALTH_FIXTURES } from '../../fixtures/aks/health.js'
import { HEALTH_MANIFEST } from '../../templates/aks-python/health.js'

export const PROBES_GUIDED_GROUP = 'rg-aks-probes-guided'
export const PROBES_GUIDED_REGISTRY = 'acraksprobesguided'
export const PROBES_GUIDED_CLUSTER = 'aks-probes-guided'
export const PROBES_GUIDED_IMAGE = `${PROBES_GUIDED_REGISTRY}.azurecr.io/assistant:health-v1`

export function seedProbesGuided(run) {
  const seedLab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: HEALTH_MANIFEST.id, healthFixture: { initializationSeconds: HEALTH_FIXTURES.initializationSeconds },
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, seedLab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err'))
      throw new Error(`Guided probes seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  for (const line of [
    `az group create -n ${PROBES_GUIDED_GROUP} -l eastus`,
    `az acr create -g ${PROBES_GUIDED_GROUP} -n ${PROBES_GUIDED_REGISTRY} --sku Basic`,
    `az acr build -r ${PROBES_GUIDED_REGISTRY} -t assistant:starter .`,
    `az aks create -g ${PROBES_GUIDED_GROUP} -n ${PROBES_GUIDED_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${PROBES_GUIDED_REGISTRY}`,
    `az aks get-credentials -g ${PROBES_GUIDED_GROUP} -n ${PROBES_GUIDED_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of HEALTH_MANIFEST.kubernetesFiles) act({ type: 'command', line: `kubectl apply -f ${path}` })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === PROBES_GUIDED_CLUSTER)?.id
  if (!clusterId) throw new Error('Guided probes seed did not create its AKS cluster.')
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: {
    name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const diagnosticUid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: {
    name: 'diagnostics', namespace: 'diagnostics', uid: diagnosticUid, resourceVersion: '1', labels: { app: 'diagnostics' } },
    spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] },
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [diagnosticUid]
  seeded = reconcileServices(seeded, clusterId)
  act({ type: 'aks-advance', seconds: HEALTH_FIXTURES.initializationSeconds })
  // The initializer contract intentionally returns only the simulation envelope.
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

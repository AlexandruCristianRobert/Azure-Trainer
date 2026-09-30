import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { RELEASE_MANIFEST, RELEASE_FILES } from '../../templates/aks-python/releases.js'

export const RELEASES_GUIDED_GROUP = 'rg-aks-releases-guided'
export const RELEASES_GUIDED_REGISTRY = 'acraksreleasesguided'
export const RELEASES_GUIDED_CLUSTER = 'aks-releases-guided'
export const RELEASES_GUIDED_IMAGE = `${RELEASES_GUIDED_REGISTRY}.azurecr.io/assistant:release-v1`

/** Seed only through learner-facing build, apply and clock actions. */
export function createReleaseSeed(lab, { run, group = RELEASES_GUIDED_GROUP, registry = RELEASES_GUIDED_REGISTRY, cluster = RELEASES_GUIDED_CLUSTER } = {}) {
  let seeded = run
  const seedLab = { ...lab, tasks: [], scenarios: {} }
  const act = action => {
    const result = applyRunAction(seeded, action, seedLab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err'))
      throw new Error(`Release seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  for (const line of [
    `az group create -n ${group} -l eastus`,
    `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image assistant:release-v1 .`,
    `az aks create -g ${group} -n ${cluster} --enable-managed-identity --generate-ssh-keys --attach-acr ${registry}`,
    `az aks get-credentials -g ${group} -n ${cluster}`,
    ...RELEASE_MANIFEST.kubernetesFiles.map(path => `kubectl apply -f ${path}`),
  ]) act({ type: 'command', line })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === cluster)?.id
  seeded = reconcileServices(initializeConnectivity(seeded, clusterId), clusterId)
  act({ type: 'aks-advance', seconds: 15 })
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

export const RELEASES_GUIDED_FILES = RELEASE_FILES

import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { RELEASE_MANIFEST, RELEASE_FILES, RELEASE_SOLUTION_FILES } from '../../templates/aks-python/releases.js'

export const RELEASES_GUIDED_GROUP = 'rg-aks-releases-guided'
export const RELEASES_GUIDED_REGISTRY = 'acraksreleasesguided'
export const RELEASES_GUIDED_CLUSTER = 'aks-releases-guided'
export const RELEASES_GUIDED_IMAGE = `${RELEASES_GUIDED_REGISTRY}.azurecr.io/assistant:release-v1`
export const RELEASES_INDEPENDENT_GROUP = 'rg-aks-releases-independent'
export const RELEASES_INDEPENDENT_REGISTRY = 'acraksreleasesindependent'
export const RELEASES_INDEPENDENT_CLUSTER = 'aks-releases-independent'
export const RELEASES_INDEPENDENT_SOLUTION_FILES = Object.freeze(Object.fromEntries(Object.entries(RELEASE_SOLUTION_FILES)
  .map(([path, text]) => [path, text.replaceAll(RELEASES_GUIDED_REGISTRY, RELEASES_INDEPENDENT_REGISTRY)
    .replace('  replicas: 2', '  replicas: 3')])))
export const RELEASES_INDEPENDENT_FILES = Object.freeze({ ...RELEASES_INDEPENDENT_SOLUTION_FILES,
  'app.py': RELEASE_FILES['app.py'],
  'k8s/deployment.yaml': RELEASES_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml'].replace('release-v2', 'release-v1')
    .replace(/  strategy:\n    type: RollingUpdate\n    rollingUpdate:\n      maxSurge: 1\n      maxUnavailable: 0\n  minReadySeconds: 5\n  progressDeadlineSeconds: 60\n  revisionHistoryLimit: 3\n/, '') })
export const RELEASES_TROUBLESHOOTING_GROUP = 'rg-aks-releases-troubleshooting'
export const RELEASES_TROUBLESHOOTING_REGISTRY = 'acraksreleasestroubleshooting'
export const RELEASES_TROUBLESHOOTING_CLUSTER = 'aks-releases-troubleshooting'
export const RELEASES_TROUBLESHOOTING_SOLUTION_FILES = Object.freeze(Object.fromEntries(Object.entries(RELEASE_SOLUTION_FILES)
  .map(([path, text]) => [path, text.replaceAll(RELEASES_GUIDED_REGISTRY, RELEASES_TROUBLESHOOTING_REGISTRY)])))
export const RELEASES_TROUBLESHOOTING_FILES = Object.freeze({ ...RELEASES_TROUBLESHOOTING_SOLUTION_FILES,
  'k8s/deployment.yaml': RELEASES_TROUBLESHOOTING_SOLUTION_FILES['k8s/deployment.yaml'].replace(/\bkey: ANSWER_DEPLOYMENT\b/, 'key: ANSWER_DEPLOYMENT_V2') })

/** Seed only through learner-facing build, apply and clock actions. */
export function createReleaseSeed(lab, { run, independent = false, replicas = independent ? 3 : 2,
  group = independent ? RELEASES_INDEPENDENT_GROUP : RELEASES_GUIDED_GROUP,
  registry = independent ? RELEASES_INDEPENDENT_REGISTRY : RELEASES_GUIDED_REGISTRY,
  cluster = independent ? RELEASES_INDEPENDENT_CLUSTER : RELEASES_GUIDED_CLUSTER, incident = null } = {}) {
  let seeded = run
  const seedLab = { ...lab, tasks: [], scenarios: {} }
  const act = action => {
    const result = applyRunAction(seeded, action, seedLab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err'))
      throw new Error(`Release seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  const finalFiles = { ...run.project.savedFiles }
  if (!new RegExp(`replicas: ${replicas}\\b`).test(finalFiles['k8s/deployment.yaml'])) throw new Error('Release seed replicas must match the independently supplied Deployment.')
  if (incident === 'missing-config-key') {
    act({ type: 'save-file', path: 'app.py', text: RELEASE_FILES['app.py'] })
    act({ type: 'save-file', path: 'k8s/deployment.yaml', text: finalFiles['k8s/deployment.yaml']
      .replace('release-v2', 'release-v1').replace(/\bkey: ANSWER_DEPLOYMENT_V2\b/, 'key: ANSWER_DEPLOYMENT') })
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
  if (incident === 'missing-config-key') {
    act({ type: 'save-file', path: 'app.py', text: finalFiles['app.py'] })
    act({ type: 'command', line: `az acr build --registry ${registry} --image assistant:release-v2 .` })
    act({ type: 'save-file', path: 'k8s/deployment.yaml', text: finalFiles['k8s/deployment.yaml'] })
    act({ type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' })
    act({ type: 'aks-advance', seconds: 60 })
  }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

export const RELEASES_GUIDED_FILES = RELEASE_FILES

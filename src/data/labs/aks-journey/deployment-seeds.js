import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { FOUNDATION_MANIFEST, FOUNDATION_SOLUTION_FILES } from '../../templates/aks-python/foundation.js'

export const TROUBLESHOOTING_GROUP = 'rg-aks-troubleshooting'
export const TROUBLESHOOTING_REGISTRY = 'acrakstrouble'
export const TROUBLESHOOTING_CLUSTER = 'aks-troubleshooting'
export const TROUBLESHOOTING_IMAGE = `${TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:v1`

export const troubleshootingSolutionFiles = Object.freeze({
  ...FOUNDATION_SOLUTION_FILES,
  'k8s/deployment.yaml': FOUNDATION_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksguided.azurecr.io', `${TROUBLESHOOTING_REGISTRY}.azurecr.io`),
})

export const troubleshootingInitialFiles = Object.freeze({
  ...troubleshootingSolutionFiles,
  'k8s/namespace.yaml': troubleshootingSolutionFiles['k8s/namespace.yaml'].replace('name: assistant', 'name: staging'),
  'k8s/deployment.yaml': troubleshootingSolutionFiles['k8s/deployment.yaml']
    .replace('namespace: assistant', 'namespace: staging').replace(':v1', ':missing'),
  'k8s/service.yaml': troubleshootingSolutionFiles['k8s/service.yaml'].replace('namespace: assistant', 'namespace: staging'),
})

function seedCommand(run, lab, line) {
  const result = applyRunAction(run, { type: 'command', line }, lab)
  if (result.diagnostics.length || result.lines.some(item => item.kind === 'err')) {
    throw new Error(`AKS troubleshooting incident seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
  }
  return result.run
}

export function seedDeploymentTroubleshooting(run) {
  const seedLab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: FOUNDATION_MANIFEST.id, tasks: [], capabilities: { acrBuild: true, kubernetes: true } }
  let seeded = run
  for (const line of [
    `az group create -n ${TROUBLESHOOTING_GROUP} -l eastus`,
    `az acr create -g ${TROUBLESHOOTING_GROUP} -n ${TROUBLESHOOTING_REGISTRY} --sku Basic`,
    `az acr build -r ${TROUBLESHOOTING_REGISTRY} -t assistant:v1 .`,
    `az aks create -g ${TROUBLESHOOTING_GROUP} -n ${TROUBLESHOOTING_CLUSTER} --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys`,
    `az aks get-credentials -g ${TROUBLESHOOTING_GROUP} -n ${TROUBLESHOOTING_CLUSTER}`,
    'kubectl config set-context --current --namespace staging',
    'kubectl apply -f k8s/namespace.yaml',
    'kubectl apply -f k8s/deployment.yaml',
    'kubectl apply -f k8s/service.yaml',
  ]) seeded = seedCommand(seeded, seedLab, line)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

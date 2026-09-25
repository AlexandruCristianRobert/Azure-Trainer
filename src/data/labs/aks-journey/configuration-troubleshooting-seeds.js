import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { CONFIG_TROUBLESHOOTING_CLUSTER, CONFIG_TROUBLESHOOTING_GROUP, CONFIG_TROUBLESHOOTING_REGISTRY } from './config-incidents.js'

const assistantAndDecoyNamespaces = `apiVersion: v1
kind: Namespace
metadata:
  name: assistant
---
apiVersion: v1
kind: Namespace
metadata:
  name: decoy
`
const decoyConfigMap = CONFIG_SOLUTION_FILES['k8s/configmap.yaml'].replace('namespace: assistant', 'namespace: decoy')
const configuredDeployment = CONFIG_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:configured\n          imagePullPolicy: Always`)

export const CONFIG_TROUBLESHOOTING_PROJECT_FILES = Object.freeze({
  ...CONFIG_FILES,
  'app.py': CONFIG_SOLUTION_FILES['app.py'],
  'k8s/namespace.yaml': assistantAndDecoyNamespaces,
  'k8s/configmap.yaml': decoyConfigMap,
  'k8s/deployment.yaml': configuredDeployment,
})

export function seedConfigurationTroubleshooting(run) {
  const seedLab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true }, tasks: [] }
  let seeded = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
    configIncident: { version: 1, labId: run.labId, phase: 'reference', transitions: [] } } } }
  const act = action => {
    const result = applyRunAction(seeded, action, seedLab)
    const errors = result.lines.filter(line => line.kind === 'err')
    if (result.diagnostics.length || errors.length) throw new Error(`Configuration troubleshooting seed failed: ${JSON.stringify([...result.diagnostics, ...errors])}`)
    seeded = result.run
  }
  for (const [path, text] of Object.entries(CONFIG_TROUBLESHOOTING_PROJECT_FILES)) act({ type: 'save-file', path, text })
  for (const line of [
    `az group create -n ${CONFIG_TROUBLESHOOTING_GROUP} -l eastus`,
    `az acr create -g ${CONFIG_TROUBLESHOOTING_GROUP} -n ${CONFIG_TROUBLESHOOTING_REGISTRY} --sku Basic`,
    `az acr build -r ${CONFIG_TROUBLESHOOTING_REGISTRY} -t assistant:configured .`,
    `az aks create -g ${CONFIG_TROUBLESHOOTING_GROUP} -n ${CONFIG_TROUBLESHOOTING_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONFIG_TROUBLESHOOTING_REGISTRY}`,
    `az aks get-credentials -g ${CONFIG_TROUBLESHOOTING_GROUP} -n ${CONFIG_TROUBLESHOOTING_CLUSTER}`,
  ]) act({ type: 'command', line })
  for (const path of ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'])
    act({ type: 'command', line: `kubectl apply -f ${path}` })
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

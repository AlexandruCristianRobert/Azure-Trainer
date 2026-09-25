import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { CONFIG_CLUSTER, CONFIG_GROUP, CONFIG_REGISTRY } from './configuration-helpers.js'

export function seedConfigurationGuided(run) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true } }
  let seeded = run
  const act = action => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Configuration seed failed: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  const deployment = CONFIG_SOLUTION_FILES['k8s/deployment.yaml']
    .replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_REGISTRY}.azurecr.io/assistant:seed\n          imagePullPolicy: Always`)
  act({ type: 'save-file', path: 'app.py', text: CONFIG_SOLUTION_FILES['app.py'] })
  act({ type: 'save-file', path: 'k8s/deployment.yaml', text: deployment })
  for (const line of [`az group create -n ${CONFIG_GROUP} -l eastus`, `az acr create -g ${CONFIG_GROUP} -n ${CONFIG_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_REGISTRY} -t assistant:seed .`, `az aks create -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONFIG_REGISTRY}`, `az aks get-credentials -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER}`]) act({ type: 'command', line })
  for (const [path, text] of Object.entries({ 'k8s/namespace.yaml': CONFIG_SOLUTION_FILES['k8s/namespace.yaml'], 'k8s/configmap.yaml': CONFIG_SOLUTION_FILES['k8s/configmap.yaml'], 'k8s/secret.yaml': CONFIG_SOLUTION_FILES['k8s/secret.yaml'], 'k8s/deployment.yaml': deployment, 'k8s/service.yaml': CONFIG_SOLUTION_FILES['k8s/service.yaml'] })) {
    act({ type: 'save-file', path, text }); act({ type: 'command', line: `kubectl apply -f ${path}` })
  }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

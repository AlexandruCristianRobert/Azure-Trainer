import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { configurationDependencies } from '../../../lib/kubernetes/evidence.js'
import { CONFIG_CLUSTER, CONFIG_GROUP, CONFIG_IMAGE, CONFIG_REGISTRY, configurationDeploymentReady, configurationSourceReady } from './configuration-helpers.js'
import { seedConfigurationGuided } from './configuration-seeds.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONFIG_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONFIG_CLUSTER}`
const deps = configurationDependencies({ clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant' })
const file = path => ({ kind: 'file', path, content: CONFIG_SOLUTION_FILES[path] })
const deploymentSolution = CONFIG_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_IMAGE}\n          imagePullPolicy: Always`)
const commands = lines => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const support = (id, text, check, solution, verification) => ({ id, stageId: 'configure', text, explanation: 'This browser-local exercise uses supplied fictional dependencies and captured Kubernetes configuration.', check, hints: ['Save the edited file before using a command.', 'Inspect the current resource and Pod snapshots before changing configuration.'], solution, examNote: 'Saved source, applied manifests, and Pod snapshots are separate states.', ...(verification ? { dependencies: deps, verification } : {}) })

export const aksConfigGuidedLab = {
  id: 'aks-config-guided', engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 4, labMode: 'guided', skillAreaId: 'containers', service: 'aks', status: 'available',
  manifestId: CONFIG_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true }, initialProjectFiles: CONFIG_FILES, solutionFiles: { ...CONFIG_SOLUTION_FILES, 'k8s/deployment.yaml': deploymentSolution }, initializeSimulation: seedConfigurationGuided,
  stages: [{ id: 'configure', title: 'Configure and verify' }],
  scenarios: {
    'config-baseline': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' } } },
  },
  tasks: [
    support('python-settings', 'Correct the Python PGHOST setting lookup.', configurationSourceReady, { steps: [file('app.py')] }),
    support('image', 'Build and publish the corrected assistant image.', c => !!c.artifacts.publishedTags?.[CONFIG_IMAGE], commands([`az group create -n ${CONFIG_GROUP} -l eastus`, `az acr create -g ${CONFIG_GROUP} -n ${CONFIG_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_REGISTRY} -t assistant:configured .`])),
    support('objects', 'Create AKS and apply the Namespace, ConfigMap and Secret.', c => !!c.runtime.kubernetes?.clusters?.[clusterId]?.resources['ConfigMap/assistant/assistant-config'], { steps: [file('k8s/namespace.yaml'), file('k8s/configmap.yaml'), file('k8s/secret.yaml'), ...[`az aks create -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${CONFIG_REGISTRY}`, `az aks get-credentials -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER}`, 'kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/configmap.yaml', 'kubectl apply -f k8s/secret.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('references', 'Apply the Deployment and Service using ConfigMap, Secret and mounted-file references.', configurationDeploymentReady, { steps: [{ kind: 'file', path: 'k8s/deployment.yaml', content: deploymentSolution }, file('k8s/service.yaml'), ...['kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/service.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('baseline', 'Verify the supplied training answer.', configurationDeploymentReady, { steps: [{ kind: 'scenario', scenarioId: 'config-baseline' }] }, { scenarioId: 'config-baseline', scenarioVersion: 1 }),
    support('stale-env', 'Apply an APP_ENV update and observe that running environment remains captured.', configurationDeploymentReady, { steps: [{ kind: 'inspect' }] }),
    support('env-refresh', 'Restart the Deployment to capture the current environment.', configurationDeploymentReady, commands(['kubectl rollout restart deployment/assistant -n assistant'])),
    support('mounted-before', 'Observe mounted settings before projection.', configurationDeploymentReady, { steps: [{ kind: 'inspect' }] }),
    support('mounted-after', 'Advance the visible projection clock and verify mounted settings.', configurationDeploymentReady, { steps: [{ kind: 'command', line: 'kubectl get pods -n assistant' }, { kind: 'scenario', scenarioId: 'config-baseline' }] }, { scenarioId: 'config-baseline', scenarioVersion: 1 }),
  ],
}

import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { configurationDependencies } from '../../../lib/kubernetes/evidence.js'
import { CONFIG_CLUSTER, CONFIG_GROUP, CONFIG_IMAGE, CONFIG_REGISTRY, configurationDeploymentReady, configurationEnvironmentRefreshed, configurationSourceReady } from './configuration-helpers.js'
import { seedConfigurationGuided } from './configuration-seeds.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONFIG_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONFIG_CLUSTER}`
const deps = configurationDependencies({ clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant' })
const historyDeps = configurationDependencies({ clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant' }, { historical: true })
const file = path => ({ kind: 'file', path, content: CONFIG_SOLUTION_FILES[path] })
const deploymentSolution = CONFIG_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_IMAGE}\n          imagePullPolicy: Always`)
const updatedEnvironment = CONFIG_SOLUTION_FILES['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: training-updated')
const updatedMounted = updatedEnvironment.replace('Training assistant', 'Updated assistant')
const evidence = (context, taskId) => context.evidence?.experimentsById?.[context.evidence?.currentEvidenceByTask?.[taskId]]
const samePod = (context, first, second) => {
  const a = evidence(context, first)?.measurements?.selectedPodUid; const b = evidence(context, second)?.measurements?.selectedPodUid
  return !!a && a === b
}
const staleObserved = context => configurationDeploymentReady(context) && samePod(context, 'baseline', 'stale-env')
const mountedBeforeObserved = context => configurationEnvironmentRefreshed(context) && evidence(context, 'mounted-before')?.measurements?.body?.displayName === 'Training assistant'
const mountedAfterObserved = context => configurationEnvironmentRefreshed(context) && samePod(context, 'mounted-before', 'mounted-after')
const learnerObjectsApplied = context => configurationDeploymentReady(context)
  && ['kubectl apply -f k8s/configmap.yaml', 'kubectl apply -f k8s/secret.yaml'].every(line => context.history?.includes(line))
const mountedBeforeApplied = context => {
  const record = evidence(context, 'mounted-before'); const cluster = context.sandbox.aksClusters?.find(item => item.name === CONFIG_CLUSTER)
  const state = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]; const uid = record?.measurements?.selectedPodUid
  return mountedBeforeObserved(context) && uid && record?.measurements?.body?.displayName === 'Training assistant'
}
const commands = lines => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const support = (id, text, check, solution, verification, dependencies = deps) => ({ id, stageId: 'configure', text, explanation: 'This browser-local exercise uses supplied fictional dependencies and captured Kubernetes configuration.', check, hints: ['Save the edited file before using a command.', 'Inspect the current resource and Pod snapshots before changing configuration.'], solution, examNote: 'Saved source, applied manifests, and Pod snapshots are separate states.', ...(verification ? { dependencies, verification } : {}) })

export const aksConfigGuidedLab = {
  id: 'aks-config-guided', title: 'Configure an AKS Knowledge Assistant', brief: 'Use ConfigMaps, Secrets, captured environments, and projected files to configure a supplied assistant.', minutes: 45, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 4, labMode: 'guided', skillAreaId: 'containers', service: 'aks', status: 'available',
  manifestId: CONFIG_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true }, initialProjectFiles: CONFIG_FILES, solutionFiles: { ...CONFIG_SOLUTION_FILES, 'k8s/deployment.yaml': deploymentSolution }, initializeSimulation: seedConfigurationGuided,
  stages: [{ id: 'understand', title: 'Understand configuration', taskIds: ['python-settings', 'image'] }, { id: 'apply', title: 'Apply and verify', taskIds: ['objects', 'references', 'baseline'] }, { id: 'environment', title: 'Observe environment lifetime', taskIds: ['stale-env', 'env-refresh'] }, { id: 'mounted', title: 'Observe mounted files', taskIds: ['mounted-before', 'mounted-after'] }],
  scenarios: {
    'config-baseline': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' } } },
    'config-stale-env': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } }, expectedCurrentConfig: { APP_ENV: 'training-updated' }, expectedCapturedConfig: { APP_ENV: 'training' } },
    'config-env-refresh': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training-updated', displayName: 'Updated assistant' } }, expectedCurrentConfig: { APP_ENV: 'training-updated' }, expectedCapturedConfig: { APP_ENV: 'training-updated' } },
    'config-mounted-before': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training-updated', displayName: 'Training assistant' } } },
    'config-mounted-after': { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training-updated', displayName: 'Updated assistant' } } },
  },
  tasks: [
    support('python-settings', 'Correct the Python PGHOST setting lookup.', configurationSourceReady, { steps: [file('app.py')] }),
    support('image', 'Build and publish the corrected assistant image.', c => !!c.artifacts.publishedTags?.[CONFIG_IMAGE], commands([`az group create -n ${CONFIG_GROUP} -l eastus`, `az acr create -g ${CONFIG_GROUP} -n ${CONFIG_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_REGISTRY} -t assistant:configured .`])),
    support('objects', 'Save and apply the Namespace, ConfigMap and Secret.', learnerObjectsApplied, { steps: [file('k8s/namespace.yaml'), { kind: 'file', path: 'k8s/configmap.yaml', content: `${CONFIG_SOLUTION_FILES['k8s/configmap.yaml']}\n` }, { kind: 'file', path: 'k8s/secret.yaml', content: `${CONFIG_SOLUTION_FILES['k8s/secret.yaml']}\n` }, ...[`az aks get-credentials -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER}`, 'kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/configmap.yaml', 'kubectl apply -f k8s/secret.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('references', 'Apply the Deployment and Service using ConfigMap, Secret and mounted-file references.', configurationDeploymentReady, { steps: [{ kind: 'file', path: 'k8s/deployment.yaml', content: deploymentSolution }, file('k8s/service.yaml'), ...['kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/service.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('baseline', 'Verify the supplied training answer.', configurationDeploymentReady, { steps: [{ kind: 'scenario', scenarioId: 'config-baseline' }] }, { scenarioId: 'config-baseline', scenarioVersion: 1 }, historyDeps),
    support('stale-env', 'Apply APP_ENV=training-updated and observe that running environment remains captured.', staleObserved, { steps: [{ kind: 'file', path: 'k8s/configmap.yaml', content: updatedEnvironment }, { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, { kind: 'scenario', scenarioId: 'config-stale-env' }] }, { scenarioId: 'config-stale-env', scenarioVersion: 1 }, historyDeps),
    support('env-refresh', 'Restart the Deployment so replacement Pods capture training-updated; final verification follows the file projection.', configurationEnvironmentRefreshed, { steps: [{ kind: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }] }, { scenarioId: 'config-env-refresh', scenarioVersion: 1 }),
    support('mounted-before', 'Apply an updated display_name and record the old mounted file before projection.', mountedBeforeApplied, { steps: [{ kind: 'file', path: 'k8s/configmap.yaml', content: updatedMounted }, { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, { kind: 'scenario', scenarioId: 'config-mounted-before' }] }, { scenarioId: 'config-mounted-before', scenarioVersion: 1 }, historyDeps),
    support('mounted-after', 'Advance 60 simulated seconds and run both final verifications against the projected mounted settings.', mountedAfterObserved, { steps: [{ kind: 'command', line: 'kubectl get pods -n assistant' }, { kind: 'command', resolver: 'advance-config', line: 'Advance 60 simulated seconds' }, { kind: 'scenario', scenarioId: 'config-env-refresh' }, { kind: 'scenario', scenarioId: 'config-mounted-after' }] }, { scenarioId: 'config-mounted-after', scenarioVersion: 1 }),
  ],
  solutionActionResolvers: { 'advance-config': () => ({ type: 'aks-advance', seconds: 60 }) },
}

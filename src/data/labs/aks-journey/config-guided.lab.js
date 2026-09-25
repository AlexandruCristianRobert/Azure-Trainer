import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { configurationDependencies } from '../../../lib/kubernetes/evidence.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
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
const configuredArtifact = context => {
  const id = context.artifacts.publishedTags?.[CONFIG_IMAGE]
  const artifact = id && context.artifacts.buildsById?.[id]
  return artifact?.id === id && artifact.image?.loginServer === `${CONFIG_REGISTRY}.azurecr.io`
    && artifact.image?.repository === 'assistant' && artifact.image?.tag === 'configured'
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, CONFIG_MANIFEST))
    && configurationSourceReady(context) ? artifact : null
}
const referencesReady = context => {
  if (!configurationDeploymentReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const container = deployment?.spec?.template?.spec?.containers?.[0]
  const artifact = configuredArtifact(context)
  const configKeys = ['APP_ENV', 'AI_ENDPOINT', 'ANSWER_DEPLOYMENT', 'EMBEDDING_DEPLOYMENT', 'PGHOST', 'PGDATABASE', 'PGUSER', 'COLLECTION']
  if (!artifact || container?.image !== CONFIG_IMAGE || !configKeys.every(name =>
    container.env?.some(item => item.name === name && item.valueFrom?.configMapKeyRef?.name === 'assistant-config'
      && item.valueFrom.configMapKeyRef.key === name && item.value === undefined))) return false
  if (!container.env?.some(item => item.name === 'PGPASSWORD' && item.valueFrom?.secretKeyRef?.name === 'assistant-credentials'
    && item.valueFrom.secretKeyRef.key === 'PGPASSWORD' && item.value === undefined)) return false
  const mount = container.volumeMounts?.find(item => item.name === 'assistant-settings' && item.mountPath === '/etc/assistant' && item.readOnly === true)
  const volume = deployment.spec.template.spec.volumes?.find(item => item.name === 'assistant-settings'
    && item.configMap?.name === 'assistant-config' && item.configMap.items?.some(entry => entry.key === 'settings.json' && entry.path === 'settings.json'))
  const pods = getDeploymentPods({ runtime: context.runtime }, clusterId, 'assistant', 'assistant')
  return !!mount && !!volume && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.artifactId === artifact.id)
}
const learnerObjectsApplied = context => {
  const cluster = context.sandbox.aksClusters?.find(item => item.name === CONFIG_CLUSTER)
  const state = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]
  const config = state?.resources['ConfigMap/assistant/assistant-config']; const secret = state?.resources['Secret/assistant/assistant-credentials']
  const parsedConfig = parseKubernetesYaml(context.project.savedFiles['k8s/configmap.yaml'] ?? '', 'k8s/configmap.yaml')
  const parsedSecret = parseKubernetesYaml(context.project.savedFiles['k8s/secret.yaml'] ?? '', 'k8s/secret.yaml')
  const savedConfig = parsedConfig.diagnostics.length ? null : parsedConfig.documents[0]
  const savedSecret = parsedSecret.diagnostics.length ? null : parsedSecret.documents[0]
  const expected = parseKubernetesYaml(CONFIG_SOLUTION_FILES['k8s/configmap.yaml'], 'k8s/configmap.yaml').documents[0].data
  const settings = (() => { try { return JSON.parse(config?.data?.['settings.json'] ?? '') } catch { return null } })()
  return config?.metadata?.namespace === 'assistant' && secret?.metadata?.namespace === 'assistant'
    && ['training', 'training-updated'].includes(config.data?.APP_ENV)
    && Object.keys(config.data ?? {}).sort().join(',') === Object.keys(expected).sort().join(',')
    && Object.entries(expected).every(([key, value]) => ['APP_ENV', 'settings.json'].includes(key) || config.data[key] === value)
    && ['Training assistant', 'Updated assistant'].includes(settings?.display_name) && settings?.response_prefix === ''
    && savedConfig?.kind === 'ConfigMap' && canonicalize(savedConfig.data) === canonicalize(config.data)
    && secret?.type === 'Opaque' && secret.data?.PGPASSWORD === 'dHJhaW5pbmctb25seS1wYXNzd29yZA=='
    && savedSecret?.kind === 'Secret' && (savedSecret.stringData?.PGPASSWORD === 'training-only-password'
      || savedSecret.data?.PGPASSWORD === secret.data.PGPASSWORD)
    && ['kubectl apply -f k8s/configmap.yaml', 'kubectl apply -f k8s/secret.yaml'].every(line => context.history?.includes(line))
}
const mountedBeforeApplied = context => {
  const record = evidence(context, 'mounted-before')
  return mountedBeforeObserved(context) && !!record?.measurements?.selectedPodUid
    && record.measurements.projectionPending === true && record.measurements.mountedConfigMismatch === true
}
const commands = lines => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const teaching = {
  'python-settings': ['Read configuration at request time; the supplied downstream services are fictional fixtures.', 'Use PGHOST, not a literal endpoint.', 'Code changes need a new image build.'],
  image: ['A build captures saved Python files into an immutable artifact.', 'The seeded image cannot satisfy a new source build.', 'Publishing never changes a running Pod.'],
  objects: ['ConfigMaps hold ordinary settings; Secrets hold fictional credentials encoded as base64.', 'Objects are namespace-scoped and must be applied from saved YAML.', 'Describe exposes Secret key names, not values.'],
  references: ['Use key references and a read-only mounted settings file instead of literal credentials.', 'ConfigMap and Secret references resolve only in the Pod namespace.', 'Saved manifests, applied objects, and captured Pods are distinct.'],
  baseline: ['The answer comes from the supplied fixture adapter, not a live service.', 'Inspect its redacted trace and named source.', 'A request verifies captured runtime state.'],
  'stale-env': ['Applying a ConfigMap does not mutate an existing Pod environment.', 'Compare current applied APP_ENV with the captured Pod value.', 'A stale environment observation is historical evidence.'],
  'env-refresh': ['Replacement Pods capture current environment values.', 'Restart is required after an environment-backed update.', 'Mounted files have a separate projection delay.'],
  'mounted-before': ['Mounted ConfigMap files update on the visible 60-second teaching interval.', 'The supplied Python settings reader rereads JSON per request.', 'Observe old projected content before advancing time.'],
  'mounted-after': ['Advance only the local AKS clock; reads do not advance it.', 'Verify both final environment and projected-file results.', 'The same Pod UID proves file projection rather than restart.'],
}
const stageFor = id => ['python-settings', 'image'].includes(id) ? 'understand'
  : ['objects', 'references', 'baseline'].includes(id) ? 'apply'
    : ['stale-env', 'env-refresh'].includes(id) ? 'environment' : 'mounted'
const support = (id, text, check, solution, verification, dependencies = deps) => { const [explanation, hint, examNote] = teaching[id]; return ({ id, stageId: stageFor(id), text, explanation, check, hints: [hint, 'Save the edited file before using a command.'], solution, examNote, ...(verification ? { dependencies, verification } : {}) }) }

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
    support('image', 'Build and publish the corrected assistant image.', c => !!configuredArtifact(c), commands([`az group create -n ${CONFIG_GROUP} -l eastus`, `az acr create -g ${CONFIG_GROUP} -n ${CONFIG_REGISTRY} --sku Basic`, `az acr build -r ${CONFIG_REGISTRY} -t assistant:configured .`])),
    support('objects', 'Save and apply the Namespace, ConfigMap and Secret.', learnerObjectsApplied, { steps: [file('k8s/namespace.yaml'), { kind: 'file', path: 'k8s/configmap.yaml', content: `${CONFIG_SOLUTION_FILES['k8s/configmap.yaml']}\n` }, { kind: 'file', path: 'k8s/secret.yaml', content: `${CONFIG_SOLUTION_FILES['k8s/secret.yaml']}\n` }, ...[`az aks get-credentials -g ${CONFIG_GROUP} -n ${CONFIG_CLUSTER}`, 'kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/configmap.yaml', 'kubectl apply -f k8s/secret.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('references', 'Apply the Deployment and Service using ConfigMap, Secret and mounted-file references.', referencesReady, { steps: [{ kind: 'file', path: 'k8s/deployment.yaml', content: deploymentSolution }, file('k8s/service.yaml'), ...['kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/service.yaml'].map(line => ({ kind: 'command', line }))] }),
    support('baseline', 'Verify the supplied training answer.', configurationDeploymentReady, { steps: [{ kind: 'scenario', scenarioId: 'config-baseline' }] }, { scenarioId: 'config-baseline', scenarioVersion: 1 }, historyDeps),
    support('stale-env', 'Apply APP_ENV=training-updated and observe that running environment remains captured.', staleObserved, { steps: [{ kind: 'file', path: 'k8s/configmap.yaml', content: updatedEnvironment }, { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, { kind: 'scenario', scenarioId: 'config-stale-env' }] }, { scenarioId: 'config-stale-env', scenarioVersion: 1 }, historyDeps),
    support('env-refresh', 'Restart the Deployment so replacement Pods capture training-updated; final verification follows the file projection.', configurationEnvironmentRefreshed, { steps: [{ kind: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }] }, { scenarioId: 'config-env-refresh', scenarioVersion: 1 }),
    support('mounted-before', 'Apply an updated display_name and record the old mounted file before projection.', mountedBeforeApplied, { steps: [{ kind: 'file', path: 'k8s/configmap.yaml', content: updatedMounted }, { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, { kind: 'scenario', scenarioId: 'config-mounted-before' }] }, { scenarioId: 'config-mounted-before', scenarioVersion: 1 }, historyDeps),
    support('mounted-after', 'Advance 60 simulated seconds and run both final verifications against the projected mounted settings.', mountedAfterObserved, { steps: [{ kind: 'command', line: 'kubectl get pods -n assistant' }, { kind: 'command', resolver: 'advance-config', line: 'Advance 60 simulated seconds' }, { kind: 'scenario', scenarioId: 'config-env-refresh' }, { kind: 'scenario', scenarioId: 'config-mounted-after' }] }, { scenarioId: 'config-mounted-after', scenarioVersion: 1 }),
  ],
  solutionActionResolvers: { 'advance-config': () => ({ type: 'aks-advance', seconds: 60 }) },
}

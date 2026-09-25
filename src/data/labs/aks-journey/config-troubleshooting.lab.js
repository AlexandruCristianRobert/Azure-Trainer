import { CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { configurationDependencies, kubernetesDependencies } from '../../../lib/kubernetes/evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { validateKubernetesObject } from '../../../lib/kubernetes/schema.js'
import { CONFIG_TROUBLESHOOTING_CLUSTER_ID, CONFIG_TROUBLESHOOTING_IMAGE } from './config-incidents.js'
import { CONFIG_TROUBLESHOOTING_PROJECT_FILES, seedConfigurationTroubleshooting } from './configuration-troubleshooting-seeds.js'

const target = { clusterId: CONFIG_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }
const historicalDependencies = configurationDependencies(target, { historical: true })
const liveDependencies = kubernetesDependencies(target.clusterId, target.namespace, target.deploymentName, target.serviceName, { sourceSensitive: true })
const file = path => ({ kind: 'file', path, content: CONFIG_SOLUTION_FILES[path] })
const deploymentSolution = CONFIG_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksconfigguided.azurecr.io/assistant:starter', `${CONFIG_TROUBLESHOOTING_IMAGE}\n          imagePullPolicy: Always`)
const request = (question = 'How long are backups kept?') => ({ method: 'POST', path: '/api/ask', body: { question } })
const expectedAnswer = (environment = 'training') => ({ answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment, displayName: 'Training assistant' })
const evidence = (context, taskId) => context.evidence?.experimentsById?.[context.evidence?.currentEvidenceByTask?.[taskId]]
const evidenceAfterPhase = (context, taskId, scenarioId, phase) => {
  const record = evidence(context, taskId)
  const entry = context.runtime.kubernetes?.configIncident?.transitions?.find(item => item.to === phase)
  return record?.outcome === 'passed' && record.completed === true && record.scenarioId === scenarioId
    && record.labId === 'aks-config-troubleshooting' && record.sequence > (entry?.sequence ?? 0) ? record : null
}
const historicalEvidenceAfterPhase = (context, taskId, scenarioId, phase) => {
  const entry = context.runtime.kubernetes?.configIncident?.transitions?.find(item => item.to === phase)
  return Object.values(context.evidence?.experimentsById ?? {}).find(record => record.taskId === taskId
    && record.labId === 'aks-config-troubleshooting' && record.scenarioId === scenarioId
    && record.outcome === 'passed' && record.completed === true && record.sequence > (entry?.sequence ?? 0)) ?? null
}
const phasePassed = (context, taskId, scenarioId) => {
  const phase = taskId === 'repair-reference' ? 'reference' : 'key'
  const leaving = context.runtime.kubernetes?.configIncident?.transitions?.find(item => item.from === phase)
  const id = leaving?.evidenceId ?? context.evidence?.currentEvidenceByTask?.[taskId]
  const record = id && context.evidence?.experimentsById?.[id]
  const entry = context.runtime.kubernetes?.configIncident?.transitions?.find(item => item.to === phase)
  return record?.id === id && record.taskId === taskId && record.labId === 'aks-config-troubleshooting'
    && record.outcome === 'passed' && record.completed === true && record.scenarioId === scenarioId
    && record.sequence > (entry?.sequence ?? 0)
}
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
function manifestsMatch(context) {
  const state = context.runtime.kubernetes?.clusters?.[target.clusterId]
  if (!state) return false
  for (const [path, kind] of [['k8s/configmap.yaml', 'ConfigMap'], ['k8s/secret.yaml', 'Secret'], ['k8s/deployment.yaml', 'Deployment']]) {
    const parsed = parseKubernetesYaml(context.project.savedFiles[path], path)
    if (parsed.diagnostics.length || parsed.documents.length !== 1) return false
    const expected = validateKubernetesObject(parsed.documents[0], { namespace: 'assistant', capabilities: { deployments: [], kubernetesConfiguration: true } })
    if (expected.diagnostics.length) return false
    const object = expected.object
    const actual = state.resources[`${kind}/assistant/${object.metadata.name}`]
    if (!actual || actual.metadata.namespace !== object.metadata.namespace || canonical(actual.metadata.labels ?? {}) !== canonical(object.metadata.labels ?? {})) return false
    if (kind === 'Deployment') {
      const desired = structuredClone(object.spec); const applied = structuredClone(actual.spec)
      delete desired.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at']
      delete applied.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at']
      if (!Object.keys(desired.template.metadata.annotations ?? {}).length) delete desired.template.metadata.annotations
      if (!Object.keys(applied.template.metadata.annotations ?? {}).length) delete applied.template.metadata.annotations
      if (canonical(desired) !== canonical(applied)) return false
    } else if (canonical(actual.data ?? {}) !== canonical(object.data ?? {}) || kind === 'Secret' && actual.type !== object.type) return false
  }
  return true
}
const ready = (context, current = false) => {
  const state = context.runtime.kubernetes?.clusters?.[target.clusterId]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const service = state?.resources['Service/assistant/assistant']
  const config = state?.resources['ConfigMap/assistant/assistant-config']
  const secret = state?.resources['Secret/assistant/assistant-credentials']
  const pods = getDeploymentPods({ runtime: context.runtime }, target.clusterId, 'assistant', 'assistant')
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[CONFIG_TROUBLESHOOTING_IMAGE]
  const refs = deployment?.spec?.template?.spec?.containers?.[0]?.env ?? []
  return !!deployment && !!service && !!config && !!secret && image === CONFIG_TROUBLESHOOTING_IMAGE && !!artifactId
    && pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running' && !!state.podSnapshots[pod.metadata.uid])
    && refs.some(item => item.name === 'PGDATABASE' && item.valueFrom?.configMapKeyRef?.name === 'assistant-config' && item.valueFrom.configMapKeyRef.key === 'PGDATABASE')
    && refs.some(item => item.name === 'PGPASSWORD' && item.valueFrom?.secretKeyRef?.name === 'assistant-credentials' && item.valueFrom.secretKeyRef.key === 'PGPASSWORD')
    && (!current || (config.data.APP_ENV === 'training-updated' && config.data.PGDATABASE === 'knowledge'
      && pods.every(pod => state.podSnapshots[pod.metadata.uid].environment.APP_ENV === 'training-updated')))
}
const scenario = (expected, extras = {}) => ({ kind: 'aks-request', version: 1, target, request: request(), expected: { status: 200, body: expected }, ...extras })
const task = (id, text, check, scenarioId, solution, dependencies = historicalDependencies) => ({ id, text,
  explanation: 'The assistant, fictional PostgreSQL settings, documents and answers are supplied fixtures. Compare the saved manifest, applied objects, Pod events and captured environment to identify each failure.',
  hints: ['Check the namespace and key named by each Pod configuration event.', 'Compare applied ConfigMap values with the environment captured by the running Pods.'],
  solution: { steps: solution }, examNote: 'A correct manifest must be saved and applied; environment changes require replacement Pods.', check,
  ...(scenarioId ? { verification: { scenarioId, scenarioVersion: 1 }, dependencies } : {}) })

export const aksConfigTroubleshootingLab = {
  id: 'aks-config-troubleshooting', title: 'Diagnose AKS configuration incidents',
  brief: `The supplied Knowledge Assistant image is healthy, but its Pods cannot start. The cluster contains assistant-config in namespace decoy while the Deployment requests it in assistant. Inspect the Pending Pod events and the applied objects, repair the saved ConfigMap manifest, apply it, and verify the supplied training answer.\n\nAfter a passing recovery check, use Continue incident to reveal the next controlled fault. One phase removes PGDATABASE and restarts the Deployment. The final phase applies APP_ENV=training-updated without restarting Pods, so the ConfigMap and captured Pod environment disagree. Diagnose each symptom using events and request evidence, and continue only after the current phase is verified.\n\nThis is a browser-local simulation. The image, fictional credentials, PostgreSQL database, documents, vectors and model answers are supplied; no downstream service is provisioned or called.`,
  minutes: 40, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 5,
  labMode: 'troubleshooting', skillAreaId: 'containers', service: 'aks', status: 'unavailable', manifestId: CONFIG_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true }, initialProjectFiles: CONFIG_TROUBLESHOOTING_PROJECT_FILES,
  solutionFiles: { ...CONFIG_SOLUTION_FILES, 'k8s/deployment.yaml': deploymentSolution }, initializeSimulation: seedConfigurationTroubleshooting,
  scenarios: {
    'config-reference-recovered': scenario(expectedAnswer()),
    'config-key-recovered': scenario(expectedAnswer()),
    'config-stale-observed': { kind: 'aks-request', version: 1, target, request: { method: 'GET', path: '/api/info' },
      expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } },
      expectedCurrentConfig: { APP_ENV: 'training-updated' }, expectedCapturedConfig: { APP_ENV: 'training' } },
    'config-final-recovered': scenario(expectedAnswer('training-updated')),
  },
  tasks: [
    task('repair-reference', 'Repair the missing assistant namespace reference and confirm the training answer.',
      context => phasePassed(context, 'repair-reference', 'config-reference-recovered'), 'config-reference-recovered', [
        file('k8s/configmap.yaml'), { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' },
        { kind: 'scenario', scenarioId: 'config-reference-recovered' },
        { kind: 'command', resolver: 'continue-config-incident', line: 'Continue to the missing-key incident' },
      ]),
    task('repair-key', 'Restore the missing PGDATABASE key, apply it, and confirm the service recovers.',
      context => phasePassed(context, 'repair-key', 'config-key-recovered'), 'config-key-recovered', [
        file('k8s/configmap.yaml'), { kind: 'command', line: 'kubectl apply -f k8s/configmap.yaml' },
        { kind: 'scenario', scenarioId: 'config-key-recovered' },
        { kind: 'command', resolver: 'continue-config-incident', line: 'Continue to the stale-environment incident' },
      ]),
    task('observe-stale', 'Record the applied APP_ENV and the older value captured by the running Pods.',
      context => historicalEvidenceAfterPhase(context, 'observe-stale', 'config-stale-observed', 'stale')?.measurements?.currentConfigMatches === true
        && historicalEvidenceAfterPhase(context, 'observe-stale', 'config-stale-observed', 'stale')?.measurements?.capturedConfigMatches === true,
      'config-stale-observed', [
          { kind: 'scenario', scenarioId: 'config-stale-observed' },
        ]),
    task('recover-final', 'Restart the Deployment so replacement Pods capture training-updated, then confirm the answer.',
      context => ready(context, true) && !!evidenceAfterPhase(context, 'recover-final', 'config-final-recovered', 'stale'), 'config-final-recovered', [
        { kind: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' },
        { kind: 'scenario', scenarioId: 'config-final-recovered' },
      ], liveDependencies),
    task('reproducible-files', 'Confirm saved, applied and captured configuration now agree and the Secret reference remains intact.',
      context => ready(context, true) && manifestsMatch(context)
        && ['k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml'].every(path => context.project.savedFiles[path] === context.project.draftFiles[path]),
      null, [ { kind: 'inspect', target: 'aks/configuration' } ], liveDependencies),
  ],
  solutionActionResolvers: { 'continue-config-incident': () => ({ type: 'aks-config-next-incident' }) },
}

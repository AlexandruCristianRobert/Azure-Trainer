import { CONNECTIVITY_FILES, CONNECTIVITY_MANIFEST, CONNECTIVITY_SOLUTION_FILES } from '../../templates/aks-python/connectivity.js'
import { connectivityDependencies } from '../../../lib/kubernetes/evidence.js'
import { CONNECTIVITY_TROUBLESHOOTING_CLUSTER, CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, CONNECTIVITY_TROUBLESHOOTING_GROUP, CONNECTIVITY_TROUBLESHOOTING_IMAGE, CONNECTIVITY_TROUBLESHOOTING_LAB_ID, CONNECTIVITY_TROUBLESHOOTING_REGISTRY } from './connectivity-troubleshooting-incidents.js'
import { seedConnectivityTroubleshooting } from './connectivity-seeds.js'
import { connectivityScenario } from './connectivity-helpers.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'

const clusterId = CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID
const target = { clusterId, namespace: 'assistant', serviceName: 'assistant-internal', deploymentName: 'assistant' }
const historical = connectivityDependencies(target, { historical: true })
const live = connectivityDependencies(target)
const internalOrigin = { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }
const info = { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } }
const answer = { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' }
const question = { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }
const healthyInternal = id => connectivityScenario({ clusterId, serviceName: 'assistant-internal', origin: internalOrigin,
  hostname: 'assistant-internal.assistant', expected: info })
const healthyExternal = id => connectivityScenario({ clusterId, serviceName: 'assistant-public', origin: { kind: 'external' }, expected: info })
const requestScenario = (serviceName, origin, hostname, expected, method = 'GET', path = '/api/info', body = null) => ({
  kind: 'aks-request', version: 1, target: { ...target, serviceName }, request: { method, path, ...(body ? { body } : {}) }, expected,
  connectivity: origin.kind === 'external' ? { origin, port: 80, service: { namespace: 'assistant', name: serviceName } }
    : { origin, hostname, port: 80 },
})
const getFailure = (reason, selectedCount) => ({ status: null, body: null, transport: { ok: false, reason }, route: { selectedCount } })
const recordFor = (context, taskId) => context.evidence?.experimentsById?.[context.evidence?.currentEvidenceByTask?.[taskId]]
const phaseRecord = (context, field, phase) => {
  const incident = context.runtime.kubernetes?.clusters?.[clusterId]?.connectivity?.incident
  const id = incident?.[field]?.[phase]
  const record = id && context.evidence?.experimentsById?.[id]
  const taskId = phase === 'selector' ? field === 'observations' ? 'observe-selector' : 'repair-selector'
    : phase === 'port' ? field === 'observations' ? 'observe-port' : 'repair-port'
      : field === 'observations' ? 'observe-dependency' : 'repair-dependency'
  const scenarioId = phase === 'selector' ? field === 'observations' ? 'trouble-selector-failure' : 'trouble-selector-recovered'
    : phase === 'port' ? field === 'observations' ? 'trouble-port-failure' : 'trouble-port-recovered'
      : 'trouble-dependency-failure'
  return record?.id === id && record.taskId === taskId && record.scenarioId === scenarioId && record.outcome === 'passed' ? record : null
}
const observationPassed = (phase, routeCheck) => context => {
  const record = phaseRecord(context, 'observations', phase)
  return !!record && routeCheck(record.measurements)
}
const recoveryPassed = phase => context => !!phaseRecord(context, 'recoveries', phase)
const fileStep = path => ({ kind: 'file', path, content: CONNECTIVITY_SOLUTION_FILES[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const nextIncident = phase => ({ kind: 'command', resolver: 'next-connectivity-incident', line: `Introduce the ${phase} connectivity fault` })
const finalAnswer = (serviceName, origin, hostname) => requestScenario(serviceName, origin, hostname, { status: 200, body: answer }, 'POST', '/api/ask', question.body)
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)

const troubleshootingTask = ({ id, text, explanation, hints, examNote, check, steps, scenarioId, dependencies = historical }) => ({
  id, stageId: 'investigate', text, explanation, hints, examNote, check, solution: { steps }, dependencies,
  ...(scenarioId ? { verification: { scenarioId, scenarioVersion: 1 } } : {}),
})

const selectorService = CONNECTIVITY_SOLUTION_FILES['k8s/service-internal.yaml']
const configMap = CONNECTIVITY_FILES['k8s/configmap.yaml']

export const aksConnectivityTroubleshootingLab = {
  id: CONNECTIVITY_TROUBLESHOOTING_LAB_ID, title: 'Troubleshoot AKS connectivity by hop',
  brief: `The supplied assistant has two configured, ready Pods and a healthy public Service. The internal Service begins with a selector typo, so internal DNS can resolve the Service while no Pod is selected. Diagnose the failed hop from request evidence before repairing the saved Service manifest.\n\nAfter each observed fault is repaired and verified, use the visible Introduce next connectivity fault control. The next phase changes the internal targetPort to 8081 while keeping ready endpoints. The final incident changes PGHOST and restarts the assistant, so requests reach the application but its supplied PostgreSQL fixture fails. Repair saved files, apply them, and restart when configuration is captured by the Pods. Finish by proving the complete supplied answer through both internal and public Services.\n\nUse kubectl get endpointslices, kubectl describe service, kubectl exec with the supplied diagnostics Pod, and kubectl logs with an actual assistant Pod name to inspect each hop. This browser-local exercise has no real cluster or external dependency services.`,
  minutes: 40, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 8,
  labMode: 'troubleshooting', skillAreaId: 'containers', service: 'aks', status: 'unavailable', manifestId: CONNECTIVITY_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true },
  initialProjectFiles: { ...CONNECTIVITY_FILES, 'k8s/service-internal.yaml': `apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-internal\n  namespace: assistant\nspec:\n  type: ClusterIP\n  selector:\n    app: assistnat\n  ports:\n    - protocol: TCP\n      port: 80\n      targetPort: http\n` },
  solutionFiles: CONNECTIVITY_SOLUTION_FILES, initializeSimulation: seedConnectivityTroubleshooting,
  stages: [{ id: 'investigate', title: 'Trace selector, port and dependency failures', taskIds: ['observe-selector', 'repair-selector', 'observe-port', 'repair-port', 'observe-dependency', 'repair-dependency', 'final-internal', 'final-external'] }],
  scenarios: {
    'trouble-selector-failure': requestScenario('assistant-internal', internalOrigin, 'assistant-internal.assistant', getFailure('NO_READY_ENDPOINTS', 0)),
    'trouble-selector-recovered': healthyInternal('trouble-selector-recovered'),
    'trouble-port-failure': requestScenario('assistant-internal', internalOrigin, 'assistant-internal.assistant', getFailure('CONNECTION_REFUSED', 2)),
    'trouble-port-recovered': healthyInternal('trouble-port-recovered'),
    'trouble-dependency-failure': requestScenario('assistant-internal', internalOrigin, 'assistant-internal.assistant', { status: 503, body: { error: 'The supplied assistant dependency is unavailable.' } }, 'POST', '/api/ask', question.body),
    'trouble-network-internal-final': finalAnswer('assistant-internal', internalOrigin, 'assistant-internal.assistant'),
    'trouble-network-external-final': finalAnswer('assistant-public', { kind: 'external' }, null),
  },
  tasks: [
    troubleshootingTask({ id: 'observe-selector', text: 'Compare a healthy public request with the failing internal request. Identify whether DNS, selection, or the application failed.',
      explanation: 'Resolve the internal Service name, inspect its EndpointSlice, and compare the request trace with the healthy public route. A selector failure reaches no application handler and creates no application log.',
      hints: ['Run the internal failure verification and inspect selectedCount in the route evidence.', 'Use kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml.'],
      examNote: 'A resolvable Service name can still have no selected ready endpoints; this produces no HTTP response or application log.',
      check: observationPassed('selector', m => m?.transport?.reason === 'NO_READY_ENDPOINTS' && m.route?.selectedCount === 0 && m.selectedPodUid === null),
      scenarioId: 'trouble-selector-failure', dependencies: historical,
      steps: [...commands('kubectl describe service assistant-internal -n assistant', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml'), { kind: 'scenario', scenarioId: 'trouble-selector-failure' }] }),
    troubleshootingTask({ id: 'repair-selector', text: 'Correct and apply the internal Service selector, then verify its info endpoint.',
      explanation: 'Selectors match labels on same-namespace Pods. The supplied Pods use app=assistant; restoring that exact label creates ready endpoints.',
      hints: ['Keep the ClusterIP type and port 80 to named backend port http.', 'After applying the saved file, verify GET /api/info and inspect the selected Pod.'],
      examNote: 'Repair the saved manifest and apply it. A passing request proves the listener is reached.',
      check: recoveryPassed('selector'), scenarioId: 'trouble-selector-recovered',
      steps: [fileStep('k8s/service-internal.yaml'), ...commands('kubectl apply -f k8s/service-internal.yaml', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml'), { kind: 'scenario', scenarioId: 'trouble-selector-recovered' }] }),
    troubleshootingTask({ id: 'observe-port', text: 'Introduce the next incident, then distinguish an unreachable target port from an empty selector.',
      explanation: 'The controlled fault keeps both ready endpoints but changes their resolved backend port to 8081. The Python image still listens at 8080.',
      hints: ['Use Introduce next connectivity fault after the selector recovery is recorded.', 'Inspect the EndpointSlice ports and the request transport reason.'],
      examNote: 'Ready endpoints at a numeric targetPort do not prove the process listens on that port.',
      check: observationPassed('port', m => m?.transport?.reason === 'CONNECTION_REFUSED' && m.route?.selectedCount === 2 && m.route?.readyEndpointUids?.length === 2 && m.targetPort === 8081),
      scenarioId: 'trouble-port-failure', dependencies: historical,
      steps: [nextIncident('port'), ...commands('kubectl describe service assistant-internal -n assistant', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml'), { kind: 'scenario', scenarioId: 'trouble-port-failure' }] }),
    troubleshootingTask({ id: 'repair-port', text: 'Restore the Service targetPort to the supplied named http port, apply it, and prove the internal info route.',
      explanation: 'The captured assistant listener and named container port are both 8080. Reusing targetPort http lets the Service resolve the backend port per Pod.',
      hints: ['Set targetPort to http or numeric 8080.', 'Apply the saved Service and run the recovered internal info scenario.'],
      examNote: 'The Service public port and Pod listener port are distinct; targetPort connects them.',
      check: recoveryPassed('port'), scenarioId: 'trouble-port-recovered',
      steps: [fileStep('k8s/service-internal.yaml'), ...commands('kubectl apply -f k8s/service-internal.yaml', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml'), { kind: 'scenario', scenarioId: 'trouble-port-recovered' }] }),
    troubleshootingTask({ id: 'observe-dependency', text: 'Introduce the dependency incident and trace a supplied question to the failed PostgreSQL operation.',
      explanation: 'The injected ConfigMap fault is applied and the Deployment restarted. A connected request should reach the Python handler, succeed at embedding, then fail the PostgreSQL fixture lookup.',
      hints: ['Advance only after a passing port-failure observation and recovered internal request.', 'Look for HTTP 503 with transport success and the failed postgres-query operation.'],
      examNote: 'A downstream dependency failure occurs after a successful client-to-Pod route and leaves a correlated application log.',
      check: observationPassed('dependency', m => m?.status === 503 && m.transport?.ok === true && m.route?.podUid && m.dependencyTrace?.[0]?.operation === 'embedding' && m.dependencyTrace?.[0]?.status === 'succeeded' && m.dependencyTrace?.some(op => op.operation === 'postgres-query' && op.status === 'failed' && op.reason === 'DNS_NOT_FOUND')),
      scenarioId: 'trouble-dependency-failure', dependencies: historical,
      steps: [nextIncident('dependency'), ...commands('kubectl describe service assistant-internal -n assistant', 'kubectl get pods -n assistant --show-labels'), { kind: 'scenario', scenarioId: 'trouble-dependency-failure' }] }),
    troubleshootingTask({ id: 'repair-dependency', text: 'Restore PGHOST in the saved ConfigMap, apply it, and restart the Deployment so Pods capture the healthy value.',
      explanation: 'The applied ConfigMap and saved file must agree, and replacement Pods must capture pg-training.example. The Secret remains referenced through its existing key.',
      hints: ['Compare saved ConfigMap values with kubectl get configmap assistant-config -n assistant -o yaml.', 'Environment variables are captured when Pods start; apply the repaired ConfigMap, then rollout restart.'],
      examNote: 'Applying a ConfigMap does not refresh environment variables inside existing Pods; restart the Deployment.',
      check: context => {
        const run = context.run ?? context
        const state = run.runtime.kubernetes.clusters?.[clusterId]
        const config = state?.resources['ConfigMap/assistant/assistant-config']
        const parsed = parseKubernetesYaml(run.project.savedFiles['k8s/configmap.yaml'], 'k8s/configmap.yaml')
        const desired = parsed.diagnostics.length === 0 && parsed.documents.length === 1 ? parsed.documents[0] : null
        const deployment = state?.resources['Deployment/assistant/assistant']
        const pods = Object.values(state?.resources ?? {}).filter(pod => pod.kind === 'Pod' && pod.metadata.namespace === 'assistant' && pod.metadata.labels?.['app'] === 'assistant')
        return config?.data?.PGHOST === 'pg-training.example' && desired?.kind === 'ConfigMap' && desired.metadata?.name === 'assistant-config'
          && desired.metadata?.namespace === 'assistant' && canonical(desired.data) === canonical(config.data)
          && run.project.savedFiles['k8s/configmap.yaml'] === run.project.draftFiles['k8s/configmap.yaml'] && deployment?.spec?.replicas === 2 && pods.length === 2
          && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.environment?.PGHOST === 'pg-training.example')
      }, dependencies: live,
      steps: [{ kind: 'file', path: 'k8s/configmap.yaml', content: configMap }, ...commands('kubectl apply -f k8s/configmap.yaml', 'kubectl rollout restart deployment/assistant -n assistant', 'kubectl get pods -n assistant --show-labels')] }),
    troubleshootingTask({ id: 'final-internal', text: 'Prove the complete training answer through assistant-internal and inspect the matching application log.',
      explanation: 'The final proof must route to a ready assistant Pod, return the supplied training-backups answer, and complete the embedding, PostgreSQL, and answer operations.',
      hints: ['Use POST /api/ask with the supplied backups question through assistant-internal.', 'Verify the named internal final scenario after the repaired Pods are ready.'],
      examNote: 'Confirm both the Service route and the application response; successful DNS alone is insufficient.',
      check: context => { const r = recordFor(context, 'final-internal'); return r?.outcome === 'passed' && r.measurements?.transport?.ok === true && r.measurements?.route?.serviceName === 'assistant-internal' && r.measurements?.dependencyTrace?.length === 3 },
      scenarioId: 'trouble-network-internal-final', dependencies: live,
      steps: [...commands(`kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant:80/api/ask`), { kind: 'scenario', scenarioId: 'trouble-network-internal-final' }] }),
    troubleshootingTask({ id: 'final-external', text: 'Prove the same complete training answer through the allocated public LoadBalancer Service.',
      explanation: 'The public Service must retain its healthy selector and allocated external address while the internal Service remains repaired.',
      hints: ['Inspect assistant-public and its LoadBalancer address with kubectl get services -n assistant -o wide.', 'Run the declared external final verification; it resolves the current address from the Service.'],
      examNote: 'An external request must use the LoadBalancer Service address, while the internal route uses cluster DNS.',
      check: context => { const r = recordFor(context, 'final-external'); return r?.outcome === 'passed' && r.measurements?.transport?.ok === true && r.measurements?.serviceName === 'assistant-public' && r.measurements?.dependencyTrace?.length === 3 },
      scenarioId: 'trouble-network-external-final', dependencies: connectivityDependencies({ ...target, serviceName: 'assistant-public' }),
      steps: [...commands('kubectl get services -n assistant -o wide'), { kind: 'scenario', scenarioId: 'trouble-network-external-final' }] }),
  ],
  solutionActionResolvers: { 'next-connectivity-incident': () => ({ type: 'aks-connectivity-next-incident' }) },
}

export { CONNECTIVITY_TROUBLESHOOTING_CLUSTER, CONNECTIVITY_TROUBLESHOOTING_GROUP, CONNECTIVITY_TROUBLESHOOTING_IMAGE, CONNECTIVITY_TROUBLESHOOTING_REGISTRY }

import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { DIAGNOSIS_MANIFEST } from '../../templates/aks-python/diagnosis.js'
import { diagnosisTask, diagnosisPodAction, diagnosisLoggingPassed, diagnosisRolloutHealthy } from './diagnosis-helpers.js'
import { createDiagnosisSeed, DIAGNOSIS_GROUP, DIAGNOSIS_CLUSTER, DIAGNOSIS_REGISTRY, DIAGNOSIS_GUIDED_FILES, DIAGNOSIS_GUIDED_SOLUTION_FILES as files } from './diagnosis-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${DIAGNOSIS_GROUP}/providers/Microsoft.ContainerService/managedClusters/${DIAGNOSIS_CLUSTER}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' }
const external = { ...target, serviceName: 'assistant-external' }
const command = line => ({ kind: 'command', line })
const commands = (...lines) => lines.map(command)
const file = path => ({ kind: 'file', path, content: files[path] })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const control = action => ({ kind: 'scenario', scenarioId: 'incident', control: action,
  instruction: `${action === 'start' ? 'Start diagnosis' : 'Advance diagnosis phase'} in Experiments; the native control refuses skipped failure or repair evidence.` })
const advance = seconds => ({ kind: 'advance', seconds })
const inspect = instruction => ({ kind: 'inspect', instruction })
const pod = (resolver, instruction, line) => ({ kind: 'command', resolver, instruction, line })
const healthy = { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '2.0' } }
const request = (expected = healthy, final = false, externalCase = false) => ({ kind: 'aks-request', version: 1, target: externalCase ? external : target,
  request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected,
  connectivity: externalCase ? { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 }
    : { origin: { kind: 'diagnostic', name: 'diagnostics', namespace: 'diagnostics' }, hostname: 'assistant-internal.assistant', port: 80 },
  ...(final ? { requireTwoReplicas: true } : {}) })
const transportFailure = { status: null, body: null, transport: { ok: false, reason: 'NO_READY_ENDPOINTS' } }
const configPath = 'k8s/configmap.yaml', deploymentPath = 'k8s/deployment.yaml', servicePath = 'k8s/service-internal.yaml'
const phase = (id, path, after, restart = false) => ({ id, edits: [{ path, before: files[path], after }],
  commands: [`kubectl apply -f ${path}`, ...(restart ? ['kubectl rollout restart deployment/assistant-api -n assistant'] : [])],
  observationScenarioId: `observe-${id}`, recoveryScenarioId: `recover-${id}` })
const phases = [phase('selector', servicePath, files[servicePath].replace('app: assistant', 'app: assistant-typo')),
  phase('lifecycle', deploymentPath, files[deploymentPath].replace('/health/live', '/health/missing')),
  phase('embedding', configPath, files[configPath].replace('embeddings-v1', 'embeddings-missing'), true),
  phase('retrieval', configPath, files[configPath].replace('pg-training.example', 'pg-missing.example'), true),
  phase('answer', configPath, files[configPath].replace('answers-v1', 'answers-missing'), true)]
const fullFlow = 'Inspect the actual training-backups source, 30-day answer and succeeded embedding, postgres-query and answer stages linked by the generated request ID.'
const currentLogs = pod('current-logs', 'Get Pods in assistant, substitute an actual generated name, then inspect its current logs.', 'kubectl logs <generated-pod> -n assistant')
const previousLogs = pod('previous-logs', 'From get pods and describe, select a faulty Pod with a restart; inspect its real previous container before repair deletes it.', 'kubectl logs <restarted-pod> -n assistant --previous')
const describeRestarted = pod('describe-restarted', 'Select a generated Pod with a nonzero restart count and describe that same Pod.', 'kubectl describe pod <restarted-pod> -n assistant')
const wait = [advance(60), advance(30), command('kubectl rollout status deployment/assistant-api -n assistant --watch=false')]
const repairs = (id, path, restart = false) => [file(path), command(`kubectl apply -f ${path}`),
  ...(restart ? [command('kubectl rollout restart deployment/assistant-api -n assistant')] : []),
  ...(path === servicePath ? [] : wait), verify(`recover-${id}`), inspect(fullFlow)]

export const diagnosisGuidedLab = {
  id: 'aks-diagnosis-guided', title: 'Diagnose the AKS assistant layer by layer', status: 'available',
  brief: 'Add correlated application logs, then observe and repair Service routing, container lifecycle, embedding, retrieval and answer failures. Retain real failure and recovery snapshots, and prove repeatable internal and external service.',
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 22,
  labMode: 'guided', skillAreaId: 'containers', service: 'aks', manifestId: DIAGNOSIS_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true,
    kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true, kubernetesDiagnostics: true, acrBuild: true },
  initialProjectFiles: DIAGNOSIS_GUIDED_FILES, solutionFiles: files,
  initializeSimulation: run => createDiagnosisSeed(diagnosisGuidedLab, { run }),
  solutionActionResolvers: { 'current-logs': run => diagnosisPodAction(run, target),
    'previous-logs': run => diagnosisPodAction(run, target, true), 'describe-restarted': run => diagnosisPodAction(run, target, true, true) },
  stages: [ { id: 'baseline', title: 'Scope and logging', taskIds: ['baseline', 'logging'] },
    ...phases.map(item => ({ id: item.id, title: `Diagnose ${item.id}`, taskIds: [`observe-${item.id}`, `recover-${item.id}`] })),
    { id: 'final', title: 'Prove current service', taskIds: ['final-internal', 'final-external'] } ],
  scenarios: { baseline: request(healthy, false, true), logging: request(),
    incident: { kind: 'aks-diagnosis', version: 1, target, investigationArea: 'Service routing, container lifecycle and the last reached dependency stage', phases },
    'observe-selector': request({ ...transportFailure, route: { selectedCount: 0 } }), 'recover-selector': request(),
    'observe-lifecycle': { ...request(), observeLifecycle: true }, 'recover-lifecycle': { ...request(), requireCompleteRollout: true },
    'observe-embedding': request({ status: 502, body: { error: 'The configured AI deployment is not available in this trainer.', code: 'AI_DEPLOYMENT' } }), 'recover-embedding': request(),
    'observe-retrieval': request({ status: 503, body: { error: 'The configured PostgreSQL host is not available in this trainer.', code: 'POSTGRES_CONNECTION' } }), 'recover-retrieval': request(),
    'observe-answer': request({ status: 502, body: { error: 'The configured AI deployment is not available in this trainer.', code: 'AI_DEPLOYMENT' } }), 'recover-answer': request(),
    'final-internal': request(healthy, true), 'final-external': request(healthy, true, true) },
  tasks: [],
}
const task = (id, scenarioId, content) => diagnosisTask(id, scenarioId, { target, lab: diagnosisGuidedLab, ...content })
const historical = (id, content) => task(id, id, { historical: true, stageId: id.split('-')[1], ...content })
diagnosisGuidedLab.tasks = [
  task('baseline', 'baseline', { target: external, dependencies: {}, stageId: 'baseline',
    text: 'Inspect the current context and namespaces. Prove the known backups question through both the internal Service from diagnostics and the external Service.',
    explanation: 'The standalone training/version 2.0 project has two nodes and two desired Pods. Context chooses the cluster and default namespace; default contains no app. Use -n assistant for app inspection and -n diagnostics for the diagnostic client. Running is process state; Ready controls endpoints. Service port 80 resolves named targetPort http to listener 8080.',
    hints: ['Run kubectl config current-context, get-contexts, get namespaces and get pods -n assistant; inspect both Services and EndpointSlices.', 'Use the supplied diagnostics Pod with the qualified internal hostname, then Verify baseline for the external known question.'],
    examNote: 'Successful DNS resolution proves a Service name exists; it does not prove a selected Ready backend or healthy dependency flow.',
    solution: { steps: [...commands('kubectl config current-context', 'kubectl config get-contexts', 'kubectl get namespaces', 'kubectl get pods -n default', 'kubectl get pods -n assistant -o wide', 'kubectl get services -n assistant', 'kubectl get endpointslices -n assistant',
      'kubectl exec diagnostics -n diagnostics -- nslookup assistant-internal.assistant',
      `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant/api/ask`), verify('baseline'), inspect(fullFlow)] } }),
  task('logging', 'logging', { dependencies: {}, stageId: 'baseline', check: context => diagnosisLoggingPassed(context, 'logging'),
    text: 'Add request.started before answer_core and request.completed with the returned status after it. Save, build assistant:diagnostics-v1, update and apply the Deployment, then capture and inspect real correlated logs.',
    explanation: 'The supplied wrapper and helper correlate current_request_id() with the actual core result. A saved edit affects the next build; a build captures immutable source; applying the image changes the Pod template. Inspect source-emitted application logs separately from HTTP access output and observed dependency records. All time advances are explicit.',
    hints: ['Add log_event("request.started") and log_event("request.completed", response["status"]) around the existing core call.', 'Build in acraksdiagnosisguided, save the diagnostics-v1 image, apply and wait for both desired Pods; Verify logging, discover a Pod and read its logs.'],
    examNote: 'Literal IDs/statuses or an undeployed build can produce plausible output without authentic correlated request evidence.',
    solution: { steps: [file('app.py'), command(`az acr build --registry ${DIAGNOSIS_REGISTRY} --image assistant:diagnostics-v1 .`), file(deploymentPath), command(`kubectl apply -f ${deploymentPath}`), ...wait,
      verify('logging'), command('kubectl get pods -n assistant'), currentLogs, inspect('Confirm request.started/completed use the generated request ID and actual HTTP 200. Begin faults only after this fully working captured baseline.')] } }),
  historical('observe-selector', { text: 'Start diagnosis to save the working attempt baseline and introduce the internal Service selector fault. Observe DNS success but selectedCount 0 and NO_READY_ENDPOINTS; retain the real failed request.',
    explanation: 'The native control records the working attempt baseline and applies only its declared fault. Service DNS can resolve while app:assistant-typo selects no Pods. The client transport failure occurs before any container, Python handler or dependency is reached.',
    hints: ['Start diagnosis in Experiments after the logging Task; inspect assistant-internal and EndpointSlices in assistant.', 'Resolve assistant-internal.assistant from diagnostics, then Verify observe-selector and inspect selectedCount and empty application/dependency records.'],
    examNote: 'Transport failure before a backend has no legitimate application request logs or upstream dependency stages.',
    solution: { steps: [control('start'), ...commands('kubectl get services -n assistant', 'kubectl describe service assistant-internal -n assistant', 'kubectl get endpointslices -n assistant', 'kubectl exec diagnostics -n diagnostics -- nslookup assistant-internal.assistant'), verify('observe-selector'), inspect('Retain the native failure snapshot: DNS resolved, selector selected no Pod, NO_READY_ENDPOINTS, no handler execution.')] } }),
  historical('recover-selector', { text: 'Restore app:assistant in the saved internal Service selector, apply it, then prove the complete known-question flow.',
    explanation: 'This repair changes Service selection without replacing containers. Saved files and live routing must agree before the native phase control permits progression. Failure evidence remains historical after repair.',
    hints: ['Save the supplied healthy service-internal.yaml and apply that file.', 'Verify recover-selector and confirm training-backups plus all three succeeded stages before advancing.'],
    examNote: 'A live-only patch does not prove a saved, repeatable repair; phase advance never repairs files on your behalf.', solution: { steps: repairs('selector', servicePath) } }),
  historical('observe-lifecycle', { text: 'Advance diagnosis to introduce liveness /health/missing. Advance explicit time; while faulty Pods exist, inspect actual failed probes, same-Pod restarts and previous startup logs. Retain the lifecycle failure even though old healthy Pods still answer.',
    explanation: 'Liveness restarts a container inside the same Pod; a Deployment template change creates replacement Pods. Startup must succeed before liveness runs. During a restart, Running alone does not imply Ready. Previous logs belong only to the terminated container; a request that never reached Python has no application log.',
    hints: ['Advance diagnosis, then advance 15 + 15 + 10 seconds and inspect generated Pods and events in assistant.', 'Select an actual restarted Pod, describe it and use logs --previous before repair replaces it; Verify observe-lifecycle while the faulty Pod still exists.'],
    examNote: 'Successful traffic to an old healthy Pod cannot establish that the desired new revision is healthy or complete.',
    solution: { steps: [control('next'), advance(15), advance(15), advance(10), ...commands('kubectl get pods -n assistant -o wide', 'kubectl get events -n assistant'), describeRestarted, previousLogs, verify('observe-lifecycle'), inspect('Compare the same Pod UID and different container IDs; retain real liveness events and previous server startup logs without invented Python request logs for the faulty Pod. Old healthy Pod traffic is separate.')] } }),
  historical('recover-lifecycle', { check: context => diagnosisRolloutHealthy(context, 'recover-lifecycle'), text: 'Restore /health/live in the saved Deployment, apply and wait for a complete healthy rollout. Prove the full known-question flow on the repaired desired revision.',
    explanation: 'A correct saved liveness path creates a healthy desired template. Wait for startup, readiness, minReadySeconds and termination before checking rollout completion. An old Pod answering during a stalled rollout is insufficient repair evidence.',
    hints: ['Save the full healthy Deployment while preserving two replicas, requests/limits, probes and RollingUpdate settings.', 'Apply, advance 60 then 30 seconds, inspect rollout status and Verify recover-lifecycle.'],
    examNote: 'Restart count, Ready state and rollout completion answer different questions; inspect them at the appropriate layer.', solution: { steps: repairs('lifecycle', deploymentPath) } }),
  historical('observe-embedding', { text: 'Advance diagnosis to capture EMBEDDING_DEPLOYMENT=embeddings-missing in fresh containers. Observe 502 AI_DEPLOYMENT with only the embedding stage reached.',
    explanation: 'Environment variables are captured at container creation. Applying a ConfigMap alone does not update existing environment values; the declared rollout restart refreshes them. The first failed stage stops query and answer work.',
    hints: ['Advance diagnosis, wait 60 + 30 seconds, inspect the ConfigMap and Deployment rollout.', 'Verify observe-embedding and compare the captured embeddings-missing value, 502 and failed embedding with no query/answer.'],
    examNote: 'Use captured container configuration and the last reached stage to locate the fault rather than assuming a current ConfigMap is already in use.',
    solution: { steps: [control('next'), ...wait, command('kubectl get configmaps -n assistant'), verify('observe-embedding'), currentLogs, inspect('Retain HTTP 502 AI_DEPLOYMENT and the embedding-only failed trace.')] } }),
  historical('recover-embedding', { text: 'Restore embeddings-v1 in the saved ConfigMap, apply and restart to refresh environment. Prove complete retrieval and answer generation.',
    explanation: 'A dependency repair must reach all three stages on fresh captured configuration. The earlier embedding failure snapshot survives the restart and later phases.',
    hints: ['Save the healthy ConfigMap and apply it before rollout restart.', 'Wait for the restarted rollout and Verify recover-embedding; inspect training-backups and all succeeded stages.'],
    examNote: 'A successful HTTP answer needs its real embedding vector, retrieved rows and generation context provenance.', solution: { steps: repairs('embedding', configPath, true) } }),
  historical('observe-retrieval', { text: 'Advance diagnosis to PGHOST=pg-missing.example and refresh containers. Observe embedding success followed by 503 POSTGRES_CONNECTION, with no answer stage.',
    explanation: 'A real embedding precedes the failed PostgreSQL query. The request stops at retrieval and cannot legitimately emit an answer or source list. Correlated completion logs report the actual 503.',
    hints: ['Advance diagnosis and wait for the restart; inspect the saved/live ConfigMap and captured environment.', 'Verify observe-retrieval and inspect embedding then failed postgres-query, no answer, and correlated status 503.'],
    examNote: 'The last reached stage distinguishes retrieval connection failure from embedding failure or answer generation failure.',
    solution: { steps: [control('next'), ...wait, verify('observe-retrieval'), currentLogs, inspect('Retain embedding succeeded, postgres-query failed with POSTGRES_CONNECTION, and no answer operation.')] } }),
  historical('recover-retrieval', { text: 'Restore pg-training.example, apply the ConfigMap and restart. Prove a real query yields training-backups and the answer stage succeeds.',
    explanation: 'The captured environment must refresh before testing. A complete recovery trace shows the real vector binding, selected rows and their use in generation; status 200 alone is insufficient.',
    hints: ['Restore the healthy saved ConfigMap and apply before restart.', 'Wait for completion and Verify recover-retrieval; inspect source IDs and all three stages.'],
    examNote: 'Source IDs are evidence from retrieved rows, not a string to hardcode in a response.', solution: { steps: repairs('retrieval', configPath, true) } }),
  historical('observe-answer', { text: 'Advance diagnosis to ANSWER_DEPLOYMENT=answers-missing and restart. Observe successful embedding/query followed by 502 AI_DEPLOYMENT at answer generation.',
    explanation: 'The same error code as embedding can occur at a different stage. Here the vector and rows exist, but generation fails. Inspect the ordered dependency trace and retrieved context rather than diagnosing from status alone.',
    hints: ['Advance diagnosis, wait for fresh captured containers, then Verify observe-answer.', 'Inspect embedding and postgres-query success, retrieved training-backups context and the failed answer operation.'],
    examNote: 'HTTP status and error code identify an outcome; correlated stage ordering identifies where the request failed.',
    solution: { steps: [control('next'), ...wait, verify('observe-answer'), currentLogs, inspect('Retain the actual embedding/query prefix and failed answer stage with HTTP 502 AI_DEPLOYMENT.')] } }),
  historical('recover-answer', { text: 'Restore answers-v1, apply and restart. Prove the complete known-question flow and retain this fifth recovery snapshot.',
    explanation: 'The final phase repair refreshes captured answer configuration while keeping all five authentic failure and recovery identities. Complete the incident only after this repair evidence exists.',
    hints: ['Save and apply the healthy ConfigMap, then restart and wait for completion.', 'Verify recover-answer before advancing diagnosis to complete the five-phase incident.'],
    examNote: 'Historical recovery proves what happened in its phase; final current proof still requires fresh saved/build/live agreement.', solution: { steps: repairs('answer', configPath, true) } }),
  task('final-internal', 'final-internal', { stageId: 'final', text: 'Complete diagnosis, reapply all six healthy saved manifests once, restart and wait for both intended artifact Pods. Verify the internal known question from diagnostics against the current witness.',
    explanation: 'The shared witness records reapplication followed by restart. Both desired Pods must be Available on the built saved source and captured configuration. Later edits, republishing, replacement or container restart invalidate this proof even if earlier historical snapshots remain.',
    hints: ['Advance diagnosis after the fifth recovery, apply all six files, then restart assistant-api.', 'Advance 60 + 30 seconds, inspect rollout completion and Verify final-internal without changing any saved/build/live inputs.'],
    examNote: 'Repeatable recovery requires current saved/live consistency, intended artifacts and a fresh routed answer with real sources/stages.',
    solution: { steps: [control('next'), ...DIAGNOSIS_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)), command('kubectl rollout restart deployment/assistant-api -n assistant'), ...wait, verify('final-internal'), inspect(fullFlow)] } }),
  task('final-external', 'final-external', { target: external, stageId: 'final', text: 'Using the same current reapply/restart witness, separately Verify the external Service known question. Leave both independent current cases and all ten historical snapshots intact.',
    explanation: 'Internal and external Services have separate routes and evidence records. A previous internal answer cannot replace external verification. Both cases must still refer to the same available desired Pods and current saved/build/live configuration.',
    hints: ['Inspect assistant-external in namespace assistant and its simulated LoadBalancer address.', 'Verify final-external without another restart or edit; inspect training-backups, the 30-day answer and complete succeeded stages.'],
    examNote: 'Historical incident evidence cannot satisfy a current route-specific final request or replace its separate verification.',
    solution: { steps: [command('kubectl get services -n assistant'), verify('final-external'), inspect(fullFlow)] } }),
]

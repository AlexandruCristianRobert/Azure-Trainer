import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { inspectDeploymentConsistency } from '../../../lib/kubernetes/release-evidence.js'
import { getProjectManifest } from '../../../lib/project/manifests.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { evaluateHealthEndpoint } from '../../../lib/kubernetes/probes.js'
import { DIAGNOSIS_MANIFEST } from '../../templates/aks-python/diagnosis.js'
import { diagnosisTask, diagnosisLoggingPassed } from './diagnosis-helpers.js'
import { createDiagnosisSeed, DIAGNOSIS_GROUP, DIAGNOSIS_CLUSTER, DIAGNOSIS_INDEPENDENT_REGISTRY,
  DIAGNOSIS_INDEPENDENT_FILES as initialFiles, DIAGNOSIS_INDEPENDENT_SOLUTION_FILES as files } from './diagnosis-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${DIAGNOSIS_GROUP}/providers/Microsoft.ContainerService/managedClusters/${DIAGNOSIS_CLUSTER}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' }
const external = { ...target, serviceName: 'assistant-external' }
const deploymentPath = 'k8s/deployment.yaml'
const readyOnly = initialFiles[deploymentPath].replace('/health/readyz', '/health/ready')
const command = line => ({ kind: 'command', line })
const file = (path, content = files[path]) => ({ kind: 'file', path, content })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const advance = seconds => ({ kind: 'advance', seconds })
const inspect = instruction => ({ kind: 'inspect', instruction })
const request = (question, expected, options = {}) => ({ kind: 'aks-request', version: 1, target: options.external ? external : target,
  request: { method: 'POST', path: '/api/ask', body: { question } }, expected,
  connectivity: options.external
    ? { origin: { kind: 'external' }, service: { name: external.serviceName, namespace: 'assistant' }, port: 80 }
    : { origin: { kind: 'diagnostic', name: 'diagnostics', namespace: 'diagnostics' }, hostname: 'assistant-internal.assistant', port: 80 },
  ...(options.final ? { integrationProfile: 'embedding-timeout-always', requireTwoReplicas: true,
    expectedCapturedConfig: { APP_ENV: 'review', AUDIENCE: 'partner', COLLECTION: 'review' },
    expectedCurrentConfig: { AUDIENCE: 'partner', COLLECTION: 'review' } } : {}) })
const backup = { status: 200, body: { answer: 'Review backups are kept for 7 days.', sources: ['review-backups'], environment: 'review', release: '2.0' } }
const support = { status: 200, body: { answer: 'Contact the partner desk for support.', sources: ['review-support'], environment: 'review', release: '2.0' } }
const empty = { status: 400, body: { error: 'Question is required.' } }
const noMatch = { status: 200, body: { answer: 'No matching documents.', sources: [], environment: 'review' } }
const timeout = { status: 504, body: { error: 'A dependency timed out after retries.', code: 'DEPENDENCY_TIMEOUT' } }

/** Saved source, published artifact, captured Pods and actual review configuration agree. */
export function independentReviewReady(context) {
  const state = context.runtime.kubernetes.clusters[target.clusterId]
  const deployment = state?.resources['Deployment/assistant/assistant-api']
  const pods = getDeploymentPods(context, target.clusterId, 'assistant', 'assistant-api')
  const image = deployment?.spec.template.spec.containers[0].image
  const artifactId = context.artifacts.publishedTags[image]
  const artifact = context.artifacts.buildsById[artifactId]
  const sourceHash = projectSourceHash(selectBuildFiles(context.project.savedFiles, getProjectManifest(context.project.manifestId)))
  const container = deployment?.spec.template.spec.containers[0]
  const health = artifact?.appSpec && pods[0] && {
    startupClosed: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: {} }, {}, '/health/startup', 'http', 0, pods[0]).status,
    startupOpen: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: {} }, {}, '/health/startup', 'http', 20, pods[0]).status,
    readyInitializing: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: {} }, {}, '/health/ready', 'http', 0, pods[0]).status,
    readyClosed: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: { admissionClosed: true } }, {}, '/health/ready', 'http', 20, pods[0]).status,
    readyOpen: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: {} }, {}, '/health/ready', 'http', 20, pods[0]).status,
    live: evaluateHealthEndpoint(artifact.appSpec, { initializedAtMs: 10, localFaults: {} }, {}, '/health/live', 'http', 0, pods[0]).status,
  }
  return deployment?.spec.replicas === 2 && pods.length === 2 && image?.startsWith(`${DIAGNOSIS_INDEPENDENT_REGISTRY}.azurecr.io/assistant:`)
    && image !== `${DIAGNOSIS_INDEPENDENT_REGISTRY}.azurecr.io/assistant:review-v1`
    && artifact?.sourceHash === sourceHash && container?.startupProbe?.httpGet?.path === '/health/startup'
    && container?.readinessProbe?.httpGet?.path === '/health/ready' && container?.livenessProbe?.httpGet?.path === '/health/live'
    && health?.startupClosed === 503 && health.startupOpen === 200
    && health.readyInitializing === 503 && health.readyClosed === 503 && health.readyOpen === 200 && health.live === 200
    && state.resources['ConfigMap/assistant/assistant-config']?.data?.AUDIENCE === 'partner'
    && state.resources['ConfigMap/assistant/assistant-config']?.data?.COLLECTION === 'review'
    && pods.every(pod => state.health?.containers?.[pod.metadata.uid]?.ready === true
      && state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId
      && state.podSnapshots[pod.metadata.uid]?.environment?.AUDIENCE === 'partner'
      && state.podSnapshots[pod.metadata.uid]?.environment?.COLLECTION === 'review')
}

function timeoutProof(context) {
  const evidence = context.evidence.experimentsById[context.evidence.currentEvidenceByTask['repeatable-recovery']]
  const measured = evidence?.measurements
  const attempts = measured?.integrationTrace?.attempts ?? []
  const completed = measured?.completionLog
  return independentReviewReady(context) && measured?.status === 504 && measured.body?.code === 'DEPENDENCY_TIMEOUT'
    && measured.provenanceValid === true && measured.consistency?.consistent === true
    && measured.finalIdentityFresh === true && measured.intendedRoute === true
    && attempts.length === 3 && attempts.every(item => item.operation === 'embedding')
    && measured.dependencyTrace?.length === 1 && measured.dependencyTrace[0].operation === 'embedding'
    && measured.dependencyTrace[0].status === 'failed'
    && completed?.requestId === measured.requestId && completed.containerId === measured.route?.containerId
    && completed.artifactId === measured.artifactId && completed.event === 'request.completed'
    && completed.status === 504 && completed.requestBinding === 'request-id' && completed.statusBinding === 'result-status'
    && diagnosisLoggingPassed(context, 'repeatable-recovery')
}

export const diagnosisIndependentLab = {
  id: 'aks-diagnosis-independent', title: 'Restore the review assistant from symptoms', status: 'available',
  brief: 'Partner staff cannot reliably get review policy answers. Inspect the supplied manifests and Python, restore two available replicas and prove backup, support and negative cases. Expected backups: 7 days from review-backups; support: review-support. Supported questions include backups, support and travel allowance.',
  minutes: 45, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 24,
  labMode: 'independent', skillAreaId: 'containers', service: 'aks', manifestId: DIAGNOSIS_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true,
    kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true, kubernetesDiagnostics: true, acrBuild: true },
  initialProjectFiles: initialFiles, solutionFiles: files,
  initializeSimulation: run => createDiagnosisSeed(diagnosisIndependentLab, { run, incident: 'readiness-and-audience', profile: 'review', registry: DIAGNOSIS_INDEPENDENT_REGISTRY }),
  stages: [{ id: 'inspect', title: 'Inspect the incident', taskIds: ['inspect-incident'] },
    { id: 'restore', title: 'Restore review answers', taskIds: ['restore-backup', 'restore-support'] },
    { id: 'negative', title: 'Test boundaries', taskIds: ['validate-empty', 'validate-no-match'] },
    { id: 'repeat', title: 'Prove repeatability', taskIds: ['repeatable-recovery'] }],
  scenarios: {
    incident: { kind: 'aks-diagnosis', version: 1, target, initialFaults: true,
      investigationArea: 'Initially unavailable review assistant and captured saved configuration',
      phases: [{ id: 'readiness-and-audience', edits: [{ path: deploymentPath, before: readyOnly, after: initialFiles[deploymentPath] }],
        commands: [`kubectl apply -f ${deploymentPath}`], observationScenarioId: 'inspect-incident', recoveryScenarioId: 'restore-backup' }] },
    'inspect-incident': request('How long are backups kept?', { status: null, body: null, transport: { ok: false, reason: 'NO_READY_ENDPOINTS' }, route: { selectedCount: 2 } }),
    'restore-backup': request('How long are backups kept?', backup),
    'restore-support': request('Who provides support?', support, { external: true }),
    'validate-empty': request('   ', empty),
    'validate-no-match': request('What is the travel allowance?', noMatch),
    'repeatable-recovery': request('How long are backups kept?', timeout, { final: true }),
  }, tasks: [],
}
const task = (id, content) => diagnosisTask(id, id, { target: content.target ?? target, lab: diagnosisIndependentLab, ...content })
diagnosisIndependentLab.tasks = [
  task('inspect-incident', { historical: true, stageId: 'inspect',
    text: 'Inspect the current Pods, Services and captured source, then retain the failed initial internal request.',
    explanation: 'The saved and live deployment starts with running containers but no Ready endpoints. The retained native request stops before Python; saved source and the first image also bind an employee audience despite the review configuration.',
    hints: ['Inspect generated Pods and EndpointSlices in assistant, and compare deployment and app.py with the review ConfigMap.', 'Start diagnosis in Experiments, then Verify inspect-incident from the diagnostic Pod and inspect the native transport record.'],
    examNote: 'Running containers are not Ready endpoints. A request stopped by routing cannot prove an application answer.',
    solution: { steps: [command('kubectl get pods -n assistant -o wide'), command('kubectl get endpointslices -n assistant'),
      { kind: 'scenario', scenarioId: 'incident', control: 'start', instruction: 'Start the captured initial incident in Experiments.' },
      verify('inspect-incident'), inspect('Retain NO_READY_ENDPOINTS, two selected but unready Pods, the initial saved Deployment and captured source without inventing a downstream response.')] } }),
  task('restore-backup', { stageId: 'restore', check: independentReviewReady,
    text: 'Restore two Ready replicas and the review backup answer: 7 days from review-backups.',
    explanation: 'A routing repair exposes the source binding defect as an HTTP 200 employee answer. Correct the saved Python query binding, build a distinct artifact, deploy it and prove the current routed answer.',
    hints: ['Repair readiness using the initialized and admitting route; apply the manifest and inspect the resulting HTTP 200 source.', 'Bind the query audience to cfg["audience"] (or a coordinated parameter name in retrieval.sql), build review-v2 in acraksdiagnosisindependent, apply the new image and wait for Ready Pods.'],
    examNote: 'HTTP 200 is insufficient when the retrieved source belongs to the wrong audience; a source edit needs a build and deployment.',
    solution: { steps: [file(deploymentPath, readyOnly), command(`kubectl apply -f ${deploymentPath}`), advance(90),
      command(`kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant/api/ask`),
      file('app.py'), command(`az acr build --registry ${DIAGNOSIS_INDEPENDENT_REGISTRY} --image assistant:review-v2 .`),
      file(deploymentPath), command(`kubectl apply -f ${deploymentPath}`), advance(90), verify('restore-backup'),
      inspect('Confirm the actual review-backups row, seven-day answer and embedding/query/answer stages on this request ID.')] } }),
  task('restore-support', { target: external, stageId: 'restore', check: independentReviewReady,
    text: 'Prove the external review support answer comes from review-support.',
    explanation: 'The external Service must route the current deployed image through the same parameterized review retrieval graph.',
    hints: ['Inspect the external Service and its two Ready endpoints.', 'Verify restore-support and inspect the request-linked query bindings and review-support source.'],
    examNote: 'A second question and entry point can expose a partial repair that a single backup request misses.',
    solution: { steps: [command('kubectl get services -n assistant'), command('kubectl get endpointslices -n assistant'), verify('restore-support'),
      inspect('Confirm partner support, review-support and the actual external request route.')] } }),
  task('validate-empty', { stageId: 'negative', check: independentReviewReady,
    text: 'Prove blank input returns HTTP 400 before any dependency work.',
    explanation: 'Validation runs through the captured Python graph and produces no embedding, retrieval or answer operation.',
    hints: ['Use the declared blank-question Verify case.', 'Inspect the returned 400 and empty dependency trace for this request ID.'],
    examNote: 'Input validation should not spend calls on a request that cannot be answered.',
    solution: { steps: [verify('validate-empty'), inspect('Confirm HTTP 400 and no dependency attempts for the blank question.')] } }),
  task('validate-no-match', { stageId: 'negative', check: independentReviewReady,
    text: 'Prove travel allowance has no matching review document.',
    explanation: 'Embedding and parameterized query run; zero selected rows returns No matching documents. and sources [] without an answer call.',
    hints: ['Use the declared travel question Verify case.', 'Inspect embedding/query success, zero rows and no answer operation.'],
    examNote: 'No match is a successful retrieval outcome, distinct from a failed dependency.',
    solution: { steps: [verify('validate-no-match'), inspect('Confirm empty sources came from zero retrieved rows, after embedding and query only.')] } }),
  task('repeatable-recovery', { stageId: 'repeat', check: timeoutProof,
    text: 'Reapply the saved manifests, restart the Deployment and prove a correlated 504 after three embedding timeouts.',
    explanation: 'The final request uses a request-local timeout profile after a witnessed restart. Its completion log must carry the actual 504 and request ID; query and answer are never reached.',
    hints: ['Reapply the supplied manifests, restart assistant-api and wait for two Ready Pods.', 'Verify repeatable-recovery, inspect three embedding attempts and request.completed 504, then retry a healthy question.'],
    examNote: 'Failure telemetry needs the actual result status and correlation ID; request-local faults must not poison later traffic.',
    solution: { steps: [...DIAGNOSIS_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)),
      command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(90),
      verify('restore-backup'), verify('restore-support'), verify('validate-empty'), verify('validate-no-match'),
      verify('repeatable-recovery'), verify('restore-backup'),
      inspect('Inspect the 504 request completion log and three embedding attempts; no query/answer, then a separate healthy review-backups response.')] } }),
]

import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../../templates/aks-python/integration.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { seedIntegrationTroubleshooting } from './integration-seeds.js'
import { AI_TROUBLESHOOTING_CLUSTER, AI_TROUBLESHOOTING_CLUSTER_ID, AI_TROUBLESHOOTING_GROUP, AI_TROUBLESHOOTING_IMAGE, AI_TROUBLESHOOTING_LAB_ID, AI_TROUBLESHOOTING_REGISTRY } from './integration-incidents.js'

const target = { clusterId: AI_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant', serviceName: 'assistant-public', deploymentName: 'assistant' }
const solutionDeployment = INTEGRATION_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksintegration.azurecr.io/assistant:integration-v1', AI_TROUBLESHOOTING_IMAGE).replace('          ports:', '          imagePullPolicy: Always\n          ports:')
const solutionFiles = { ...INTEGRATION_SOLUTION_FILES, 'k8s/deployment.yaml': solutionDeployment }
const resilientApp = solutionFiles['app.py']
const starterApp = resilientApp.replace('RetryPolicy(max_attempts=3, retryable_codes=("THROTTLED", "UNAVAILABLE", "TIMEOUT"), base_delay_ms=100, max_delay_ms=200, attempt_timeout_ms=200)', 'RetryPolicy(max_attempts=1, retryable_codes=("THROTTLED",), base_delay_ms=100, max_delay_ms=200, attempt_timeout_ms=200)')
const initialFiles = { ...solutionFiles, 'app.py': starterApp, 'k8s/configmap.yaml': solutionFiles['k8s/configmap.yaml'].replace('EMBEDDING_DEPLOYMENT: embeddings-v1', 'EMBEDDING_DEPLOYMENT: embeddings-typo'), 'k8s/deployment.yaml': solutionDeployment.replace('assistant:resilient-v1', 'assistant:baseline') }
const file = path => ({ kind: 'file', path, content: solutionFiles[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const app = context => parsePythonProject(context.project.savedFiles, INTEGRATION_MANIFEST).appSpec
const artifactCurrent = context => {
  const state = context.runtime.kubernetes?.clusters?.[target.clusterId]; const deployment = state?.resources['Deployment/assistant/assistant']
  const artifactId = context.artifacts.publishedTags?.[AI_TROUBLESHOOTING_IMAGE]; const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const pods = getDeploymentPods(context.run ?? context, target.clusterId, 'assistant', 'assistant')
  return deployment?.spec?.template?.spec?.containers?.[0]?.image === AI_TROUBLESHOOTING_IMAGE && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, INTEGRATION_MANIFEST)) && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}
const graphPolicy = context => app(context)?.integration?.graph?.nodes?.find(node => node.op === 'constructor' && node.class === 'RetryPolicy')?.args
const policyReady = context => {
  const args = graphPolicy(context); const retryable = args?.retryable_codes
  const nodes = new Map((app(context)?.integration?.graph?.nodes ?? []).map(node => [node.id, node]))
  const resolve = id => { const node = nodes.get(id); return node?.op === 'literal' ? node.value : node?.op === 'tuple' ? node.values.map(resolve) : undefined }
  return args && resolve(args.max_attempts) === 3
    && JSON.stringify(resolve(retryable)) === JSON.stringify(['THROTTLED', 'UNAVAILABLE', 'TIMEOUT'])
    && resolve(args.base_delay_ms) === 100 && resolve(args.max_delay_ms) === 200 && resolve(args.attempt_timeout_ms) <= 200
    && app(context)?.integration?.graph?.nodes?.some(node => node.op === 'constructor' && node.class === 'RequestBudget' && resolve(node.args?.total_ms) <= 1000)
    && ['EmbeddingClient', 'PgClient', 'AnswerClient'].every(name => app(context)?.integration?.graph?.nodes?.some(node => node.op === 'constructor' && node.class === name && resolve(node.args?.sdk_retries) === 0))
}
const incident = context => context.runtime.kubernetes?.integrationIncident
const evidence = (context, taskId) => context.evidence?.experimentsById?.[context.evidence?.currentEvidenceByTask?.[taskId]]
const passed = (context, taskId, scenario) => { const record = evidence(context, taskId); return record?.outcome === 'passed' && record.completed && record.scenarioId === scenario && record.measurements?.deploymentUid === context.runtime.kubernetes?.clusters?.[target.clusterId]?.resources?.['Deployment/assistant/assistant']?.metadata?.uid }
const historical = (context, taskId, scenario) => Object.values(context.evidence?.experimentsById ?? {}).some(record => record.taskId === taskId && record.scenarioId === scenario && record.outcome === 'passed' && record.completed)
const phase = value => context => incident(context)?.phase === value
const task = (id, text, check, scenarioId, steps) => ({ id, stageId: 'diagnose', text, explanation: 'Use the supplied request trace to identify the reached dependency stage. The adapter owns no implicit retries; total attempts include retries and their waits within one shared request deadline.', hints: ['Inspect /api/info and /api/ask separately.', 'Compare the selected dependency stage and attempt history before changing source.'], examNote: 'Metadata filters make retrieval correct; they do not authorize access.', check, solution: { steps }, ...(scenarioId ? { verification: { scenarioId, scenarioVersion: 1 } } : {}) })
const ask = (id, profile, expected) => ({ kind: 'aks-request', version: 1, target, connectivity: { origin: { kind: 'external' }, service: { namespace: 'assistant', name: 'assistant-public' }, port: 80 }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected, integrationProfile: profile })
const success = { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } }
const error = (status, code) => ({ status, body: { error: code === 'AI_DEPLOYMENT' ? 'The configured AI deployment is not available in this trainer.' : code === 'DEADLINE_EXCEEDED' ? 'The request time budget was exhausted.' : code === 'DEPENDENCY_TIMEOUT' ? 'A dependency timed out after retries.' : code === 'DEPENDENCY_UNAVAILABLE' ? 'A dependency remained unavailable after retries.' : 'A dependency remained throttled after retries.', code } })

export const aksAiTroubleshootingLab = {
  id: AI_TROUBLESHOOTING_LAB_ID, title: 'Diagnose AKS assistant integration faults', brief: 'Start with symptoms. /api/info proves the route is healthy; /api/ask identifies the reached dependency stage. Repair a captured deployment setting, then a zero-row metadata filter, then add bounded application retries. A permanent deployment error is not throttling, and a no-match query is not a PostgreSQL connection failure.', minutes: 55, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 11, labMode: 'troubleshooting', skillAreaId: 'containers', service: 'aks', status: 'draft', manifestId: INTEGRATION_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true }, initialProjectFiles: initialFiles, solutionFiles, initializeSimulation: seedIntegrationTroubleshooting,
  stages: [{ id: 'diagnose', title: 'Observe, repair, and bound retries', taskIds: ['observe-deployment', 'repair-deployment', 'observe-filter', 'repair-filter', 'observe-no-retry', 'repair-policy', 'transient-embedding', 'transient-postgres', 'persistent-answer', 'persistent-timeout', 'deadline-bound', 'final-healthy'] }],
  scenarios: {
    'trouble-ai-deployment-failure': ask('trouble-ai-deployment-failure', 'healthy', error(502, 'AI_DEPLOYMENT')),
    'trouble-ai-deployment-recovered': ask('trouble-ai-deployment-recovered', 'healthy', success),
    'trouble-ai-filter-empty': ask('trouble-ai-filter-empty', 'healthy', { status: 200, body: { answer: 'No matching documents.', sources: [], environment: 'training' } }),
    'trouble-ai-filter-recovered': ask('trouble-ai-filter-recovered', 'healthy', success),
    'trouble-ai-no-retry': ask('trouble-ai-no-retry', 'embedding-throttle-once', error(503, 'THROTTLED')),
    'trouble-ai-transient-embedding': ask('trouble-ai-transient-embedding', 'embedding-throttle-once', success),
    'trouble-ai-transient-postgres': ask('trouble-ai-transient-postgres', 'postgres-unavailable-once', success),
    'trouble-ai-persistent-answer': ask('trouble-ai-persistent-answer', 'answer-unavailable-always', error(503, 'DEPENDENCY_UNAVAILABLE')),
    'trouble-ai-persistent-timeout': ask('trouble-ai-persistent-timeout', 'embedding-timeout-always', error(504, 'DEPENDENCY_TIMEOUT')),
    'trouble-ai-deadline-bound': ask('trouble-ai-deadline-bound', 'retry-after-too-long', error(504, 'DEADLINE_EXCEEDED')),
    'trouble-ai-final-healthy': ask('trouble-ai-final-healthy', 'healthy', success),
  },
  tasks: [
    task('observe-deployment', 'Observe the permanent embedding deployment failure; no query should run.', c => historical(c, 'observe-deployment', 'trouble-ai-deployment-failure'), 'trouble-ai-deployment-failure', [{ kind: 'scenario', scenarioId: 'trouble-ai-deployment-failure' }]),
    task('repair-deployment', 'Repair EMBEDDING_DEPLOYMENT, apply it, restart Pods, and prove recovery.', c => historical(c, 'repair-deployment', 'trouble-ai-deployment-recovered'), 'trouble-ai-deployment-recovered', [file('k8s/configmap.yaml'), ...commands('kubectl apply -f k8s/configmap.yaml', 'kubectl rollout restart deployment/assistant -n assistant'), { kind: 'scenario', scenarioId: 'trouble-ai-deployment-recovered' }]),
    task('observe-filter', 'Reveal and observe the visitor filter: embedding succeeds, query returns zero rows, and answer is unreached.', c => historical(c, 'observe-filter', 'trouble-ai-filter-empty'), 'trouble-ai-filter-empty', [{ kind: 'command', resolver: 'next-incident', line: 'Continue to the metadata filter incident' }, { kind: 'scenario', scenarioId: 'trouble-ai-filter-empty' }]),
    task('repair-filter', 'Restore AUDIENCE=employee without weakening the bound SQL metadata predicates.', c => historical(c, 'repair-filter', 'trouble-ai-filter-recovered'), 'trouble-ai-filter-recovered', [file('k8s/configmap.yaml'), ...commands('kubectl apply -f k8s/configmap.yaml', 'kubectl rollout restart deployment/assistant -n assistant'), { kind: 'scenario', scenarioId: 'trouble-ai-filter-recovered' }]),
    task('observe-no-retry', 'Reveal the throttled-once profile and observe one failed embedding attempt.', c => historical(c, 'observe-no-retry', 'trouble-ai-no-retry'), 'trouble-ai-no-retry', [{ kind: 'command', resolver: 'next-incident', line: 'Continue to the retry incident' }, { kind: 'scenario', scenarioId: 'trouble-ai-no-retry' }]),
    task('repair-policy', 'Use three bounded attempts, only THROTTLED/UNAVAILABLE/TIMEOUT, zero SDK retries, a 1000 ms budget and 200 ms attempts; build and deploy resilient-v1.', c => policyReady(c) && artifactCurrent(c), null, [file('app.py'), file('k8s/deployment.yaml'), ...commands(`az acr build -r ${AI_TROUBLESHOOTING_REGISTRY} -t assistant:resilient-v1 .`, 'kubectl apply -f k8s/deployment.yaml')]),
    task('transient-embedding', 'Verify a one-time embedding throttle recovers within the request budget.', c => artifactCurrent(c) && passed(c, 'transient-embedding', 'trouble-ai-transient-embedding'), 'trouble-ai-transient-embedding', [{ kind: 'scenario', scenarioId: 'trouble-ai-transient-embedding' }]),
    task('transient-postgres', 'Verify a one-time PostgreSQL unavailable result recovers.', c => artifactCurrent(c) && passed(c, 'transient-postgres', 'trouble-ai-transient-postgres'), 'trouble-ai-transient-postgres', [{ kind: 'scenario', scenarioId: 'trouble-ai-transient-postgres' }]),
    task('persistent-answer', 'Verify a persistent answer dependency failure stops after bounded retries.', c => artifactCurrent(c) && passed(c, 'persistent-answer', 'trouble-ai-persistent-answer'), 'trouble-ai-persistent-answer', [{ kind: 'scenario', scenarioId: 'trouble-ai-persistent-answer' }]),
    task('persistent-timeout', 'Verify persistent timeouts stop at the attempt timeout.', c => artifactCurrent(c) && passed(c, 'persistent-timeout', 'trouble-ai-persistent-timeout'), 'trouble-ai-persistent-timeout', [{ kind: 'scenario', scenarioId: 'trouble-ai-persistent-timeout' }]),
    task('deadline-bound', 'Verify a retry delay that exceeds the shared deadline stops before a later attempt.', c => artifactCurrent(c) && passed(c, 'deadline-bound', 'trouble-ai-deadline-bound'), 'trouble-ai-deadline-bound', [{ kind: 'scenario', scenarioId: 'trouble-ai-deadline-bound' }]),
    task('final-healthy', 'Verify the healthy profile after all diagnostics.', c => artifactCurrent(c) && Object.entries({ 'observe-deployment': 'trouble-ai-deployment-failure', 'repair-deployment': 'trouble-ai-deployment-recovered', 'observe-filter': 'trouble-ai-filter-empty', 'repair-filter': 'trouble-ai-filter-recovered', 'observe-no-retry': 'trouble-ai-no-retry' }).every(([id, scenario]) => historical(c, id, scenario)) && passed(c, 'final-healthy', 'trouble-ai-final-healthy'), 'trouble-ai-final-healthy', [{ kind: 'scenario', scenarioId: 'trouble-ai-final-healthy' }]),
  ], solutionActionResolvers: { 'next-incident': () => ({ type: 'aks-integration-next-incident' }) },
}

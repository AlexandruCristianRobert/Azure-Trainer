import { parsePythonProject } from '../../../lib/project/python.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../../../lib/kubernetes/services.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { probeTask, probeScenario, requestTask, probeReceiptPassed } from './probe-helpers.js'
import {
  seedProbesIndependent, PROBES_INDEPENDENT_CLUSTER, PROBES_INDEPENDENT_GROUP,
  PROBES_INDEPENDENT_IMAGE_BAD, PROBES_INDEPENDENT_IMAGE_FIXED, PROBES_INDEPENDENT_REGISTRY,
  PROBES_INDEPENDENT_FILES,
} from './probe-seeds.js'
import { HEALTH_FIXTURES } from '../../fixtures/aks/health.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../../templates/aks-python/health.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${PROBES_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${PROBES_INDEPENDENT_CLUSTER}`
const namespace = 'assistant'
const target = { clusterId, namespace, deploymentName: 'assistant', serviceName: 'assistant-internal' }
const finalTarget = { ...target, serviceName: 'assistant-public' }
const independentSource = HEALTH_SOLUTION_FILES['app.py'].replace(
  'initialized() and accepting_requests()', 'initialized() and accepting_requests() and postgres_available()',
)
const file = (path, content) => ({ kind: 'file', path, content })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const experiment = (scenarioId, seconds) => [scenario(scenarioId), { kind: 'advance', seconds }]
const solutionFiles = Object.freeze({
  ...HEALTH_SOLUTION_FILES,
  'app.py': independentSource,
  'k8s/deployment.yaml': HEALTH_SOLUTION_FILES['k8s/deployment.yaml']
    .replace('acraksprobesguided.azurecr.io/assistant:health-v1', PROBES_INDEPENDENT_IMAGE_FIXED)
    .replace('failureThreshold: 6', 'failureThreshold: 10'),
})

function health(context) {
  const parsed = parsePythonProject(context.project.savedFiles, HEALTH_MANIFEST)
  return parsed.diagnostics.length || !parsed.appSpec?.health || !parsed.appSpec?.integration ? null : parsed.appSpec.health
}

function expressionValue(expression, signals) {
  if (expression?.kind === 'constant') return expression.value
  if (expression?.kind === 'signal') return signals[expression.name] === true
  if (expression?.kind === 'not') return !expressionValue(expression.operand, signals)
  if (expression?.kind === 'and') return expression.operands.every(item => expressionValue(item, signals))
  if (expression?.kind === 'or') return expression.operands.some(item => expressionValue(item, signals))
  if (expression?.kind === 'conditional') return expressionValue(expression.condition, signals) ? expression.then : expression.else
  return undefined
}

function statusMatches(status, shouldBeHealthy) {
  return Number.isInteger(status) && (shouldBeHealthy ? status >= 200 && status < 400 : status >= 400 && status <= 599)
}

function validHealthPolicy(context) {
  const endpoints = health(context)?.endpoints
  if (!endpoints || endpoints.length !== 3) return false
  const expected = {
    '/health/startup': signal => signal.initialized,
    '/health/ready': signal => signal.initialized && signal.accepting_requests && signal.postgres_available,
    '/health/live': () => true,
  }
  return Object.entries(expected).every(([path, shouldBeHealthy]) => {
    const endpoint = endpoints.find(item => item.path === path)
    return !!endpoint && [false, true].every(initialized => [false, true].every(accepting_requests =>
      [false, true].every(postgres_available => [false, true].every(ai_available => {
        const signals = { initialized, accepting_requests, postgres_available, ai_available }
        return statusMatches(expressionValue(endpoint.statusExpression, signals), shouldBeHealthy(signals))
      }))))
  })
}

function deployment(context) {
  return context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.['Deployment/assistant/assistant']
}

function savedManifest(context) {
  const parsed = parseKubernetesYaml(context.project.savedFiles['k8s/deployment.yaml'] ?? '', 'k8s/deployment.yaml')
  return parsed.diagnostics.length || parsed.documents.length !== 1 ? null : structuredClone(parsed.documents[0])
}

function appliedManifestCurrent(context) {
  const current = deployment(context)
  const saved = savedManifest(context)
  if (!current || !saved) return false
  const normalized = structuredClone(current.spec)
  delete normalized.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
  delete saved.spec?.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
  for (const spec of [normalized, saved.spec]) {
    if (spec.template?.metadata?.annotations && Object.keys(spec.template.metadata.annotations).length === 0)
      delete spec.template.metadata.annotations
    for (const container of spec.template?.spec?.containers ?? []) {
      for (const key of ['startupProbe', 'readinessProbe', 'livenessProbe'])
        if (container[key]?.httpGet) container[key].httpGet.scheme ??= 'HTTP'
    }
  }
  return canonicalize(normalized) === canonicalize(saved.spec)
}

function activeContainer(context) {
  return deployment(context)?.spec?.template?.spec?.containers?.find(item => item.name === 'api')
}

function supportedProbe(probe, path) {
  if (!probe || !probe.httpGet || probe.httpGet.path !== path || !['http', 8080].includes(probe.httpGet.port)) return false
  if (probe.httpGet.scheme && probe.httpGet.scheme !== 'HTTP') return false
  return ['initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold', 'successThreshold']
    .every(key => Number.isInteger(probe[key]) && probe[key] >= (key === 'initialDelaySeconds' ? 0 : 1))
}

function probesCurrent(context) {
  const container = activeContainer(context)
  if (!container || !supportedProbe(container.startupProbe, '/health/startup')
    || !supportedProbe(container.readinessProbe, '/health/ready')
    || !supportedProbe(container.livenessProbe, '/health/live')) return false
  const startup = container.startupProbe
  return startup.initialDelaySeconds + startup.periodSeconds * startup.failureThreshold >= 42
}

function sourceImageCurrent(context) {
  if (!validHealthPolicy(context) || !probesCurrent(context) || !appliedManifestCurrent(context)) return false
  const image = activeContainer(context)?.image
  const buildId = context.artifacts.publishedTags?.[PROBES_INDEPENDENT_IMAGE_FIXED]
  const build = buildId && context.artifacts.buildsById?.[buildId]
  return image === PROBES_INDEPENDENT_IMAGE_FIXED && !!build
    && build.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, HEALTH_MANIFEST))
}

function currentReadyPods(context) {
  const run = context.run ?? context
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const pods = getDeploymentPods(run, clusterId, namespace, 'assistant')
  return pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running'
    && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
    && state.podSnapshots[pod.metadata.uid]?.artifactId === context.artifacts.publishedTags?.[PROBES_INDEPENDENT_IMAGE_FIXED])
}

function experimentReceipt(context, scenarioId, taskId) {
  const id = context.evidence.currentEvidenceByTask?.[taskId]
  const evidence = id && context.evidence.experimentsById?.[id]
  const receipt = evidence?.measurements?.probeReceipt
  return evidence?.completed === true && evidence.outcome === 'passed'
    && evidence.scenarioId === scenarioId && receipt?.status === 'completed' && receipt.outcome === 'passed' ? receipt : null
}

function sourceAndDeployment(context) {
  return sourceImageCurrent(context) && currentReadyPods(context)
}

function startupVerified(context) {
  const receipt = experimentReceipt(context, 'independent-probe-startup', 'startup')
  const facts = receipt?.summary?.facts
  return !!receipt && sourceAndDeployment(context) && receipt.summary.restartReceipts.length === 0
    && facts?.earlyGatedCheck === false
    && facts.firstStartupSuccessAt >= receipt.startedAtMs + 42_000
}

function admissionVerified(context) {
  const receipt = experimentReceipt(context, 'independent-probe-admission', 'admission')
  const facts = receipt?.summary?.facts
  const uid = receipt?.podUids?.[0]
  const interval = facts?.readiness?.[uid]
  return !!receipt && sourceAndDeployment(context) && receipt.summary.restartReceipts.length === 0
    && interval?.withdrawnAt >= receipt.baselineReadyAtMs + 5_000
    && interval.withdrawnAt <= receipt.baselineReadyAtMs + 9_000
    && interval.reenteredAt >= receipt.baselineReadyAtMs + 20_000
    && interval.reenteredAt <= receipt.baselineReadyAtMs + 25_000
    && receipt.samples.some(item => item.second === 9 && item.readyBackendCount < 2
      && item.response?.status === 200 && item.response.route?.podUid !== uid)
    && receipt.samples.some(item => item.second === 25 && item.response?.status === 200
      && item.response.body?.sources?.includes('training-backups'))
}

function databaseVerified(context) {
  const receipt = experimentReceipt(context, 'independent-probe-database', 'database')
  const facts = receipt?.summary?.facts
  const intervals = receipt?.podUids?.map(uid => facts?.readiness?.[uid]) ?? []
  return !!receipt && sourceAndDeployment(context) && receipt.summary.restartReceipts.length === 0
    && intervals.length === 2 && intervals.every(item => item?.withdrawnAt >= receipt.baselineReadyAtMs + 5_000
      && item.withdrawnAt <= receipt.baselineReadyAtMs + 9_000
      && item.reenteredAt >= receipt.baselineReadyAtMs + 25_000
      && item.reenteredAt <= receipt.baselineReadyAtMs + 30_000)
    && receipt.samples.some(item => item.second === 10 && item.readyBackendCount === 0
      && item.response?.transport?.reason === 'NO_READY_ENDPOINTS')
    && receipt.samples.some(item => item.second === 30 && item.response?.status === 200
      && item.response.body?.sources?.includes('training-backups'))
}

function optionalAiVerified(context) {
  const receipt = experimentReceipt(context, 'independent-probe-ai', 'optional-ai')
  return !!receipt && sourceAndDeployment(context) && receipt.summary.restartReceipts.length === 0
    && receipt.samples.some(item => item.second === 10 && item.request?.path === '/api/info' && item.response?.status === 200)
    && receipt.samples.some(item => item.second === 12 && item.request?.path === '/api/ask' && item.response?.status === 503)
    && receipt.samples.some(item => item.second === 40 && item.request?.path === '/api/ask'
      && item.response?.status === 200 && item.response.body?.sources?.includes('training-backups'))
}

function hangVerified(context) {
  const receipt = experimentReceipt(context, 'independent-probe-hang', 'hang')
  const state = context.runtime.kubernetes.clusters[clusterId]
  const faultedUid = receipt?.podUids?.[0]
  const facts = receipt?.summary?.facts
  const interval = facts?.readiness?.[faultedUid]
  const termination = facts?.restartSchedules?.find(item => item.podUid === faultedUid && item.probeType === 'liveness')
  const restart = receipt?.summary?.restartReceipts?.find(item => item.podUid === faultedUid
    && item.probeType === 'LivenessProbeFailed' && item.oldContainerId !== item.newContainerId)
  return !!receipt && sourceAndDeployment(context) && !!termination && !!restart
    && facts?.livenessTimeoutAt >= receipt.baselineReadyAtMs + 5_000
    && interval?.withdrawnAt <= receipt.baselineReadyAtMs + 9_000
    && interval?.reenteredAt >= restart.atMs && interval.reenteredAt <= receipt.baselineReadyAtMs + 95_000
    && state.health.containers[faultedUid]?.containerId === restart.newContainerId
    && receipt.samples.some(item => item.second === receipt.script.finishAfterStartSeconds
      && item.response?.status === 200 && item.response.route?.podUid === faultedUid
      && item.response.body?.sources?.includes('training-backups'))
}

function finalAnswer(context) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask?.['final-answer']]
  return sourceAndDeployment(context) && hangVerified(context)
    && !!record && record.completed === true && record.outcome === 'passed'
    && record.scenarioId === 'independent-probe-final'
    && record.measurements?.body?.answer === 'Training backups are kept for 30 days.'
    && record.measurements?.body?.sources?.includes('training-backups')
}

const probeDef = (id, stageId, text, explanation, hints, examNote, scenarioId, check, steps) => probeTask({
  id, stageId, text, explanation, hints, examNote, scenarioId, check, target,
  solution: { steps },
})

export const aksProbesIndependentLab = {
  id: 'aks-probes-independent', title: 'Design health probes for a slower assistant', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 60,
  brief: 'A slower Python knowledge assistant needs a probe policy designed around its actual dependencies. Initialization takes 42 seconds, with a 90-second maximum warmup. Each named fault begins five seconds after the experiment baseline becomes Ready: admission closes through +20 seconds, PostgreSQL fails through +25, and optional AI is unavailable through +35. Withdraw and restore readiness within four and five seconds; a real hang must start liveness termination within 30 seconds and recover within 90 seconds. PostgreSQL is required for admission, AI is optional for basic service health, and the supplied assistant answer flow must keep working.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 15, labMode: 'independent',
  manifestId: HEALTH_MANIFEST.id, healthFixture: { initializationSeconds: 42, maximumWarmupSeconds: 90 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true,
    kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true },
  initialProjectFiles: PROBES_INDEPENDENT_FILES, solutionFiles,
  initializeSimulation: seedProbesIndependent,
  stages: [
    { id: 'design', title: 'Design and deploy a policy', taskIds: ['design-and-deploy'] },
    { id: 'verify', title: 'Test each dependency and recovery condition', taskIds: ['startup', 'admission', 'database', 'optional-ai', 'hang'] },
    { id: 'answer', title: 'Verify the recovered assistant', taskIds: ['final-answer'] },
  ],
  scenarios: {
    'independent-probe-startup': probeScenario('independent-probe-startup', target, HEALTH_FIXTURES.scenarios.coldStartup, 60),
    'independent-probe-admission': probeScenario('independent-probe-admission', target, HEALTH_FIXTURES.scenarios.temporaryAdmissionClosure, 90),
    'independent-probe-database': probeScenario('independent-probe-database', target, HEALTH_FIXTURES.scenarios.requiredPostgresOutage, 90),
    'independent-probe-ai': probeScenario('independent-probe-ai', target, HEALTH_FIXTURES.scenarios.optionalAiOutage, 100),
    'independent-probe-hang': probeScenario('independent-probe-hang', target, HEALTH_FIXTURES.scenarios.processHang, 180),
    'independent-probe-final': { kind: 'aks-request', version: 1, target: finalTarget,
      connectivity: { origin: { kind: 'external' }, service: { namespace, name: 'assistant-public' }, port: 80 },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
      expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } },
      integrationProfile: 'healthy' },
  },
  tasks: [
    probeDef('design-and-deploy', 'design', 'Implement the three local health handlers and design a Deployment policy that covers 42-second initialization, withdraws traffic for admission/database failures, keeps AI optional, and restarts a truly hung process. Save the source and complete manifest, build `assistant:health-independent`, then apply it.',
      'Treat each probe as a separate question. Startup protects the process while it initializes; readiness decides whether a Pod can receive traffic, so it includes PostgreSQL but not optional AI; liveness detects a local process that cannot answer. The experiment tasks evaluate the actual behavior, not one exact timing recipe.',
      ['Make startup depend on initialization, readiness depend on initialization plus admission and PostgreSQL, and liveness depend only on the local process.', 'Budget enough startup attempts for all 42 seconds, then use bounded readiness/liveness checks that meet the withdrawal and recovery windows.'],
      'Explain why readiness includes a required dependency while liveness must not couple to a remote optional service.', null,
      sourceImageCurrent, [
        file('app.py', independentSource),
        ...commands(`az acr build -r ${PROBES_INDEPENDENT_REGISTRY} -t assistant:health-independent .`),
        file('k8s/deployment.yaml', solutionFiles['k8s/deployment.yaml']),
        ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl get pods -n assistant'), { kind: 'inspect' },
      ]),
    probeDef('startup', 'verify', 'Run `independent-probe-startup`. Confirm all 42 seconds of initialization are protected, startup succeeds before readiness or liveness begins, both Pods become Ready, and neither container restarts.',
      'The initial assistant image intentionally has no probes. The experiment recreates the Pods and uses the 42-second fixed initialization on each new container. With the reference five-second period, startup receives nine failed checks before the successful check; a different probe period must still pass the same 90-second warmup and observed recovery tests.',
      ['Run the complete 60-second cold-start experiment after the source, image, and applied manifest are current.', 'Inspect the first startup success and verify no readiness/liveness check ran before it; the total warmup cap is 90 seconds.'],
      'A process that has not finished initialization should remain out of Service traffic without being restarted prematurely.',
      'independent-probe-startup', startupVerified, experiment('independent-probe-startup', 60)),
    probeDef('admission', 'verify', 'Run `independent-probe-admission`. During local admission closure, verify one Pod leaves Service traffic, the other serves the assistant, then the withdrawn Pod re-enters without a container restart.',
      'Readiness controls traffic eligibility. The admission fault begins five seconds after the Ready baseline and clears at +20 seconds. A Pod can remain Running while it is temporarily unable to accept requests; withdraw its endpoint within four seconds and restore it within five seconds after recovery.',
      ['Use the second-9 and second-25 request samples to compare routing and reentry.', 'Check that no probe restart receipt was created for the admission-only fault and that the full observation stays inside the 90-second warmup cap.'],
      'Removing an endpoint during a readiness failure preserves the Pod and its opportunity to recover.',
      'independent-probe-admission', admissionVerified, experiment('independent-probe-admission', 90)),
    probeDef('database', 'verify', 'Run `independent-probe-database`. Both Pods must leave Service traffic during the required PostgreSQL outage and re-enter after recovery, with no container restart.',
      'PostgreSQL is required for accepting requests, so it belongs in readiness. The outage begins at baseline +5 and recovers at +25. This experiment is distinct from the admission-only case: both replicas must withdraw within four seconds, re-enter within five seconds, and the request at second 10 must show no ready backend.',
      ['Compare both Pods’ readiness intervals with the outage and recovery times.', 'Verify the second-10 request has no ready endpoint and the second-30 assistant answer succeeds after recovery.'],
      'A required dependency belongs in readiness; restarting a healthy app container does not repair the database outage.',
      'independent-probe-database', databaseVerified, experiment('independent-probe-database', 90)),
    probeDef('optional-ai', 'verify', 'Run `independent-probe-ai`. Keep both Pods Ready with no restarts. `/api/info` succeeds during the outage, `/api/ask` returns a controlled failure, and the prepared answer succeeds when AI returns.',
      'The AI outage begins at baseline +5 and recovers at +35, after the Pod warmup has finished; the 90-second cap applies while waiting for the initial Ready baseline. AI is optional for the local API’s health. A remote failure should be handled by the request path, not by making readiness withdraw or liveness restart the assistant.',
      ['Check `/api/info` at second 10, the controlled ask failure at second 12, and the recovered answer at second 40.', 'Compare readiness and restart counts across the full experiment window.'],
      'Keep optional dependency failures at the request boundary instead of restarting a responsive local process.',
      'independent-probe-ai', optionalAiVerified, experiment('independent-probe-ai', 100)),
    probeDef('hang', 'verify', 'Run `independent-probe-hang`. The local process hang must withdraw the affected Pod, cause a bounded liveness timeout and same-Pod container restart, and restore Ready traffic and the assistant answer.',
      'The hang begins at baseline +5 and blocks local HTTP handling; it is different from an AI outage. Liveness probes reach the process directly even while readiness has removed its Pod from Service routing. Require termination initiation within 30 seconds and recovery within 90 seconds. The recovered container retains its Pod UID and gets a new container identity.',
      ['Inspect the timeout, scheduled restart, readiness withdrawal/reentry, and the container identity change on the same Pod.', 'Require recovery within the 90-second bound and a successful final-window assistant request routed to the recovered Pod.'],
      'A healthy remote dependency policy should still recover a local process that cannot answer at all.',
      'independent-probe-hang', hangVerified, experiment('independent-probe-hang', 180)),
    requestTask({ id: 'final-answer', stageId: 'answer', text: 'Verify the recovered external assistant answers the prepared backups question from both current Ready Pods with the `training-backups` source.',
      explanation: 'This final request confirms that the chosen policy survives every dependency fault and the actual container recovery while preserving the supplied knowledge assistant.',
      hints: ['Ask how long backups are kept through `assistant-public` after the hang experiment is complete.', 'Confirm both Service backends are current Ready Pods using the built image and applied probes.'],
      examNote: 'Separate readiness for required dependencies, optional remote services, and local process liveness.',
      check: finalAnswer,
      solution: { steps: [...commands('kubectl get pods -n assistant',
        'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-public -o yaml'), scenario('independent-probe-final'), { kind: 'inspect' }] },
      scenarioId: 'independent-probe-final', target: finalTarget }),
  ],
}

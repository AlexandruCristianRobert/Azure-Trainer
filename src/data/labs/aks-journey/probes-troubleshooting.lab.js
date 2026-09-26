import { parsePythonProject } from '../../../lib/project/python.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { probeDependencies } from '../../../lib/kubernetes/probe-experiments.js'
import { probeScenario, probeTask, requestTask, probeReceiptPassed } from './probe-helpers.js'
import {
  seedProbesTroubleshooting, PROBES_TROUBLESHOOTING_CLUSTER, PROBES_TROUBLESHOOTING_GROUP,
  PROBES_TROUBLESHOOTING_IMAGE_BAD, PROBES_TROUBLESHOOTING_IMAGE_FIXED, PROBES_TROUBLESHOOTING_REGISTRY,
  PROBES_TROUBLESHOOTING_FILES,
} from './probe-seeds.js'
import { HEALTH_FIXTURES } from '../../fixtures/aks/health.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../../templates/aks-python/health.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${PROBES_TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${PROBES_TROUBLESHOOTING_CLUSTER}`
const namespace = 'assistant'
const target = { clusterId, namespace, deploymentName: 'assistant', serviceName: 'assistant-internal' }
const finalTarget = { ...target, serviceName: 'assistant-public' }
const file = (path, content = HEALTH_SOLUTION_FILES[path]) => ({ kind: 'file', path, content })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const experiment = (scenarioId, seconds) => [scenario(scenarioId), { kind: 'advance', seconds }]

const startupRepairDeployment = HEALTH_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksprobesguided.azurecr.io/assistant:health-v1', PROBES_TROUBLESHOOTING_IMAGE_BAD)

const fixedSolutionFiles = Object.freeze({
  ...HEALTH_SOLUTION_FILES,
  'app.py': HEALTH_SOLUTION_FILES['app.py'],
  'k8s/deployment.yaml': HEALTH_SOLUTION_FILES['k8s/deployment.yaml']
    .replace('acraksprobesguided.azurecr.io/assistant:health-v1', PROBES_TROUBLESHOOTING_IMAGE_FIXED),
})

function appHealth(context) {
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

function policy(context, wantedLive = true) {
  const endpoints = appHealth(context)?.endpoints
  if (!endpoints || endpoints.length !== 3) return false
  const expected = {
    '/health/startup': signals => signals.initialized,
    '/health/ready': signals => signals.initialized && signals.accepting_requests,
    '/health/live': () => wantedLive,
  }
  return Object.entries(expected).every(([path, evaluate]) => {
    const endpoint = endpoints.find(item => item.path === path)
    if (!endpoint) return false
    return [false, true].every(initialized => [false, true].every(accepting_requests =>
      [false, true].every(postgres_available => [false, true].every(ai_available => {
        const signals = { initialized, accepting_requests, postgres_available, ai_available }
        return expressionValue(endpoint.statusExpression, signals) === (evaluate(signals) ? 200 : 503)
      }))))
  })
}

function deployment(context) {
  return context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.['Deployment/assistant/assistant']
}

function normalizedManifest(context) {
  const result = parseKubernetesYaml(context.project.savedFiles['k8s/deployment.yaml'] ?? '', 'k8s/deployment.yaml')
  if (result.diagnostics.length || result.documents.length !== 1) return null
  const saved = structuredClone(result.documents[0])
  for (const container of saved.spec?.template?.spec?.containers ?? []) {
    for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
      if (container[name]?.httpGet) container[name].httpGet.scheme ??= 'HTTP'
    }
  }
  delete saved.spec?.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
  if (saved.spec?.template?.metadata?.annotations && !Object.keys(saved.spec.template.metadata.annotations).length)
    delete saved.spec.template.metadata.annotations
  return saved
}

function appliedManifestCurrent(context) {
  const current = deployment(context)
  const saved = normalizedManifest(context)
  if (!current || !saved) return false
  const applied = structuredClone(current.spec)
  delete applied.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
  if (applied.template?.metadata?.annotations && !Object.keys(applied.template.metadata.annotations).length)
    delete applied.template.metadata.annotations
  return canonicalize(applied) === canonicalize(saved.spec)
}

function startupBudget(context) {
  const probe = deployment(context)?.spec?.template?.spec?.containers?.[0]?.startupProbe
  if (!probe) return false
  const coveredMs = (probe.initialDelaySeconds + probe.periodSeconds * (probe.failureThreshold - 1)) * 1000
  return coveredMs >= HEALTH_FIXTURES.initializationSeconds * 1000
}

function badImageIsCurrent(context) {
  const image = deployment(context)?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[PROBES_TROUBLESHOOTING_IMAGE_BAD]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  return image === PROBES_TROUBLESHOOTING_IMAGE_BAD && !!artifact
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, HEALTH_MANIFEST))
}

function fixedImageIsCurrent(context) {
  const image = deployment(context)?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[PROBES_TROUBLESHOOTING_IMAGE_FIXED]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  return image === PROBES_TROUBLESHOOTING_IMAGE_FIXED && !!artifact
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, HEALTH_MANIFEST))
}

function historicalReceipt(context, scenarioId, taskId) {
  const evidenceId = context.evidence.currentEvidenceByTask?.[taskId]
  const evidence = evidenceId && context.evidence.experimentsById?.[evidenceId]
  const receipt = evidence?.measurements?.probeReceipt
  return evidence?.completed === true && evidence.outcome === 'passed' && evidence.scenarioId === scenarioId
    && receipt?.scenarioId === scenarioId && receipt.status === 'completed' && receipt.outcome === 'passed' ? receipt : null
}

function startupDiagnosis(context) {
  const receipt = historicalReceipt(context, 'trouble-probe-short-start', 'diagnose-startup')
  return !!receipt && receipt.summary.restartReceipts.some(item => item.probeType === 'StartupProbeFailed')
}

function startupRepairVerified(context) {
  const receipt = historicalReceipt(context, 'trouble-probe-startup-fixed', 'repair-startup')
  return !!receipt && receipt.summary.restartReceipts.length === 0 && startupBudget(context)
    && appliedManifestCurrent(context) && (badImageIsCurrent(context) || fixedImageIsCurrent(context))
}

function couplingDiagnosis(context) {
  const receipt = historicalReceipt(context, 'trouble-probe-ai-coupling', 'diagnose-coupling')
  return !!receipt && receipt.summary.restartReceipts.some(item => item.probeType === 'LivenessProbeFailed')
    && receipt.samples.some(item => item.second === 6 && item.request?.method === 'GET'
      && item.request?.path === '/api/info' && item.response?.status === 200)
}

function livenessRepairVerified(context) {
  const startup = historicalReceipt(context, 'trouble-probe-startup-fixed', 'repair-startup')
  return policy(context) && fixedImageIsCurrent(context) && appliedManifestCurrent(context)
    && startupBudget(context) && !!startup && startup.fingerprint?.image === PROBES_TROUBLESHOOTING_IMAGE_FIXED
    && probeReceiptPassed(context, 'repair-startup', 'trouble-probe-startup-fixed')
}

function currentReadyPods(context) {
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const pods = getDeploymentPods(context.run ?? context, clusterId, namespace, 'assistant')
  return pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running'
    && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
    && state.podSnapshots[pod.metadata.uid]?.artifactId === context.artifacts.publishedTags?.[PROBES_TROUBLESHOOTING_IMAGE_FIXED])
}

function preservedAiService(context) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask?.['preserve-service']]
  const samples = record?.measurements?.samples ?? []
  return livenessRepairVerified(context) && record?.outcome === 'passed' && record?.completed === true
    && record.scenarioId === 'trouble-probe-ai-tolerated' && currentReadyPods(context)
    && samples.some(item => item.second === 10 && item.response?.status === 200)
    && samples.some(item => item.second === 12 && item.response?.status === 503)
    && samples.some(item => item.second === 40 && item.response?.status === 200
      && item.response?.body?.sources?.includes('training-backups'))
}

function realHangRecovered(context) {
  const receipt = historicalReceipt(context, 'trouble-probe-real-hang', 'detect-real-hang')
  const state = context.runtime.kubernetes.clusters[clusterId]
  const restarted = receipt?.summary.restartReceipts.some(item => item.probeType === 'LivenessProbeFailed'
    && receipt.podUids.includes(item.podUid) && item.oldContainerId !== item.newContainerId
    && state.health.containers[item.podUid]?.containerId === item.newContainerId)
  return !!receipt && currentReadyPods(context)
    && restarted && receipt.samples.some(item => item.second === receipt.script.finishAfterStartSeconds
      && item.response?.status === 200 && item.response?.body?.sources?.includes('training-backups'))
    && receipt.samples.some(item => receipt.podUids.includes(item.faultedPodResponse?.podUid)
      && item.faultedPodResponse?.transport?.reason === 'PROCESS_TIMEOUT')
}

function finalAnswer(context) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask?.['final-answer']]
  const hang = historicalReceipt(context, 'trouble-probe-real-hang', 'detect-real-hang')
  return currentReadyPods(context) && livenessRepairVerified(context) && !!hang && !!record
    && record.outcome === 'passed' && record.completed === true && record.scenarioId === 'trouble-probe-final'
    && record.measurements?.body?.answer === 'Training backups are kept for 30 days.'
    && record.measurements?.body?.sources?.includes('training-backups')
}

function currentPodAction(run, _lab, task, resolver) {
  if (!['diagnose-startup', 'repair-startup', 'diagnose-coupling', 'repair-liveness', 'detect-real-hang'].includes(task.id))
    throw new Error('Current assistant Pod inspection is not available in this Solution.')
  const pods = getDeploymentPods(run, clusterId, namespace, 'assistant')
  const state = run.runtime.kubernetes?.clusters?.[clusterId]
  const withPrevious = pods.find(item => state.health.containers[item.metadata.uid]?.previous)
  const pod = resolver === 'previous-current-pod-logs' ? withPrevious ?? pods[0] : pods[0]
  if (!pod) throw new Error('No assistant Pod is available for the requested inspection.')
  const line = resolver === 'describe-current-pod'
    ? `kubectl describe pod ${pod.metadata.name} -n ${namespace}`
    : resolver === 'previous-current-pod-logs' ? `kubectl logs ${pod.metadata.name} -n ${namespace} --previous` : null
  if (!line) throw new Error('Unknown current Pod inspection command.')
  return { type: 'command', line }
}

const diagnosisDependencies = probeDependencies(target, { historical: true })
const probeDef = (id, stageId, text, explanation, hints, examNote, scenarioId, check, solution, dependencies) => probeTask({
  id, stageId, text, explanation, hints, examNote, scenarioId, check, solution, target, dependencies,
})

export const aksProbesTroubleshootingLab = {
  id: 'aks-probes-troubleshooting', title: 'Troubleshoot AKS probe restart loops', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 55,
  brief: 'Use Pod events, previous container logs, probe history, and bounded experiments to separate a startup budget that is too short from an unhealthy dependency policy. Repair both faults while preserving the Python knowledge assistant.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 14, labMode: 'troubleshooting',
  manifestId: HEALTH_MANIFEST.id, healthFixture: { initializationSeconds: HEALTH_FIXTURES.initializationSeconds, maximumWarmupSeconds: 60 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true },
  solutionActionResolvers: { 'describe-current-pod': currentPodAction, 'previous-current-pod-logs': currentPodAction },
  initialProjectFiles: PROBES_TROUBLESHOOTING_FILES, solutionFiles: fixedSolutionFiles, initializeSimulation: seedProbesTroubleshooting,
  stages: [
    { id: 'diagnose', title: 'Diagnose the startup and dependency failures', taskIds: ['diagnose-startup', 'repair-startup', 'diagnose-coupling'] },
    { id: 'repair', title: 'Repair liveness without hiding real hangs', taskIds: ['repair-liveness', 'preserve-service', 'detect-real-hang'] },
    { id: 'verify', title: 'Verify the recovered assistant', taskIds: ['final-answer'] },
  ],
  scenarios: {
    'trouble-probe-short-start': probeScenario('trouble-probe-short-start', target, HEALTH_FIXTURES.scenarios.coldStartup, 60),
    'trouble-probe-startup-fixed': probeScenario('trouble-probe-startup-fixed', target, HEALTH_FIXTURES.scenarios.coldStartup, 60),
    'trouble-probe-ai-coupling': probeScenario('trouble-probe-ai-coupling', target, HEALTH_FIXTURES.scenarios.optionalAiCoupling, 90),
    'trouble-probe-ai-tolerated': probeScenario('trouble-probe-ai-tolerated', target, HEALTH_FIXTURES.scenarios.optionalAiOutage, 90),
    'trouble-probe-real-hang': probeScenario('trouble-probe-real-hang', target, HEALTH_FIXTURES.scenarios.processHang, 150),
    'trouble-probe-final': { kind: 'aks-request', version: 1, target: finalTarget,
      connectivity: { origin: { kind: 'external' }, service: { namespace, name: 'assistant-public' }, port: 80 },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
      expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } },
      integrationProfile: 'healthy' },
  },
  tasks: [
    probeDef('diagnose-startup', 'diagnose', 'Run `trouble-probe-short-start` for its full 60-second window. Find the repeated `StartupProbeFailed` restarts, confirm startup never passes and readiness never begins, and preserve this diagnosis while you repair the startup budget.',
      'Each container gets 24 seconds to initialize, but the applied startup probe allows only three failed checks at five-second intervals. The process is being restarted before initialization can complete. The historical diagnosis is tied to the stable Deployment identity so a later repair does not erase what the original evidence showed.',
      ['Inspect Pod events and previous container logs, then run the named short-start experiment for the entire window.', 'Look for StartupProbeFailed events and verify that no readiness probe result appears before the next restart.'],
      'StartupProbeFailed means startup did not succeed within the configured startup budget; it does not identify a bad image by itself.',
      'trouble-probe-short-start', startupDiagnosis,
      { steps: [...experiment('trouble-probe-short-start', 60), ...commands('kubectl get pods -n assistant'),
        { kind: 'command', line: 'kubectl describe pod POD_NAME -n assistant', resolver: 'describe-current-pod', instruction: 'Choose a Pod from `kubectl get pods` and inspect its StartupProbeFailed events.' },
        { kind: 'command', line: 'kubectl logs POD_NAME -n assistant --previous', resolver: 'previous-current-pod-logs', instruction: 'Use a Pod with a restart to inspect the terminated container logs.' }, { kind: 'inspect' }] }, diagnosisDependencies),
    probeDef('repair-startup', 'diagnose', 'Give startup enough time for the 24-second initialization, save and apply the Deployment, then run `trouble-probe-startup-fixed`. Confirm startup succeeds, readiness and liveness start afterward, and the cold Pods become Ready without restart.',
      'The initialization time is a fixed fixture. A larger startup failureThreshold or initialDelaySeconds can protect it; editing the file alone does not change the active Deployment. This proof is refreshed again after the liveness repair changes the image.',
      ['Keep the complete Deployment and allow startup at least 24 seconds before the failure budget is exhausted.', 'Apply the corrected manifest, then complete the cold-start experiment and inspect probe results.'],
      'A startup probe should cover expected initialization while still bounding a genuinely stuck process.',
      'trouble-probe-startup-fixed', startupRepairVerified,
      { steps: [file('k8s/deployment.yaml', startupRepairDeployment), ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl get pods -n assistant'),
        ...experiment('trouble-probe-startup-fixed', 60), { kind: 'inspect' }] }),
    probeDef('diagnose-coupling', 'diagnose', 'Run `trouble-probe-ai-coupling`. During the AI-only outage, confirm `/api/info` succeeds at second 6, then identify the liveness-driven container restart caused by the AI-dependent `live()` handler.',
      'A local health handler should report whether this process can respond. The AI service is optional for `/api/info`; restarting the local process cannot restore an external AI dependency.',
      ['Start the scenario after the startup repair has a current proof.', 'Compare the second-6 `/api/info` sample with later liveness events and the restart receipt.'],
      'Keep liveness independent of optional remote services; use application-level dependency handling for transient AI failures.',
      'trouble-probe-ai-coupling', couplingDiagnosis,
      { steps: [...experiment('trouble-probe-ai-coupling', 90), { kind: 'inspect' }] }, diagnosisDependencies),
    probeDef('repair-liveness', 'repair', 'Change `live()` to a local responsive endpoint, save `app.py`, build `assistant:health-fixed`, update the complete Deployment image and apply it. Re-run `trouble-probe-startup-fixed` so the startup proof reflects the current image and configuration.',
      'The source build captures saved files and the running Pods keep their current image until Deployment rollout. The startup proof is deliberately rerun because a new image changes the probe experiment fingerprint.',
      ['Keep startup and readiness tied to their local signals; make liveness independent of `ai_available()`.', 'Build the saved source as `assistant:health-fixed`, update the full manifest, apply it, and refresh the startup proof.'],
      'A remote dependency outage is not a local process hang. Liveness should only restart an unresponsive process.',
      null, livenessRepairVerified,
      { steps: [file('app.py'), ...commands(`az acr build -r ${PROBES_TROUBLESHOOTING_REGISTRY} -t assistant:health-fixed .`),
        file('k8s/deployment.yaml', fixedSolutionFiles['k8s/deployment.yaml']), 'kubectl apply -f k8s/deployment.yaml', 'kubectl get pods -n assistant',
        ...experiment('trouble-probe-startup-fixed', 60), { kind: 'inspect' }].map(step => typeof step === 'string' ? { kind: 'command', line: step } : step) }),
    probeDef('preserve-service', 'repair', 'Run `trouble-probe-ai-tolerated`. Verify the Pods stay Ready with unchanged restart counts, `/api/info` remains healthy, `/api/ask` fails predictably during the outage, and the backups answer returns afterward.',
      'AI is optional for basic service availability. The bounded request adapter returns a controlled dependency failure while the outage is active; the assistant resumes its normal answer path when the fixture recovers.',
      ['Run the named optional-AI-outage experiment only after the liveness source and image are current.', 'Inspect samples at seconds 10, 12, and 40 and compare the restart receipts.'],
      'Treat a remote dependency failure in the request path without restarting a healthy local process.',
      'trouble-probe-ai-tolerated', context => preservedAiService(context) && probeReceiptPassed(context, 'preserve-service', 'trouble-probe-ai-tolerated'),
      { steps: [...experiment('trouble-probe-ai-tolerated', 90), { kind: 'inspect' }] }),
    probeDef('detect-real-hang', 'repair', 'Run `trouble-probe-real-hang`. Confirm requests time out, liveness restarts the container within the bounded window, the Pod UID stays the same, and both current Pods become Ready again.',
      'The hang fixture prevents every HTTP handler from responding, including a constant 200 liveness body. A real liveness probe still detects the timeout and restarts the container in its existing Pod.',
      ['Start the process-hang scenario with the full liveness probe applied.', 'Verify a PROCESS_TIMEOUT sample, a LivenessProbeFailed restart receipt, and recovery before finishing the window.'],
      'A successful `/api/info` during an AI outage distinguishes dependency coupling from a total process hang.',
      'trouble-probe-real-hang', realHangRecovered,
      { steps: [...experiment('trouble-probe-real-hang', 150), ...commands('kubectl get pods -n assistant'),
        { kind: 'command', line: 'kubectl describe pod POD_NAME -n assistant', resolver: 'describe-current-pod', instruction: 'Choose a current assistant Pod and inspect its recovery events.' },
        { kind: 'command', line: 'kubectl logs POD_NAME -n assistant --previous', resolver: 'previous-current-pod-logs', instruction: 'Inspect the terminated container logs for the Pod with a liveness restart.' }, { kind: 'inspect' }] }),
    requestTask({ id: 'final-answer', stageId: 'verify', text: 'Verify the recovered external assistant returns the prepared backups answer with the `training-backups` source from both current Ready Pods.',
      explanation: 'The final request confirms the repairs preserve the integration flow after the actual process hang recovery.',
      hints: ['Use the named final question through `assistant-public`.', 'Inspect the answer, source provenance, current image, and both Ready Service endpoints.'],
      examNote: 'A probe repair should restore fault recovery without breaking normal application behavior.', check: finalAnswer,
      solution: { steps: [...commands('kubectl get pods -n assistant', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-public -o yaml'), scenario('trouble-probe-final'), { kind: 'inspect' }] },
      scenarioId: 'trouble-probe-final', target: finalTarget }),
  ],
}

import { recordVerification } from '../labEngine/evidence.js'
import { getProjectManifest } from '../project/manifests.js'
import { restartDeploymentResult } from './reconcile.js'
import { routeServiceRequest } from './connectivity.js'
import { appendHealthReceipt } from './health-history.js'
const clone = value => structuredClone(value)
function digest(value) {
  let hash = 2166136261
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16)}`
}

function desiredObject(value) {
  if (!value) return null
  const next = clone(value)
  delete next.status
  delete next.metadata?.resourceVersion
  delete next.metadata?.generation
  delete next.metadata?.uid
  if (next.kind === 'Deployment') delete next.spec?.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
  if (next.kind === 'Secret') {
    const data = next.data ?? {}
    next.data = { keys: Object.keys(data).sort(), digest: digest(data) }
  }
  return next
}

function fingerprint(context, target) {
  const { clusterId, namespace, deploymentName, serviceName } = target ?? {}
  const resources = context.runtime.kubernetes?.clusters?.[clusterId]?.resources ?? {}
  const deployment = resources[`Deployment/${namespace}/${deploymentName}`] ?? null
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null
  const artifactId = image ? context.artifacts?.publishedTags?.[image] ?? null : null
  const artifact = artifactId ? context.artifacts?.buildsById?.[artifactId] ?? null : null
  const manifest = getProjectManifest(context.project.manifestId)
  const savedBuildFiles = Object.fromEntries((manifest.buildFiles ?? []).map(path => [path, digest(context.project.savedFiles[path] ?? null)]))
  const savedKubernetesFiles = Object.fromEntries(Object.entries(context.project.savedFiles ?? {})
    .filter(([path]) => /^k8s\/(?:deployment|configmap|secret|service).*\.ya?ml$/i.test(path))
    .sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => [path, /secret/i.test(path) ? { digest: digest(text) } : text]))
  const configuration = Object.values(resources).filter(item => ['ConfigMap', 'Secret'].includes(item.kind) && item.metadata?.namespace === namespace)
    .map(desiredObject).sort((a, b) => `${a.kind}/${a.metadata.name}`.localeCompare(`${b.kind}/${b.metadata.name}`))
  return { version: 1, clusterId, namespace, deploymentName, serviceName,
    deploymentUid: deployment?.metadata?.uid ?? null, deployment: desiredObject(deployment),
    service: desiredObject(resources[`Service/${namespace}/${serviceName}`] ?? null), configuration,
    image, artifact: artifact ? { id: artifact.id, sourceHash: artifact.sourceHash, digest: artifact.digest } : null,
    savedBuildFiles, savedKubernetesFiles }
}

export function probeDependencies(target, { historical = false } = {}) {
  const { clusterId, namespace, deploymentName } = target ?? {}
  if (historical) return { [`aks-probe-history:${clusterId}:${namespace}:${deploymentName}`]: context => {
    const deployment = context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.[`Deployment/${namespace}/${deploymentName}`]
    return { version: 1, clusterId, namespace, deploymentName, deploymentUid: deployment?.metadata?.uid ?? null,
      fixtureVersion: context.project.manifestId }
  } }
  return { [`aks-probe:${clusterId}:${namespace}:${deploymentName}`]: context => fingerprint(context, target) }
}

function invalid(message) { return { diagnostics: [{ code: 'INVALID_PROBE_EXPERIMENT', message }] } }

function sampleOffsets(script) {
  if (Array.isArray(script?.sampleAtSeconds)) return script.sampleAtSeconds.filter(Number.isInteger)
  if (!Number.isInteger(script?.firstSampleAfterStartSeconds) || !Number.isInteger(script?.sampleIntervalSeconds)) return []
  return Array.from({ length: Math.min(20, script.maxSamples ?? 0) }, (_, index) => script.firstSampleAfterStartSeconds + index * script.sampleIntervalSeconds)
}

function requestForSample(experiment, offset) {
  const kind = scenarioType({ script: experiment.script })
  const ask = () => ({ method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } })
  if (kind === 'readiness') return offset === 9 ? { method: 'GET', path: '/api/info', body: null } : ask()
  if (kind === 'hang') return { method: 'GET', path: '/api/info', body: null }
  if (experiment.script?.sampleAtSeconds?.length === 3) return offset === 10 ? { method: 'GET', path: '/api/info', body: null } : ask()
  return ask()
}

function captureSample(run, clusterId, experiment, nowMs, final = false) {
  let state = run.runtime.kubernetes.clusters[clusterId]
  if (!Number.isFinite(experiment.baselineReadyAtMs) || experiment.samples.length >= 100) return run
  const offset = (nowMs - experiment.baselineReadyAtMs) / 1000
  if ((!final && !sampleOffsets(experiment.script).includes(offset)) || experiment.samples.some(item => item.atMs === nowMs)) return run
  const containers = experiment.podUids.map(uid => state.health.containers[uid]).filter(Boolean)
  const sample = { atMs: nowMs, second: offset, offsetSeconds: offset, readyPodUids: experiment.podUids.filter(uid => state.health.containers[uid]?.ready === true),
    restartCounts: Object.fromEntries(containers.map(item => [item.containerId, item.restartCount])),
    readyBackendCount: containers.filter(item => item.ready).length, readyEndpoints: containers.filter(item => item.ready).length }
  const request = final ? { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } } : requestForSample(experiment, offset)
  const service = state.resources[`Service/${experiment.target.namespace}/assistant-public`]
  if (service?.status?.loadBalancer?.ingress?.[0]?.ip) {
    const kind = faultType(experiment.script)
    const faultActive = offset >= (experiment.script.startAfterStartSeconds ?? Infinity)
      && (experiment.script.endAfterStartSeconds === undefined || offset < experiment.script.endAfterStartSeconds)
    const integrationProfile = faultActive && (kind === 'ai' || kind === 'ai-coupling') ? 'answer-unavailable-always'
      : faultActive && kind === 'database' ? { stages: { embedding: [{ latencyMs: 40, result: 'success' }], postgres: [{ latencyMs: 30, code: 'UNAVAILABLE' }, { latencyMs: 30, code: 'UNAVAILABLE' }, { latencyMs: 30, code: 'UNAVAILABLE' }], answer: [{ latencyMs: 50, result: 'success' }] } } : 'healthy'
    const routed = routeServiceRequest(run, { origin: { kind: 'external', clusterId }, hostname: service.status.loadBalancer.ingress[0].ip,
      port: service.spec.ports?.[0]?.port ?? 80, ...request, integrationProfile }, null)
    run = routed.run; state = run.runtime.kubernetes.clusters[clusterId]
    sample.request = request
    sample.response = { requestId: routed.outcome.requestId, status: routed.outcome.status, body: routed.outcome.body, transport: routed.outcome.transport,
      route: routed.outcome.route, dependencyTrace: routed.outcome.dependencyTrace, integrationTrace: routed.outcome.integrationTrace ?? null }
  }
  const current = state.health.experiment
  if (!current) return run
  current.samples.push(sample)
  current.summary.sampleCount = current.samples.length
  current.summary.restartReceipts = state.health.receipts.filter(item => item.cause === 'probe' && current.podUids.includes(item.podUid)).slice(-40)
  return run
}

function scenarioType(receipt) {
  if (receipt.script?.initializationSeconds !== undefined) return 'cold'
  if (receipt.script?.endOnContainerTermination === true) return 'hang'
  if (receipt.script?.sampleAtSeconds?.length === 2 && receipt.script?.endAfterStartSeconds === 20) return 'readiness'
  return 'outage'
}

function faultType(script) {
  if (script?.endOnContainerTermination === true) return 'hang'
  if (script?.endAfterStartSeconds === 20 && Array.isArray(script.sampleAtSeconds)) return 'readiness'
  if (script?.endAfterStartSeconds === 25 && Array.isArray(script.sampleAtSeconds)) return 'database'
  if (script?.endAfterStartSeconds === 35 && Array.isArray(script.sampleAtSeconds)) return script.sampleAtSeconds.length === 1 ? 'ai-coupling' : 'ai'
  return null
}

function assess(state, receipt) {
  const containers = receipt.podUids.map(uid => state.health.containers[uid]).filter(Boolean)
  const allReady = containers.length === receipt.podUids.length && containers.every(item => item.ready)
  const completeProbes = containers.length > 0 && containers.every(item => ['startup', 'readiness', 'liveness'].every(kind => item.checks?.[kind]))
  const healthyChecks = completeProbes && containers.every(item => item.checks.startup.successes > 0 && item.checks.readiness.successes > 0 && item.checks.liveness.successes > 0)
  if (receipt.scenarioId.includes('short-start')) {
    const events = (state.health.events ?? []).filter(item => receipt.podUids.includes(item.podUid) && item.atMs >= receipt.startedAtMs)
    const restarts = state.health.receipts.filter(item => item.cause === 'probe' && receipt.podUids.includes(item.podUid) && item.atMs >= receipt.startedAtMs)
    return restarts.some(item => item.cause === 'probe' && item.probeType === 'StartupProbeFailed'
      && receipt.podUids.includes(item.podUid) && item.atMs >= receipt.startedAtMs)
      && !events.some(item => item.type === 'probe-result' && item.probeType === 'startup' && item.success)
      && !events.some(item => item.probeType === 'readiness')
  }
  if (scenarioType(receipt) === 'cold') {
    const events = (state.health.events ?? []).filter(item => receipt.podUids.includes(item.podUid))
    const firstStartupSuccess = Math.min(...events.filter(item => item.type === 'probe-result' && item.probeType === 'startup' && item.success).map(item => item.atMs))
    const initializedAt = receipt.startedAtMs + (receipt.initializationSeconds ?? receipt.script.initializationSeconds ?? 0) * 1000
    const earlyGatedCheck = events.some(item => item.type === 'probe-start' && ['readiness', 'liveness'].includes(item.probeType)
      && (!Number.isFinite(firstStartupSuccess) || item.atMs < firstStartupSuccess))
    return allReady && healthyChecks && containers.every(item => item.restartCount === 0)
      && Number.isFinite(firstStartupSuccess) && firstStartupSuccess >= initializedAt && !earlyGatedCheck
  }
  if (scenarioType(receipt) === 'readiness') return allReady && receipt.samples.length >= 2
    && receipt.samples.some(item => item.readyBackendCount < receipt.podUids.length && item.response?.route?.podUid !== receipt.podUids[0])
    && receipt.samples.some(item => item.second === 25 && item.response?.status === 200 && item.response?.body?.sources?.includes('training-backups'))
    && containers.every(item => item.restartCount === 0)
  if (scenarioType(receipt) === 'hang') return receipt.summary.restartReceipts.some(item => item.cause === 'probe' && item.probeType === 'LivenessProbeFailed'
    && receipt.podUids.includes(item.podUid) && item.atMs >= receipt.startedAtMs && item.oldContainerId !== item.newContainerId)
    && receipt.podUids.some(uid => state.health.containers[uid]?.containerId !== receipt.containerIds[uid])
    && receipt.samples.some(item => item.second === receipt.script.finishAfterStartSeconds && item.response?.status === 200
      && item.response?.body?.sources?.includes('training-backups'))
  const kind = faultType(receipt.script)
  if (kind === 'ai-coupling') return receipt.summary.restartReceipts.some(item => item.cause === 'probe'
    && item.probeType === 'LivenessProbeFailed' && receipt.podUids.includes(item.podUid) && item.atMs >= receipt.startedAtMs)
    && receipt.samples.some(item => item.second === 6 && item.response?.status === 200)
  if (kind === 'ai') return allReady && containers.every(item => item.restartCount === 0)
    && receipt.samples.some(item => item.second === 10 && item.response?.status === 200)
    && receipt.samples.some(item => item.second === 12 && item.response?.status === 503)
    && receipt.samples.some(item => item.second === 40 && item.response?.status === 200 && item.response?.body?.sources?.includes('training-backups'))
  if (kind === 'database') return allReady
    && receipt.samples.some(item => item.second === 10 && (item.response?.status === 503 || item.response?.transport?.reason === 'NO_READY_ENDPOINTS'))
    && receipt.samples.some(item => item.second === 30 && item.response?.status === 200 && item.response?.body?.sources?.includes('training-backups'))
  return allReady && receipt.samples.length > 0
}

function clearExperimentFaults(state, experiment) {
  for (const uid of experiment?.podUids ?? []) {
    const faults = state.health?.containers?.[uid]?.localFaults
    if (faults) { faults.admissionClosed = false; faults.hung = false }
  }
}

export function startProbeExperiment(input, scenarioId, lab) {
  const scenario = lab?.scenarios?.[scenarioId]
  if (!scenario || typeof scenarioId !== 'string') return { run: input, ...invalid('The selected probe experiment is not declared by this Lab.') }
  const durationSeconds = scenario.durationSeconds ?? scenario.script?.durationSeconds ?? scenario.script?.finishAfterStartSeconds ?? 60
  const clusterId = scenario.target?.clusterId
  if (scenario.kind !== 'aks-probe' || scenario.version !== 1 || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 300 || typeof clusterId !== 'string') return { run: input, ...invalid('The declared probe experiment has invalid bounded timing.') }
  let run = clone(input); let state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health || state.health.experiment !== null) return { run: input, ...invalid('A probe experiment is already active or its target cluster is unavailable.') }
  const deployment = state.resources?.[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]
  if (!deployment) return { run: input, ...invalid('The declared probe experiment target Deployment is unavailable.') }
  // This is the same rollout path as kubectl rollout restart.  The server-managed
  // annotation is deliberately omitted from the experiment fingerprint.
  const restarted = restartDeploymentResult(run, clusterId, scenario.target.namespace, scenario.target.deploymentName, lab)
  if (restarted.diagnostics.length) return { run: input, diagnostics: restarted.diagnostics }
  run = restarted.run; state = run.runtime.kubernetes.clusters[clusterId]
  const podUids = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === scenario.target.namespace
    && item.metadata.ownerReferences?.some(ref => ref.kind === 'ReplicaSet')).map(item => item.metadata.uid).sort()
  const diagnosticStartup = scenarioId.includes('short-start')
  const configuredWarmup = lab?.healthFixture?.maximumWarmupSeconds
  const warmupSeconds = diagnosticStartup ? 60 : Number.isInteger(configuredWarmup) ? configuredWarmup : durationSeconds
  const warmupDeadlineAtMs = run.runtime.simTimeMs + (Number.isInteger(configuredWarmup) || diagnosticStartup
    ? warmupSeconds : Math.min(durationSeconds, warmupSeconds)) * 1000
  state.health.experiment = { version: 1, scenarioId, scenarioVersion: 1, clusterId, target: clone(scenario.target),
    deploymentUid: state.resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]?.metadata.uid ?? null,
    fingerprint: fingerprint(run, scenario.target), podUids,
    containerIds: Object.fromEntries(podUids.map(uid => [uid, state.health.containers[uid]?.containerId ?? null])),
    initializationSeconds: lab?.healthFixture?.initializationSeconds ?? scenario.script?.initializationSeconds ?? 0,
    baselineReadyAtMs: null, startedAtMs: run.runtime.simTimeMs, endsAtMs: warmupDeadlineAtMs,
    status: 'active', phase: 'warming', samples: [], summary: { readinessIntervals: [], restartReceipts: [], sampleCount: 0 },
    script: { ...clone(scenario.script), kind: scenarioId } }
  return { run, diagnostics: [] }
}

export function observeProbeExperiment(input, atMs, lab) {
  let run = clone(input)
  if (Number.isFinite(atMs)) run.runtime.simTimeMs = atMs
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) {
    let state = run.runtime.kubernetes.clusters[clusterId]
    const experiment = state.health?.experiment
    if (!experiment || experiment.status !== 'active') continue
    const pods = Object.values(state.resources).filter(item => item.kind === 'Pod' && experiment.podUids.includes(item.metadata.uid))
    if (experiment.baselineReadyAtMs === null && pods.length === experiment.podUids.length
      && pods.every(pod => pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True'))) {
      experiment.baselineReadyAtMs = run.runtime.simTimeMs
      experiment.phase = 'running'
      const relativeFinishSeconds = scenarioType({ script: experiment.script }) === 'cold' ? 1
        : experiment.script.finishAfterStartSeconds
      // Legacy helper scenarios use their declared duration as their fixed
      // observation window. Authored Labs declare an explicit warmup cap.
      if (Number.isInteger(relativeFinishSeconds) && (Number.isInteger(lab?.healthFixture?.maximumWarmupSeconds)
        || experiment.scenarioId !== 'coldStartup')) {
        const scriptedDeadline = experiment.baselineReadyAtMs + relativeFinishSeconds * 1000
        const durationDeadline = experiment.startedAtMs + (lab?.scenarios?.[experiment.scenarioId]?.durationSeconds ?? 300) * 1000
        experiment.endsAtMs = Number.isInteger(lab?.healthFixture?.maximumWarmupSeconds)
          ? scriptedDeadline : Math.min(durationDeadline, scriptedDeadline)
      }
    }
    run = captureSample(run, clusterId, experiment, run.runtime.simTimeMs)
    state = run.runtime.kubernetes.clusters[clusterId]
    const current = state.health.experiment
    if (!current) continue
    if (run.runtime.simTimeMs < current.endsAtMs) continue
    if (scenarioType({ script: current.script }) === 'hang') {
      run = captureSample(run, clusterId, current, run.runtime.simTimeMs, true)
      state = run.runtime.kubernetes.clusters[clusterId]
    }
    const completed = state.health.experiment
    completed.summary.restartReceipts = state.health.receipts.filter(item => item.cause === 'probe' && completed.podUids.includes(item.podUid)
      && item.atMs >= completed.startedAtMs).slice(-40)
    const receipt = { ...completed, status: 'completed', endedAtMs: run.runtime.simTimeMs }
    receipt.outcome = assess(state, receipt) ? 'passed' : 'failed'
    appendHealthReceipt(state, receipt)
    clearExperimentFaults(state, completed)
    state.health.experiment = null
  }
  return run
}

export function finishProbeExperiment(input, lab) {
  let run = observeProbeExperiment(input, input.runtime.simTimeMs, lab)
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const receipt = state.health?.receipts?.at(-1)
    if (!receipt || receipt.status !== 'completed' || receipt.evidenceId) continue
    const task = lab?.tasks?.find(item => item.verification?.scenarioId === receipt.scenarioId && item.verification?.scenarioVersion === 1)
    if (!task) continue
    run = recordVerification(run, lab, task.id, { scenarioId: receipt.scenarioId, scenarioVersion: 1, outcome: receipt.outcome, completed: receipt.outcome === 'passed',
      startedAtMs: receipt.startedAtMs, endedAtMs: receipt.endedAtMs,
      measurements: { clusterId: receipt.clusterId, samples: receipt.samples, summary: receipt.summary, probeReceipt: receipt } })
    run.runtime.kubernetes.clusters[receipt.clusterId].health.receipts.at(-1).evidenceId = run.evidence.currentEvidenceByTask[task.id]
  }
  return run
}

export function cancelProbeExperiment(input, clusterId) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health?.experiment) return { run: input, ...invalid('There is no active probe experiment to cancel.') }
  const experiment = state.health.experiment
  appendHealthReceipt(state, { ...experiment, status: 'cancelled', endedAtMs: run.runtime.simTimeMs })
  clearExperimentFaults(state, experiment)
  state.health.experiment = null
  return { run, diagnostics: [] }
}

/** Cancel only when a learner changed an input captured by the experiment. */
export function cancelChangedProbeExperiments(input) {
  let run = input
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    const experiment = state.health?.experiment
    const podUids = Object.values(state.resources ?? {}).filter(item => item.kind === 'Pod' && item.metadata.namespace === experiment?.target?.namespace
      && item.metadata.ownerReferences?.some(ref => ref.kind === 'ReplicaSet')).map(item => item.metadata.uid).sort()
    if (!experiment || JSON.stringify(experiment.fingerprint) === JSON.stringify(fingerprint(run, experiment.target))
      && JSON.stringify(podUids) === JSON.stringify(experiment.podUids)) continue
    run = cancelProbeExperiment(run, clusterId).run
    const receipt = run.runtime.kubernetes.clusters[clusterId].health.receipts.at(-1)
    receipt.reason = 'Captured experiment inputs changed.'
  }
  return run
}

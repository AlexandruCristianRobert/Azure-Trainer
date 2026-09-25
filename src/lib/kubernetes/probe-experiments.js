import { recordVerification } from '../labEngine/evidence.js'
import { getProjectManifest } from '../project/manifests.js'
import { restartDeploymentResult } from './reconcile.js'
const clone = value => structuredClone(value)
function digest(value) {
  let hash = 2166136261
  for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `sha256:${(hash >>> 0).toString(16)}`
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
  const savedBuildFiles = Object.fromEntries((manifest.buildFiles ?? []).map(path => [path, context.project.savedFiles[path] ?? null]))
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

export function probeDependencies(target) {
  const { clusterId, namespace, deploymentName } = target ?? {}
  return { [`aks-probe:${clusterId}:${namespace}:${deploymentName}`]: context => fingerprint(context, target) }
}

function invalid(message) { return { diagnostics: [{ code: 'INVALID_PROBE_EXPERIMENT', message }] } }

function sampleOffsets(script) {
  if (Array.isArray(script?.sampleAtSeconds)) return script.sampleAtSeconds.filter(Number.isInteger)
  if (!Number.isInteger(script?.firstSampleAfterStartSeconds) || !Number.isInteger(script?.sampleIntervalSeconds)) return []
  return Array.from({ length: Math.min(20, script.maxSamples ?? 0) }, (_, index) => script.firstSampleAfterStartSeconds + index * script.sampleIntervalSeconds)
}

function captureSample(state, experiment, nowMs) {
  if (!Number.isFinite(experiment.baselineReadyAtMs) || experiment.samples.length >= 100) return
  const offset = (nowMs - experiment.baselineReadyAtMs) / 1000
  if (!sampleOffsets(experiment.script).includes(offset) || experiment.samples.some(item => item.atMs === nowMs)) return
  const containers = experiment.podUids.map(uid => state.health.containers[uid]).filter(Boolean)
  const sample = { atMs: nowMs, second: offset, offsetSeconds: offset, readyPodUids: experiment.podUids.filter(uid => state.health.containers[uid]?.ready === true),
    restartCounts: Object.fromEntries(containers.map(item => [item.containerId, item.restartCount])),
    readyBackendCount: containers.filter(item => item.ready).length, readyEndpoints: containers.filter(item => item.ready).length }
  experiment.samples.push(sample)
  experiment.summary.sampleCount = experiment.samples.length
  experiment.summary.restartReceipts = state.health.receipts.filter(item => item.cause === 'probe' && experiment.podUids.includes(item.podUid)).slice(-40)
}

function assess(state, receipt) {
  const containers = receipt.podUids.map(uid => state.health.containers[uid]).filter(Boolean)
  const allReady = containers.length === receipt.podUids.length && containers.every(item => item.ready)
  const completeProbes = containers.length > 0 && containers.every(item => ['startup', 'readiness', 'liveness'].every(kind => item.checks?.[kind]))
  const healthyChecks = completeProbes && containers.every(item => item.checks.startup.successes > 0 && item.checks.readiness.successes > 0 && item.checks.liveness.successes > 0)
  if (receipt.scenarioId === 'coldStartup') return allReady && healthyChecks && containers.every(item => item.restartCount === 0)
  if (receipt.scenarioId === 'temporaryAdmissionClosure') return allReady && receipt.samples.length >= 2
    && receipt.samples.some(item => item.readyBackendCount < receipt.podUids.length) && containers.every(item => item.restartCount === 0)
  if (receipt.scenarioId === 'processHang') return allReady && receipt.summary.restartReceipts.length > 0
  return allReady && receipt.samples.length > 0
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
  state.health.experiment = { version: 1, scenarioId, scenarioVersion: 1, clusterId, target: clone(scenario.target),
    deploymentUid: state.resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]?.metadata.uid ?? null,
    fingerprint: fingerprint(run, scenario.target), podUids,
    containerIds: Object.fromEntries(podUids.map(uid => [uid, state.health.containers[uid]?.containerId ?? null])),
    baselineReadyAtMs: null, startedAtMs: run.runtime.simTimeMs, endsAtMs: run.runtime.simTimeMs + durationSeconds * 1000,
    status: 'active', phase: 'warming', samples: [], summary: { readinessIntervals: [], restartReceipts: [], sampleCount: 0 },
    script: { ...clone(scenario.script), kind: scenarioId } }
  return { run, diagnostics: [] }
}

export function observeProbeExperiment(input, atMs, lab) {
  const run = clone(input)
  if (Number.isFinite(atMs)) run.runtime.simTimeMs = atMs
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const experiment = state.health?.experiment
    if (!experiment || experiment.status !== 'active') continue
    const pods = Object.values(state.resources).filter(item => item.kind === 'Pod' && experiment.podUids.includes(item.metadata.uid))
    if (experiment.baselineReadyAtMs === null && pods.length === experiment.podUids.length
      && pods.every(pod => pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True'))) {
      experiment.baselineReadyAtMs = run.runtime.simTimeMs
      experiment.phase = 'running'
    }
    captureSample(state, experiment, run.runtime.simTimeMs)
    if (run.runtime.simTimeMs < experiment.endsAtMs) continue
    const receipt = { ...experiment, status: 'completed', endedAtMs: run.runtime.simTimeMs }
    receipt.outcome = assess(state, receipt) ? 'passed' : 'failed'
    state.health.receipts = [...state.health.receipts, receipt].slice(-40)
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
    state.health.receipts.at(-1).evidenceId = run.evidence.currentEvidenceByTask[task.id]
  }
  return run
}

export function cancelProbeExperiment(input, clusterId) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health?.experiment) return { run: input, ...invalid('There is no active probe experiment to cancel.') }
  state.health.receipts = [...state.health.receipts, { ...state.health.experiment, status: 'cancelled', endedAtMs: run.runtime.simTimeMs }].slice(-40)
  state.health.experiment = null
  return { run, diagnostics: [] }
}

/** Cancel only when a learner changed an input captured by the experiment. */
export function cancelChangedProbeExperiments(input) {
  let run = input
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    const experiment = state.health?.experiment
    if (!experiment || JSON.stringify(experiment.fingerprint) === JSON.stringify(fingerprint(run, experiment.target))) continue
    run = cancelProbeExperiment(run, clusterId).run
    const receipt = run.runtime.kubernetes.clusters[clusterId].health.receipts.at(-1)
    receipt.reason = 'Captured experiment inputs changed.'
  }
  return run
}

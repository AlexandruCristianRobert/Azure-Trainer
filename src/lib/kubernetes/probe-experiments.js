const clone = value => structuredClone(value)

export function probeDependencies(target) {
  const { clusterId, namespace, deploymentName } = target ?? {}
  return { [`aks-probe:${clusterId}:${namespace}:${deploymentName}`]: context => {
    const state = context.runtime.kubernetes?.clusters?.[clusterId]
    const deployment = state?.resources?.[`Deployment/${namespace}/${deploymentName}`] ?? null
    return { clusterId, deploymentUid: deployment?.metadata?.uid ?? null, image: deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null, fixtureVersion: context.project.manifestId }
  } }
}

function invalid(message) { return { diagnostics: [{ code: 'INVALID_PROBE_EXPERIMENT', message }] } }

export function startProbeExperiment(input, scenarioId, lab) {
  const scenario = lab?.scenarios?.[scenarioId]
  if (!scenario || typeof scenarioId !== 'string') return { run: input, ...invalid('The selected probe experiment is not declared by this Lab.') }
  const durationSeconds = scenario.durationSeconds ?? scenario.script?.durationSeconds ?? scenario.script?.finishAfterStartSeconds ?? 60
  const clusterId = scenario.target?.clusterId
  if (scenario.kind !== 'aks-probe' || scenario.version !== 1 || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 300 || typeof clusterId !== 'string') return { run: input, ...invalid('The declared probe experiment has invalid bounded timing.') }
  const run = clone(input); const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health || state.health.experiment !== null) return { run: input, ...invalid('A probe experiment is already active or its target cluster is unavailable.') }
  state.health.experiment = { version: 1, scenarioId, clusterId, startedAtMs: run.runtime.simTimeMs,
    endsAtMs: run.runtime.simTimeMs + durationSeconds * 1000, status: 'active', script: { ...clone(scenario.script), kind: scenarioId } }
  return { run, diagnostics: [] }
}

export function observeProbeExperiment(input, atMs, lab) {
  const run = clone(input)
  if (Number.isFinite(atMs)) run.runtime.simTimeMs = atMs
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const experiment = state.health?.experiment
    if (!experiment || experiment.status !== 'active' || run.runtime.simTimeMs < experiment.endsAtMs) continue
    const receipt = { ...experiment, status: 'completed', endedAtMs: run.runtime.simTimeMs }
    state.health.receipts = [...state.health.receipts, receipt].slice(-40)
    state.health.experiment = null
  }
  return run
}

export function finishProbeExperiment(input, lab) { return observeProbeExperiment(input, input.runtime.simTimeMs, lab) }

export function cancelProbeExperiment(input, clusterId) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health?.experiment) return { run: input, ...invalid('There is no active probe experiment to cancel.') }
  state.health.receipts = [...state.health.receipts, { ...state.health.experiment, status: 'cancelled', endedAtMs: run.runtime.simTimeMs }].slice(-40)
  state.health.experiment = null
  return { run, diagnostics: [] }
}

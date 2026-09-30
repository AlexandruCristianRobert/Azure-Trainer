import { projectConfigurationAt } from './configuration.js'
import { processProbeTimestamp, reconcileHealth } from './probes.js'
import { reconcileServices } from './services.js'
import { processContainerLifecycle } from './container-lifecycle.js'
import { finishProbeExperiment, observeProbeExperiment } from './probe-experiments.js'
import { finishScheduledTerminations, schedulePendingPods } from './scheduling.js'
import { reconcileKubernetes } from './reconcile.js'
import { accountResourceSecond, sampleResourceMetrics } from './resource-usage.js'
import { reconcileHpa } from './hpa.js'
import { observeResourceExperiment } from './resource-experiments.js'
import { nextRolloutDeadline, reconcileRollouts } from './rollouts.js'
import { nextReleaseTimestamp, observeReleaseTimestamp } from './release-experiments.js'
import { refreshReleaseProofs } from './release-evidence.js'

const clone = value => structuredClone(value)

function nextHealthDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) for (const container of Object.values(state.health?.containers ?? {})) {
    for (const value of Object.values(container.checks ?? {})) {
      for (const deadline of [value?.nextAtMs, value?.pending?.completeAtMs]) {
        if (Number.isFinite(deadline) && deadline > run.runtime.simTimeMs && deadline <= limit && (next === null || deadline < next)) next = deadline
      }
    }
    for (const deadline of [container.terminatedAtMs, container.restartAtMs]) if (Number.isFinite(deadline) && deadline > run.runtime.simTimeMs && deadline <= limit && (next === null || deadline < next)) next = deadline
  }
  return next
}

function nextProjectionDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) for (const deadline of Object.values(state.projectionDue ?? {})) {
    if (Number.isFinite(deadline) && deadline > run.runtime.simTimeMs && deadline <= limit && (next === null || deadline < next)) next = deadline
  }
  return next
}

function nextExperimentDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const experiment = state.health?.experiment; if (!experiment || experiment.status !== 'active') continue
    const script = experiment.script ?? {}
    const anchor = experiment.baselineReadyAtMs
    const relative = Number.isFinite(anchor)
      ? [anchor + (script.startAfterStartSeconds ?? 0) * 1000,
        script.endAfterStartSeconds === undefined ? null : anchor + script.endAfterStartSeconds * 1000,
        ...(script.sampleAtSeconds ?? []).map(value => anchor + value * 1000),
        ...(Number.isInteger(script.firstSampleAfterStartSeconds) && Number.isInteger(script.sampleIntervalSeconds)
          ? Array.from({ length: script.maxSamples ?? 0 }, (_, index) => anchor + (script.firstSampleAfterStartSeconds + index * script.sampleIntervalSeconds) * 1000) : [])]
      : []
    for (const value of [...relative, experiment.endsAtMs]) {
      if (Number.isFinite(value) && value > run.runtime.simTimeMs && value <= limit && (next === null || value < next)) next = value
    }
  }
  return next
}

function scheduledEventCount(run, atMs) {
  let count = 0
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    count += Object.values(state.projectionDue ?? {}).filter(value => value === atMs).length
    for (const container of Object.values(state.health?.containers ?? {})) for (const check of Object.values(container.checks ?? {})) {
      if (check?.nextAtMs === atMs) count++
      if (check?.pending?.completeAtMs === atMs) count++
    }
  }
  return count
}

function reconcileProbeServices(run) {
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = reconcileServices(run, clusterId)
  return run
}

function nextTerminationDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) for (const deadline of Object.values(state.resourcesRuntime?.terminationDue ?? (state.rollouts ? Object.fromEntries(Object.values(state.resources)
    .filter(item => item.kind === 'Pod' && item.metadata.deletionTimestamp !== undefined)
    .map(pod => [pod.metadata.uid, pod.metadata.deletionTimestamp + (pod.spec.terminationGracePeriodSeconds ?? 30) * 1000])) : {}))) {
    if (Number.isFinite(deadline) && deadline > run.runtime.simTimeMs && deadline <= limit && (next === null || deadline < next)) next = deadline
  }
  return next
}

function nextAccountingDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const runtime = state.resourcesRuntime
    if (!runtime) continue
    const from = Number.isFinite(runtime.accountedUntilMs) ? runtime.accountedUntilMs + 1000 : run.runtime.simTimeMs + 1000
    if (from > run.runtime.simTimeMs && from <= limit && (next === null || from < next)) next = from
  }
  return next
}

function resourceTimestamp(run, atMs, lab) {
  run = accountResourceSecond(run, atMs, lab)
  run = processContainerLifecycle(run, atMs, lab)
  run = processProbeTimestamp(run, atMs, lab)
  run = reconcileProbeServices(run)
  run = sampleResourceMetrics(run, atMs, lab)
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = reconcileHpa(run, clusterId, atMs, lab)
  run = reconcileResourceTerminations(run, atMs, lab)
  return observeResourceExperiment(run, atMs, lab)
}

function reconcileResourceTerminations(run, atMs, lab) {
  if (lab?.capabilities?.kubernetesResources !== true && lab?.capabilities?.kubernetesRollouts !== true) return run
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = finishScheduledTerminations(run, clusterId, atMs, lab)
  run = reconcileKubernetes(run, lab)
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = schedulePendingPods(run, clusterId, lab)
  if (lab?.capabilities?.kubernetesRollouts === true) {
    // Settle probes on containers created at this exact timestamp. Deferring
    // their first zero-delay probe until the next advance changes startup age.
    run = processProbeTimestamp(processContainerLifecycle(run, atMs, lab), atMs, lab)
    for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = reconcileRollouts(run, clusterId, atMs, lab).run
    run = reconcileProbeServices(run)
  }
  return run
}

export function advanceKubernetesTimeResult(input, seconds, lab) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) return { run: input, diagnostics: [{ code: 'INVALID_AKS_ADVANCE', message: 'AKS time advance requires whole seconds from 1 through 300.' }] }
  let run = reconcileHealth(clone(input), lab)
  const target = run.runtime.simTimeMs + seconds * 1000
  run = reconcileResourceTerminations(projectConfigurationAt(run, run.runtime.simTimeMs), run.runtime.simTimeMs, lab)
  run = reconcileProbeServices(processProbeTimestamp(processContainerLifecycle(run, run.runtime.simTimeMs, lab), run.runtime.simTimeMs, lab))
  run = accountResourceSecond(run, run.runtime.simTimeMs, lab)
  run = sampleResourceMetrics(run, run.runtime.simTimeMs, lab)
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = reconcileHpa(run, clusterId, run.runtime.simTimeMs, lab)
  run = reconcileResourceTerminations(run, run.runtime.simTimeMs, lab)
  run = observeProbeExperiment(run, run.runtime.simTimeMs, lab)
  run = observeResourceExperiment(run, run.runtime.simTimeMs, lab)
  run = observeReleaseTimestamp(run, run.runtime.simTimeMs, lab)
  let events = scheduledEventCount(run, run.runtime.simTimeMs)
  if (events > 10_000) return { run: input, diagnostics: [{ code: 'SIMULATION_LIMIT', message: 'AKS probe advancement exceeded 10,000 scheduled events.' }] }
  while (true) {
    const next = [nextHealthDeadline(run, target), nextProjectionDeadline(run, target), nextExperimentDeadline(run, target), nextTerminationDeadline(run, target), nextAccountingDeadline(run, target), nextRolloutDeadline(run, target), nextReleaseTimestamp(run, target)].filter(Number.isFinite).sort((a, b) => a - b)[0]
    if (next === undefined) break
    events += scheduledEventCount(run, next)
    if (events > 10_000) return { run: input, diagnostics: [{ code: 'SIMULATION_LIMIT', message: 'AKS probe advancement exceeded 10,000 scheduled events.' }] }
    run.runtime.simTimeMs = next
    run = projectConfigurationAt(run, next)
    run = resourceTimestamp(run, next, lab)
    run = observeProbeExperiment(run, next, lab)
    run = observeReleaseTimestamp(run, next, lab)
  }
  run.runtime.simTimeMs = target
  run = projectConfigurationAt(run, target)
  run = reconcileProbeServices(processProbeTimestamp(processContainerLifecycle(run, target, lab), target, lab))
  run = accountResourceSecond(run, target, lab)
  run = sampleResourceMetrics(run, target, lab)
  for (const clusterId of Object.keys(run.runtime.kubernetes.clusters ?? {})) run = reconcileHpa(run, clusterId, target, lab)
  run = reconcileResourceTerminations(run, target, lab)
  run = observeProbeExperiment(run, target, lab)
  run = observeResourceExperiment(run, target, lab)
  run = observeReleaseTimestamp(run, target, lab)
  run = refreshReleaseProofs(run, lab)
  return { run: finishProbeExperiment(run, lab), diagnostics: [] }
}

export function advanceKubernetesTime(input, seconds, lab) { return advanceKubernetesTimeResult(input, seconds, lab).run }

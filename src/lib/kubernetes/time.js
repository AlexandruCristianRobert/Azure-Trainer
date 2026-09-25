import { projectConfigurationAt } from './configuration.js'
import { processProbeTimestamp, reconcileHealth } from './probes.js'

const clone = value => structuredClone(value)

function nextHealthDeadline(run, limit) {
  let next = null
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) for (const container of Object.values(state.health?.containers ?? {})) {
    for (const value of Object.values(container.checks ?? {})) {
      for (const deadline of [value?.nextAtMs, value?.pending?.completeAtMs]) {
        if (Number.isFinite(deadline) && deadline > run.runtime.simTimeMs && deadline <= limit && (next === null || deadline < next)) next = deadline
      }
    }
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

export function advanceKubernetesTimeResult(input, seconds, lab) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) return { run: input, diagnostics: [{ code: 'INVALID_AKS_ADVANCE', message: 'AKS time advance requires whole seconds from 1 through 300.' }] }
  let run = reconcileHealth(clone(input), lab)
  const target = run.runtime.simTimeMs + seconds * 1000
  run = projectConfigurationAt(run, run.runtime.simTimeMs)
  run = processProbeTimestamp(run, run.runtime.simTimeMs, lab)
  let events = scheduledEventCount(run, run.runtime.simTimeMs)
  if (events > 10_000) return { run: input, diagnostics: [{ code: 'SIMULATION_LIMIT', message: 'AKS probe advancement exceeded 10,000 scheduled events.' }] }
  while (true) {
    const next = [nextHealthDeadline(run, target), nextProjectionDeadline(run, target)].filter(Number.isFinite).sort((a, b) => a - b)[0]
    if (next === undefined) break
    events += scheduledEventCount(run, next)
    if (events > 10_000) return { run: input, diagnostics: [{ code: 'SIMULATION_LIMIT', message: 'AKS probe advancement exceeded 10,000 scheduled events.' }] }
    run.runtime.simTimeMs = next
    run = projectConfigurationAt(run, next)
    run = processProbeTimestamp(run, next, lab)
  }
  run.runtime.simTimeMs = target
  run = projectConfigurationAt(run, target)
  run = processProbeTimestamp(run, target, lab)
  return { run, diagnostics: [] }
}

export function advanceKubernetesTime(input, seconds, lab) { return advanceKubernetesTimeResult(input, seconds, lab).run }

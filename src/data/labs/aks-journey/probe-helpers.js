import { integrationDependencies } from '../../../lib/kubernetes/evidence.js'
import { probeDependencies } from '../../../lib/kubernetes/probe-experiments.js'

export function probeScenario(scenarioId, target, script, durationSeconds) {
  return Object.freeze({ kind: 'aks-probe', version: 1, title: scenarioId,
    target: Object.freeze({ ...target }), durationSeconds, script: Object.freeze({ ...script }) })
}

export function probeTask({ id, stageId, text, explanation, hints, examNote, check, solution, scenarioId, target, dependencies }) {
  return { id, stageId, text, explanation, hints, examNote, check, solution,
    ...(scenarioId ? { verification: { scenarioId, scenarioVersion: 1 }, dependencies: dependencies ?? probeDependencies(target) } : {}) }
}

export function requestTask({ id, stageId, text, explanation, hints, examNote, check, solution, scenarioId, target }) {
  return { id, stageId, text, explanation, hints, examNote, check, solution,
    verification: { scenarioId, scenarioVersion: 1 }, dependencies: integrationDependencies(target) }
}

export function probeReceiptPassed(context, taskId, scenarioId) {
  const evidenceId = context.evidence.currentEvidenceByTask?.[taskId]
  const evidence = evidenceId && context.evidence.experimentsById?.[evidenceId]
  const receipt = evidence?.measurements?.probeReceipt
  return evidence?.completed === true && evidence.outcome === 'passed'
    && evidence.scenarioId === scenarioId && receipt?.status === 'completed' && receipt.outcome === 'passed'
}

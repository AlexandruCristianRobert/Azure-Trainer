import { resourceDependencies } from '../../../lib/kubernetes/evidence.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'

export function resourceScenario(profileId, target, requiredReadyReplicas = 2) {
  return Object.freeze({ kind: 'aks-resource-profile', version: 1, target: Object.freeze({ ...target }), requiredReadyReplicas, profileId })
}

export function resourceTask({ id, stageId, text, explanation, hints, examNote, check, solution, scenarioId, target, historical = false, profileId = null, dependencies = null }) {
  return { id, stageId, text, explanation, hints, examNote, check, solution,
    ...(scenarioId ? { verification: { scenarioId, scenarioVersion: 1 }, dependencies: dependencies ?? resourceDependencies(target, { historical, profileId }) } : {}) }
}

export function resourceReceipt(context, taskId, scenarioId, dependencies = {}) {
  const evidenceId = context.evidence.currentEvidenceByTask?.[taskId]
  const evidence = evidenceId && context.evidence.experimentsById?.[evidenceId]
  if (!evidence || evidence.taskId !== taskId || evidence.scenarioId !== scenarioId || evidence.scenarioVersion !== 1
    || evidence.completed !== true || evidence.outcome !== 'passed') return null
  for (const [key, select] of Object.entries(dependencies)) {
    try {
      if (canonicalize(evidence.dependencyValues?.[key]) !== canonicalize(select(context))
        || evidence.dependencyGenerations?.[key] !== (context.dependencyGenerations?.[key] ?? 0)) return null
    } catch { return null }
  }
  return evidence.measurements
}

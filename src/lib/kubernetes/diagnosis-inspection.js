import { getProjectManifest } from '../project/manifests.js'
import { redactRequestValue } from './request-records.js'
import { inspectDeploymentConsistency } from './release-evidence.js'

/** Read-only projection: no routing, reconciliation, evidence allocation or clock advance. */
export function inspectDiagnosis(input, target) {
  const run = input ? JSON.parse(JSON.stringify(input)) : null
  const state = run?.runtime.kubernetes?.clusters?.[target?.clusterId]
  const scoped = item => item.clusterId === target.clusterId && (!target.namespace || item.namespace === target.namespace)
  const records = (run?.runtime.kubernetes?.requests ?? []).filter(item => item.diagnosticsVersion === 1 && scoped(item))
  const requestId = target.requestId ?? records.at(-1)?.id ?? null
  const selected = records.find(item => item.id === requestId) ?? null
  const containers = Object.entries(state?.health?.containers ?? {}).filter(([uid]) => !target.namespace
    || Object.values(state.resources).some(pod => pod.kind === 'Pod' && pod.metadata.uid === uid && pod.metadata.namespace === target.namespace))
  const logMatches = log => typeof log === 'object' && log !== null && scoped(log) && log.requestId === requestId
  const current = containers.flatMap(([, container]) => container.currentLogs).filter(logMatches)
  const previous = containers.flatMap(([, container]) => container.previous?.logs ?? []).filter(logMatches)
  const incident = state?.diagnosis?.incident
  const history = incident && incident.attemptId === run.attemptId && (!target.namespace || incident.target.namespace === target.namespace)
    ? { id: incident.id, epoch: incident.epoch, phaseId: incident.phaseId, active: incident.active,
      observations: incident.observations, recoveries: incident.recoveries,
      selected: [...incident.observations, ...incident.recoveries].find(item => item.id === requestId) ?? null } : null
  const events = [
    ...(state?.events ?? []).filter(event => !target.namespace || event.metadata?.namespace === target.namespace).map(event => ({ ...event, association: 'namespace' })),
    ...(state?.health?.events ?? []).filter(event => selected?.podUid && event.podUid === selected.podUid)
      .map(event => ({ ...event, reason: event.reason ?? event.type, simTimeMs: event.atMs ?? null, association: 'pod' })),
  ]
  const consistency = run && target.deploymentName ? inspectDeploymentConsistency(run, target, getProjectManifest(run.project.manifestId)) : null
  return redactRequestValue({ incident: history, requests: { records, selected, truncated: run?.runtime.kubernetes?.requestsTruncated ?? 0 },
    logs: { current, previous, truncated: containers.reduce((total, [, container]) => total + (container.logsTruncated ?? 0) + (container.previous?.logsTruncated ?? 0), 0) },
    events, consistency }, state)
}

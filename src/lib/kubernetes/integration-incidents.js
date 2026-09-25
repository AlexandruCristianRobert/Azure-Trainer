import { stringify } from 'yaml'
import { saveProjectFile } from '../project/files.js'
import { parseKubernetesYaml } from './yaml.js'
import { applyKubernetesObjects } from './objects.js'
import { reconcileKubernetesResult, restartDeploymentResult } from './reconcile.js'
import { AI_TROUBLESHOOTING_CLUSTER_ID, AI_TROUBLESHOOTING_LAB_ID, INTEGRATION_INCIDENT_FILES, INTEGRATION_INCIDENT_PHASES } from '../../data/labs/aks-journey/integration-incidents.js'

const diagnostic = (code, message) => ({ code, message, path: '', line: 1, column: 1 })
const phaseFor = value => INTEGRATION_INCIDENT_PHASES.find(item => item.phase === value)
const recordFor = (run, taskId) => {
  const id = run.evidence?.currentEvidenceByTask?.[taskId]
  return id && run.evidence?.experimentsById?.[id]
}
function recovered(run, lab, phase) {
  const item = phaseFor(phase)
  const record = recordFor(run, item?.recoveryTask)
  const deployment = run.runtime.kubernetes.clusters?.[AI_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']
  return !!record && record.attemptId === run.attemptId && record.labId === lab.id && record.taskId === item.recoveryTask
    && record.scenarioId === item.recoveryScenario && record.outcome === 'passed' && record.completed
    && record.measurements?.deploymentUid === deployment?.metadata?.uid
}
function observed(run, lab, phase) {
  const item = phaseFor(phase); const record = recordFor(run, item?.failureTask)
  return !!record && record.attemptId === run.attemptId && record.labId === lab.id && record.taskId === item.failureTask && record.outcome === 'passed' && record.completed
}
export function advanceIntegrationIncident(run, lab) {
  const incident = run.runtime?.kubernetes?.integrationIncident
  const current = phaseFor(incident?.phase)
  if (lab?.id !== AI_TROUBLESHOOTING_LAB_ID || run.labId !== AI_TROUBLESHOOTING_LAB_ID || !current) return { run, diagnostics: [diagnostic('AKS_INCIDENT_NOT_READY', 'This Lab has no active assistant incident.')], lines: [] }
  if (!current.next) return { run, diagnostics: [diagnostic('AKS_INCIDENT_COMPLETE', 'All assistant incidents are already available.')], lines: [] }
  const dirty = INTEGRATION_INCIDENT_FILES.find(path => run.project.draftFiles[path] !== run.project.savedFiles[path])
  if (dirty) return { run, diagnostics: [diagnostic('AKS_UNSAVED_INCIDENT_SOURCE', `Save the draft ${dirty} before continuing the incident.`)], lines: [] }
  if (!observed(run, lab, current.phase) || !recovered(run, lab, current.phase)) return { run, diagnostics: [diagnostic('AKS_INCIDENT_NOT_READY', `Observe the active failure and verify ${current.recoveryScenario} through the current Deployment before continuing.`)], lines: [] }
  if (current.phase === 'filter') {
    const sequence = run.nextSequence
    return { run: { ...run, nextSequence: sequence + 1, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, integrationIncident: { ...incident, phase: current.next, transitions: [...incident.transitions, { from: current.phase, to: current.next, sequence, evidenceId: recordFor(run, current.recoveryTask).id, deploymentUid: run.runtime.kubernetes.clusters[AI_TROUBLESHOOTING_CLUSTER_ID].resources['Deployment/assistant/assistant'].metadata.uid }] } } } }, diagnostics: [], lines: [{ kind: 'out', text: 'Incident advanced to retry.' }] }
  }
  const path = 'k8s/configmap.yaml'; const parsed = parseKubernetesYaml(run.project.savedFiles[path], path)
  const resource = parsed.documents?.[0]
  if (parsed.diagnostics.length || parsed.documents.length !== 1 || resource?.kind !== 'ConfigMap' || resource.metadata?.namespace !== 'assistant') return { run, diagnostics: [diagnostic('AKS_INCIDENT_SOURCE_INVALID', 'The saved assistant ConfigMap is not valid.')], lines: [] }
  const live = run.runtime.kubernetes.clusters?.[AI_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['ConfigMap/assistant/assistant-config']
  if (!live || JSON.stringify(live.data ?? {}) !== JSON.stringify(resource.data ?? {})) return { run, diagnostics: [diagnostic('AKS_INCIDENT_SOURCE_STALE', 'Apply the saved assistant ConfigMap before continuing the incident.')], lines: [] }
  const expected = current.phase === 'deployment' ? ['EMBEDDING_DEPLOYMENT', 'embeddings-v1'] : ['AUDIENCE', 'employee']
  if (resource.data?.[expected[0]] !== expected[1]) return { run, diagnostics: [diagnostic('AKS_INCIDENT_SOURCE_INVALID', 'Repair the current ConfigMap value before continuing.')], lines: [] }
  resource.data.AUDIENCE = 'visitor'
  const saved = saveProjectFile(run.project, path, stringify(resource)); if (saved.diagnostics.length) return { run, diagnostics: saved.diagnostics, lines: [] }
  let next = { ...run, project: saved.project, dependencyGenerations: { ...run.dependencyGenerations, [`file:${path}`]: (run.dependencyGenerations[`file:${path}`] ?? 0) + 1 } }
  const applied = applyKubernetesObjects(next, parseKubernetesYaml(next.project.savedFiles[path], path).documents, { clusterId: AI_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant' }, lab)
  if (applied.diagnostics.length) return { run, diagnostics: applied.diagnostics, lines: [] }
  const reconciled = reconcileKubernetesResult(applied.run, lab); if (reconciled.diagnostics.length) return { run, diagnostics: reconciled.diagnostics, lines: [] }
  const restarted = restartDeploymentResult(reconciled.run, AI_TROUBLESHOOTING_CLUSTER_ID, 'assistant', 'assistant', lab); if (restarted.diagnostics.length) return { run, diagnostics: restarted.diagnostics, lines: [] }
  next = restarted.run
  const sequence = next.nextSequence
  return { run: { ...next, nextSequence: sequence + 1, runtime: { ...next.runtime, kubernetes: { ...next.runtime.kubernetes, integrationIncident: { ...incident, phase: current.next, transitions: [...incident.transitions, { from: current.phase, to: current.next, sequence, evidenceId: recordFor(run, current.recoveryTask).id, deploymentUid: next.runtime.kubernetes.clusters[AI_TROUBLESHOOTING_CLUSTER_ID].resources['Deployment/assistant/assistant'].metadata.uid }] } } } }, diagnostics: [], lines: [{ kind: 'out', text: `Incident advanced to ${current.next}.` }] }
}

import { stringify } from 'yaml'
import { saveProjectFile } from '../project/files.js'
import { parseKubernetesYaml } from './yaml.js'
import { applyKubernetesObjects } from './objects.js'
import { reconcileKubernetesResult, restartDeploymentResult } from './reconcile.js'
import { CONFIG_INCIDENT_PHASES, CONFIG_TROUBLESHOOTING_CLUSTER_ID, CONFIG_TROUBLESHOOTING_FILES, CONFIG_TROUBLESHOOTING_IMAGE, CONFIG_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/config-incidents.js'

const message = (code, text) => ({ code, message: text, path: '', line: 1, column: 1 })
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)

function evidenceFor(run, lab, phase) {
  const phaseDefinition = CONFIG_INCIDENT_PHASES.find(item => item.phase === phase)
  const entering = run.runtime.kubernetes.configIncident.transitions.find(item => item.to === phase)
  const task = lab.tasks.find(item => item.id === phaseDefinition?.taskId)
  const evidenceId = task && run.evidence?.currentEvidenceByTask?.[task.id]
  const record = evidenceId && run.evidence?.experimentsById?.[evidenceId]
  const latestSequence = Object.values(run.evidence?.experimentsById ?? {})
    .filter(item => item.taskId === phaseDefinition?.taskId).reduce((latest, item) => Math.max(latest, item.sequence ?? 0), 0)
  if (!task || !record || record.id !== evidenceId || record.attemptId !== run.attemptId || record.labId !== run.labId
    || record.taskId !== task.id || record.scenarioId !== phaseDefinition.scenarioId || record.scenarioVersion !== 1
    || record.outcome !== 'passed' || record.completed !== true
    || record.measurements?.clusterId !== CONFIG_TROUBLESHOOTING_CLUSTER_ID
    || record.measurements?.namespace !== 'assistant' || record.measurements?.deploymentName !== 'assistant'
    || record.measurements?.serviceName !== 'assistant' || record.measurements?.artifactId !== run.artifacts.publishedTags[CONFIG_TROUBLESHOOTING_IMAGE]
    || record.sequence <= (entering?.sequence ?? 0) || record.sequence !== latestSequence) return null
  const context = { sandbox: run.sandbox, project: run.project, artifacts: run.artifacts, runtime: run.runtime,
    evidence: run.evidence, dependencyGenerations: run.dependencyGenerations, stages: run.stages, history: run.history }
  for (const [key, selector] of Object.entries(task.dependencies ?? {})) {
    try {
      if ((record.dependencyGenerations?.[key] ?? 0) !== (run.dependencyGenerations[key] ?? 0)
        || canonical(record.dependencyValues?.[key]) !== canonical(selector(context))) return null
    } catch { return null }
  }
  return record
}

function injectedManifest(text, phase) {
  const parsed = parseKubernetesYaml(text, 'k8s/configmap.yaml')
  if (parsed.diagnostics.length || parsed.documents.length !== 1) return null
  const resource = parsed.documents[0]
  if (resource?.apiVersion !== 'v1' || resource.kind !== 'ConfigMap' || resource.metadata?.name !== 'assistant-config'
    || resource.metadata?.namespace !== 'assistant' || !resource.data || typeof resource.data !== 'object') return null
  if (phase === 'reference') {
    if (typeof resource.data.PGDATABASE !== 'string' || resource.data.APP_ENV !== 'training') return null
    delete resource.data.PGDATABASE
  } else if (phase === 'key') {
    if (resource.data.PGDATABASE !== 'knowledge' || resource.data.APP_ENV !== 'training') return null
    resource.data.APP_ENV = 'training-updated'
  } else return null
  return stringify(resource)
}

export function advanceConfigIncident(run, lab) {
  const incident = run?.runtime?.kubernetes?.configIncident
  const phase = CONFIG_INCIDENT_PHASES.find(item => item.phase === incident?.phase)
  if (lab?.id !== CONFIG_TROUBLESHOOTING_LAB_ID || run?.labId !== CONFIG_TROUBLESHOOTING_LAB_ID || !incident || !phase)
    return { run, diagnostics: [message('AKS_INCIDENT_NOT_READY', 'This Lab has no active staged configuration incident.')], lines: [] }
  if (!phase.next) return { run, diagnostics: [message('AKS_INCIDENT_COMPLETE', 'All three configuration incidents have been investigated.')], lines: [] }
  const changed = CONFIG_TROUBLESHOOTING_FILES.find(path => run.project.draftFiles[path] !== run.project.savedFiles[path])
  if (changed) return { run, diagnostics: [message('AKS_UNSAVED_INCIDENT_SOURCE', `Save the draft ${changed} before continuing the incident.`)], lines: [] }
  const evidence = evidenceFor(run, lab, phase.phase)
  if (!evidence) return { run, diagnostics: [message('AKS_INCIDENT_NOT_READY', `Complete a fresh passing ${phase.scenarioId} verification for the current incident before continuing.`)], lines: [] }
  const text = injectedManifest(run.project.savedFiles['k8s/configmap.yaml'], phase.phase)
  if (!text) return { run, diagnostics: [message('AKS_INCIDENT_SOURCE_INVALID', 'The saved assistant-config manifest no longer has the expected recovery state.')], lines: [] }

  const saved = saveProjectFile(run.project, 'k8s/configmap.yaml', text)
  if (saved.diagnostics.length) return { run, diagnostics: saved.diagnostics, lines: [] }
  let next = { ...run, project: saved.project,
    dependencyGenerations: { ...run.dependencyGenerations, 'file:k8s/configmap.yaml': (run.dependencyGenerations['file:k8s/configmap.yaml'] ?? 0) + 1 } }
  const parsed = parseKubernetesYaml(text, 'k8s/configmap.yaml')
  const applied = applyKubernetesObjects(next, parsed.documents, { clusterId: CONFIG_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant' }, lab)
  if (applied.diagnostics.length) return { run, diagnostics: applied.diagnostics, lines: [] }
  const reconciled = reconcileKubernetesResult(applied.run, lab)
  if (reconciled.diagnostics.length) return { run, diagnostics: reconciled.diagnostics, lines: [] }
  next = reconciled.run
  if (phase.phase === 'reference') {
    const restarted = restartDeploymentResult(next, CONFIG_TROUBLESHOOTING_CLUSTER_ID, 'assistant', 'assistant', lab)
    if (restarted.diagnostics.length) return { run, diagnostics: restarted.diagnostics, lines: [] }
    next = restarted.run
  }
  const sequence = next.nextSequence
  const transition = { sequence, from: phase.phase, to: phase.next, evidenceId: evidence.id, attemptId: run.attemptId }
  next = { ...next, nextSequence: sequence + 1,
    runtime: { ...next.runtime, kubernetes: { ...next.runtime.kubernetes, configIncident: { ...incident,
      phase: phase.next, transitions: [...incident.transitions, transition] } } } }
  const nextPhase = CONFIG_INCIDENT_PHASES.find(item => item.phase === phase.next)
  return { run: next, diagnostics: [], lines: [{ kind: 'out', text: `Incident advanced to ${phase.next}: ${nextPhase.message}` }] }
}

export function configIncidentEvidenceForPhase(run, lab, phase = run?.runtime?.kubernetes?.configIncident?.phase) {
  return evidenceFor(run, lab, phase)
}

export function isConfigIncidentFileDraftClean(run) {
  return CONFIG_TROUBLESHOOTING_FILES.every(path => run?.project?.draftFiles?.[path] === run?.project?.savedFiles?.[path])
}

export { CONFIG_INCIDENT_PHASES }

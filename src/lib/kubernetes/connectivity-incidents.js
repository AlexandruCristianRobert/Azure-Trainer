import { stringify } from 'yaml'
import { saveProjectFile } from '../project/files.js'
import { parseKubernetesYaml } from './yaml.js'
import { applyKubernetesObjects } from './objects.js'
import { reconcileKubernetesResult, restartDeploymentResult } from './reconcile.js'
import { CONNECTIVITY_INCIDENT_PHASES, CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, CONNECTIVITY_TROUBLESHOOTING_FILES, CONNECTIVITY_TROUBLESHOOTING_IMAGE, CONNECTIVITY_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/connectivity-troubleshooting-incidents.js'

const diagnostic = (code, message, path = '') => ({ code, message, path, line: 1, column: 1 })
const incidentAt = (run, clusterId = CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID) => run.runtime.kubernetes.clusters?.[clusterId]?.connectivity?.incident
const evidence = (run, id) => typeof id === 'string' ? run.evidence?.experimentsById?.[id] : null

function matchingRecord(run, lab, phase, field, record) {
  const taskId = field === 'observations' ? phase.observation : phase.recovery
  const scenarioId = field === 'observations' ? phase.observationScenario : phase.recoveryScenario
  if (!scenarioId || record?.attemptId !== run.attemptId || record?.labId !== lab.id || record?.taskId !== taskId
    || record?.scenarioId !== scenarioId || record?.scenarioVersion !== 1 || record.outcome !== 'passed' || record.completed !== true
    || record.measurements?.clusterId !== CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID
    || record.measurements?.namespace !== 'assistant' || record.measurements?.deploymentName !== 'assistant'
    || record.measurements?.deploymentUid !== run.runtime.kubernetes.clusters?.[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']?.metadata?.uid
    || record.measurements?.serviceName !== 'assistant-internal') return false
  const expectedImage = run.artifacts.publishedTags?.[CONNECTIVITY_TROUBLESHOOTING_IMAGE]
  const deploymentImage = run.runtime.kubernetes.clusters?.[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']?.spec?.template?.spec?.containers?.[0]?.image
  return !!expectedImage && deploymentImage === CONNECTIVITY_TROUBLESHOOTING_IMAGE
    && (record.measurements?.artifactId === null || record.measurements?.artifactId === expectedImage)
}

export function recordConnectivityIncidentEvidence(run, lab, task, record) {
  if (lab?.id !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID || run.labId !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID) return run
  const phase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === incidentAt(run)?.phase)
  if (!phase) return run
  const field = task.id === phase.observation ? 'observations' : task.id === phase.recovery ? 'recoveries' : null
  if (!field || !matchingRecord(run, lab, phase, field, record)) return run
  const latest = Object.values(run.evidence?.experimentsById ?? {}).filter(item => item.taskId === task.id)
    .reduce((max, item) => Math.max(max, item.sequence ?? 0), 0)
  if (record.sequence !== latest) return run
  const cluster = run.runtime.kubernetes.clusters[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]
  const incident = cluster.connectivity.incident
  const key = phase.phase
  return { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, clusters: {
    ...run.runtime.kubernetes.clusters, [CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]: { ...cluster,
      connectivity: { ...cluster.connectivity, incident: { ...incident, [field]: { ...incident[field], [key]: record.id } } } },
  } } } }
}

function evidenceMatches(run, lab, phase, field) {
  const id = incidentAt(run)?.[field]?.[phase.phase]
  const record = evidence(run, id)
  const taskId = field === 'observations' ? phase.observation : phase.recovery
  const latest = Object.values(run.evidence?.experimentsById ?? {}).filter(item => item.taskId === taskId)
    .reduce((max, item) => Math.max(max, item.sequence ?? 0), 0)
  const observation = field === 'recoveries' ? evidence(run, incidentAt(run)?.observations?.[phase.phase]) : null
  return run.evidence?.currentEvidenceByTask?.[taskId] === id && record?.sequence === latest
    && (!observation || record.sequence > observation.sequence)
    && matchingRecord(run, lab, phase, field, record) ? record : null
}

function changedDraft(run, phase = incidentAt(run)?.phase) {
  const path = phase === 'port' ? 'k8s/configmap.yaml' : 'k8s/service-internal.yaml'
  return CONNECTIVITY_TROUBLESHOOTING_FILES.includes(path) && run.project.draftFiles[path] !== run.project.savedFiles[path] ? path : null
}

function injectNextFault(run, phase) {
  const path = phase.phase === 'selector' ? 'k8s/service-internal.yaml' : 'k8s/configmap.yaml'
  const parsed = parseKubernetesYaml(run.project.savedFiles[path], path)
  if (parsed.diagnostics.length || parsed.documents.length !== 1) return null
  const resource = parsed.documents[0]
  if (phase.phase === 'selector') {
    if (resource?.apiVersion !== 'v1' || resource.kind !== 'Service' || resource.metadata?.name !== 'assistant-internal'
      || resource.metadata?.namespace !== 'assistant' || resource.spec?.type !== 'ClusterIP' || resource.spec?.selector?.app !== 'assistant'
      || resource.spec?.ports?.[0]?.port !== 80 || !['http', 8080].includes(resource.spec.ports[0].targetPort)) return null
    resource.spec.ports[0].targetPort = 8081
  } else {
    if (resource?.apiVersion !== 'v1' || resource.kind !== 'ConfigMap' || resource.metadata?.name !== 'assistant-config'
      || resource.metadata?.namespace !== 'assistant' || resource.data?.PGHOST !== 'pg-training.example') return null
    resource.data.PGHOST = 'pg-typo.example'
  }
  return { path, text: stringify(resource) }
}

function recoveredFileMatchesApplied(run, phase) {
  const state = run.runtime.kubernetes.clusters[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]
  const serviceRecovery = phase.phase !== 'dependency'
  const path = serviceRecovery ? 'k8s/service-internal.yaml' : 'k8s/configmap.yaml'
  const parsed = parseKubernetesYaml(run.project.savedFiles[path], path)
  if (parsed.diagnostics.length || parsed.documents.length !== 1) return false
  const desired = parsed.documents[0]
  const actual = serviceRecovery ? state.resources['Service/assistant/assistant-internal']
    : state.resources['ConfigMap/assistant/assistant-config']
  if (!actual) return false
  if (serviceRecovery) return desired.kind === 'Service' && desired.metadata?.name === actual.metadata.name
    && desired.metadata?.namespace === 'assistant' && desired.spec?.type === actual.spec.type
    && desired.spec?.selector?.app === 'assistant' && actual.spec.selector?.app === 'assistant'
    && desired.spec?.ports?.[0]?.port === actual.spec.ports?.[0]?.port
    && desired.spec?.ports?.[0]?.targetPort === actual.spec.ports?.[0]?.targetPort
    && ['http', 8080].includes(desired.spec.ports[0].targetPort)
  return desired.kind === 'ConfigMap' && desired.metadata?.name === actual.metadata.name && desired.metadata?.namespace === 'assistant'
    && desired.data?.PGHOST === 'pg-training.example' && canonical(desired.data) === canonical(actual.data)
}

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)

export function advanceConnectivityIncident(run, lab) {
  const incident = incidentAt(run)
  const phase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === incident?.phase)
  if (lab?.id !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID || run.labId !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID || !phase)
    return { run, diagnostics: [diagnostic('AKS_INCIDENT_NOT_READY', 'This Lab has no active staged connectivity incident.')], lines: [] }
  if (!phase.next) return { run, diagnostics: [diagnostic('AKS_INCIDENT_COMPLETE', 'All three connectivity incidents have been investigated.')], lines: [] }
  const dirty = changedDraft(run, phase.phase)
  if (dirty) return { run, diagnostics: [diagnostic('AKS_UNSAVED_INCIDENT_SOURCE', `Save the draft ${dirty} before introducing the next incident.`)], lines: [] }
  const observed = evidenceMatches(run, lab, phase, 'observations')
  if (!observed) return { run, diagnostics: [diagnostic('AKS_INCIDENT_NOT_READY', `Record a fresh passing ${phase.observationScenario} observation for the current incident before advancing.`)], lines: [] }
  const recovered = evidenceMatches(run, lab, phase, 'recoveries')
  if (!recovered) return { run, diagnostics: [diagnostic('AKS_INCIDENT_NOT_READY', `Complete a fresh passing ${phase.recoveryScenario} recovery for the current incident before advancing.`)], lines: [] }
  if (!recoveredFileMatchesApplied(run, phase)) return { run, diagnostics: [diagnostic('AKS_INCIDENT_RECOVERY_STALE', 'The recovered saved manifest must still match the applied Service or ConfigMap before the next fault can be introduced.')], lines: [] }
  const mutation = injectNextFault(run, phase)
  if (!mutation) return { run, diagnostics: [diagnostic('AKS_INCIDENT_SOURCE_INVALID', 'The saved recovery manifest no longer has the expected healthy state.')], lines: [] }
  const saved = saveProjectFile(run.project, mutation.path, mutation.text)
  if (saved.diagnostics.length) return { run, diagnostics: saved.diagnostics, lines: [] }
  let next = { ...run, project: saved.project,
    dependencyGenerations: { ...run.dependencyGenerations, [`file:${mutation.path}`]: (run.dependencyGenerations[`file:${mutation.path}`] ?? 0) + 1 } }
  const parsed = parseKubernetesYaml(mutation.text, mutation.path)
  const applied = applyKubernetesObjects(next, parsed.documents, { clusterId: CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant' }, lab)
  if (applied.diagnostics.length) return { run, diagnostics: applied.diagnostics, lines: [] }
  const reconciled = reconcileKubernetesResult(applied.run, lab)
  if (reconciled.diagnostics.length) return { run, diagnostics: reconciled.diagnostics, lines: [] }
  next = reconciled.run
  if (phase.phase === 'port') {
    const restarted = restartDeploymentResult(next, CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, 'assistant', 'assistant', lab)
    if (restarted.diagnostics.length) return { run, diagnostics: restarted.diagnostics, lines: [] }
    next = restarted.run
  }
  const cluster = next.runtime.kubernetes.clusters[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]
  const prior = cluster.connectivity.incident
  const nextPhase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === phase.next)
  const updated = { ...prior, phase: phase.next, sequence: nextPhase.sequence }
  next = { ...next, runtime: { ...next.runtime, kubernetes: { ...next.runtime.kubernetes, clusters: {
    ...next.runtime.kubernetes.clusters, [CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]: { ...cluster,
      connectivity: { ...cluster.connectivity, incident: updated } },
  } } } }
  const introduced = phase.phase === 'selector' ? 'internal targetPort 8081; ready endpoints still select both assistant Pods.'
    : 'PGHOST pg-typo.example; the Deployment was restarted so replacement Pods capture the fault.'
  return { run: next, diagnostics: [], lines: [{ kind: 'out', text: `Connectivity incident advanced to ${phase.next}. Introduced fault: ${introduced}` }] }
}

export function validConnectivityIncident(incident, run) {
  if (run.labId !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID) return incident === null
  if (!incident || Object.keys(incident).sort().join(',') !== 'id,observations,phase,recoveries,sequence'
    || incident.id !== 'network-hops-v1' || !incident.observations || !incident.recoveries) return false
  const phase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === incident.phase)
  if (!phase || incident.sequence !== phase.sequence
    || Object.keys(incident.observations).sort().join(',') !== 'dependency,port,selector'
    || Object.keys(incident.recoveries).sort().join(',') !== 'dependency,port,selector') return false
  for (const item of CONNECTIVITY_INCIDENT_PHASES) for (const field of ['observations', 'recoveries']) {
    const id = incident[field][item.phase]
    if (id === null) continue
    const record = evidence(run, id)
    const expectedTask = field === 'observations' ? item.observation : item.recovery
    const expectedScenario = field === 'observations' ? item.observationScenario : item.recoveryScenario
    if (!expectedScenario || record?.id !== id || record.attemptId !== run.attemptId || record.labId !== run.labId
      || record.taskId !== expectedTask || record.scenarioId !== expectedScenario || record.scenarioVersion !== 1
      || record.outcome !== 'passed' || record.completed !== true || record.measurements?.clusterId !== CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID
      || record.measurements?.serviceName !== 'assistant-internal') return false
  }
  return true
}

export function connectivityIncidentEvidenceForPhase(run, lab, field, phase = incidentAt(run)?.phase) {
  const item = CONNECTIVITY_INCIDENT_PHASES.find(candidate => candidate.phase === phase)
  return item && (field === 'observations' || field === 'recoveries') ? evidenceMatches(run, lab, item, field) : null
}

export function isConnectivityIncidentDraftClean(run, phase) { return !changedDraft(run, phase) }
export { CONNECTIVITY_INCIDENT_PHASES }

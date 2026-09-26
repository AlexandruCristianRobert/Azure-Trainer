import { stringify } from 'yaml'
import { saveProjectFile } from '../project/files.js'
import { parseKubernetesYaml } from './yaml.js'
import { applyKubernetesObjects } from './objects.js'
import { getDeploymentPods, reconcileKubernetesResult } from './reconcile.js'
import { normalizeContainerResources } from './resource-schema.js'
import { resourceExperimentActive } from './resource-experiments.js'
import { canonicalize } from '../labEngine/evidence.js'
const RESOURCES_TROUBLESHOOTING_LAB_ID = 'aks-resources-troubleshooting'
const RESOURCES_TROUBLESHOOTING_CLUSTER_ID = '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-resources-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-resources-troubleshooting'

const phases = [{ phase: 'scheduling', sequence: 1, observation: 'observe-pending', recovery: 'repair-scheduling', next: 'memory' },
  { phase: 'memory', sequence: 2, observation: 'observe-oom', recovery: 'repair-memory', next: 'hpa' },
  { phase: 'hpa', sequence: 3, observation: 'observe-hpa', recovery: 'repair-hpa', next: null }]
const diag = (code, message) => ({ code, message, path: '', line: 1, column: 1 })
const state = run => run.runtime.kubernetes.clusters?.[RESOURCES_TROUBLESHOOTING_CLUSTER_ID]
const deployment = run => state(run)?.resources?.['Deployment/assistant/assistant']
function record(run, taskId, lab) {
  const id = run.evidence.currentEvidenceByTask?.[taskId]; const value = id && run.evidence.experimentsById?.[id]
  const task = lab.tasks.find(item => item.id === taskId)
  if (!value || !task?.verification || value.id !== id || value.attemptId !== run.attemptId || value.labId !== run.labId
    || value.contentVersion !== run.contentVersion || value.taskId !== taskId || value.scenarioId !== task.verification.scenarioId
    || value.scenarioVersion !== task.verification.scenarioVersion || value.outcome !== 'passed' || value.completed !== true
    || !Number.isSafeInteger(value.sequence) || value.sequence >= run.nextSequence) return null
  const context = { sandbox: run.sandbox, project: run.project, artifacts: run.artifacts, runtime: run.runtime,
    evidence: run.evidence, dependencyGenerations: run.dependencyGenerations, stages: run.stages, history: run.history }
  const dependencies = task.dependencies ?? {}
  if (Object.keys(value.dependencyValues ?? {}).length !== Object.keys(dependencies).length
    || Object.keys(value.dependencyGenerations ?? {}).length !== Object.keys(dependencies).length) return null
  for (const [key, selector] of Object.entries(dependencies)) {
    try {
      if (canonicalize(value.dependencyValues[key]) !== canonicalize(selector(context))
        || value.dependencyGenerations[key] !== (run.dependencyGenerations[key] ?? 0)) return null
    } catch { return null }
  }
  return value
}
const currentResources = run => normalizeContainerResources(deployment(run)?.spec?.template?.spec?.containers?.[0]?.resources ?? {}).effective
function digest(value) { let hash = 2166136261; for (const c of JSON.stringify(canonicalize(value))) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0).toString(16) }
function currentRecovery(run, taskId, lab) {
  const proof = record(run, taskId, lab)?.measurements?.fingerprint
  const live = deployment(run)
  if (!proof || !live || proof.deploymentUid !== live.metadata?.uid || proof.templateDigest !== digest(live.spec?.template ?? null)) return false
  const parsed = parseKubernetesYaml(run.project.savedFiles['k8s/deployment.yaml'], 'k8s/deployment.yaml')
  const saved = parsed.documents.find(item => item?.kind === 'Deployment' && item.metadata?.namespace === 'assistant' && item.metadata?.name === 'assistant')
  if (parsed.diagnostics.length || !saved) return false
  const savedContainers = saved.spec?.template?.spec?.containers ?? []
  const liveContainers = live.spec?.template?.spec?.containers ?? []
  const resourcesAgree = savedContainers.length === liveContainers.length && savedContainers.every((item, index) => {
    const current = liveContainers[index]
    return item.name === current.name && item.image === current.image
      && canonicalize(normalizeContainerResources(item.resources ?? {}).effective) === canonicalize(normalizeContainerResources(current.resources ?? {}).effective)
  })
  if (!resourcesAgree) return false
  const key = 'Deployment/assistant/assistant'
  if (state(run)?.applyOwnership?.[key]?.replicas === false && Object.hasOwn(saved.spec ?? {}, 'replicas')) return false
  if (state(run)?.applyOwnership?.[key]?.replicas !== false
    && (!Object.hasOwn(saved.spec ?? {}, 'replicas') || saved.spec.replicas !== live.spec?.replicas)) return false
  const serviceNames = new Set((proof.services ?? []).map(item => item.name))
  const currentTargetSaved = Object.entries(run.project.savedFiles).flatMap(([path, text]) => {
    if (!/^k8s\/.*\.ya?ml$/i.test(path)) return []
    const parsedFile = parseKubernetesYaml(text, path)
    const docs = parsedFile.documents.flatMap(doc => {
      if (!doc || doc.metadata?.namespace !== 'assistant') return []
      if (doc.kind === 'Deployment' && doc.metadata.name === 'assistant') {
        const canonical = structuredClone(doc); if (canonical.spec) delete canonical.spec.replicas
        return [['Deployment', canonical]]
      }
      if (doc.kind === 'Service' && serviceNames.has(doc.metadata.name) || ['ConfigMap', 'Secret'].includes(doc.kind)) return [[doc.kind, doc]]
      return []
    })
    return docs.length ? [[path, digest(docs)]] : []
  })
  if (canonicalize(currentTargetSaved) !== canonicalize(proof.targetSaved)) return false
  const pods = getDeploymentPods(run, RESOURCES_TROUBLESHOOTING_CLUSTER_ID, 'assistant', 'assistant')
  return pods.length === 2 && pods.every(pod => {
    const health = state(run)?.health?.containers?.[pod.metadata.uid]
    return pod.status?.phase === 'Running' && !pod.metadata.deletionTimestamp && health?.ready === true
      && health.terminatedAtMs === null && health.restartAtMs === null
  })
}
const recovered = (run, phase, lab) => {
  const resources = currentResources(run); const pods = Object.values(state(run)?.resources ?? {}).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
  if (phase === 'scheduling') return currentRecovery(run, 'repair-scheduling', lab) && resources.cpuRequestM > 0 && resources.cpuRequestM <= 500 && resources.cpuLimitM >= resources.cpuRequestM && resources.memoryRequestBytes === 128 * 1024 * 1024 && resources.memoryLimitBytes === 256 * 1024 * 1024 && pods.filter(pod => pod.status?.phase === 'Running').length === 2
  if (phase === 'memory') return resources.cpuRequestM > 0 && resources.cpuRequestM <= 500 && resources.cpuLimitM >= resources.cpuRequestM
    && resources.memoryRequestBytes === 128 * 1024 * 1024 && resources.memoryLimitBytes === 256 * 1024 * 1024 && currentRecovery(run, 'repair-memory', lab)
  const hpa = Object.values(state(run)?.resources ?? {}).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.name === 'assistant-cpu')
  const ownership = state(run)?.applyOwnership?.['Deployment/assistant/assistant']
  return resources.cpuRequestM > 0 && resources.cpuRequestM <= 500 && resources.cpuLimitM >= resources.cpuRequestM
    && resources.memoryRequestBytes === 128 * 1024 * 1024 && resources.memoryLimitBytes === 256 * 1024 * 1024
    && hpa?.spec?.minReplicas === 2 && hpa.spec.maxReplicas === 4
    && hpa.spec.metrics?.[0]?.resource?.target?.averageUtilization === 60
    && hpa.spec.behavior?.scaleDown?.stabilizationWindowSeconds === 60 && ownership?.replicas === false
    && pods.filter(pod => pod.status?.phase === 'Running').length === 2
}
function changed(run) { return ['k8s/deployment.yaml', 'k8s/hpa.yaml'].find(path => run.project.draftFiles[path] !== run.project.savedFiles[path]) }
function mutate(text, phase) {
  const parsed = parseKubernetesYaml(text, 'k8s/deployment.yaml'); const docs = parsed.documents
  const doc = docs.find(item => item?.kind === 'Deployment' && item.metadata?.namespace === 'assistant' && item.metadata?.name === 'assistant')
  const resources = doc?.spec?.template?.spec?.containers?.[0]?.resources
  if (parsed.diagnostics.length || !resources) return null
  if (phase === 'scheduling') { resources.requests.memory = '128Mi'; resources.limits.memory = '128Mi' }
  if (phase === 'memory') { delete resources.requests.cpu; delete resources.limits.cpu }
  return docs.map(item => stringify(item)).join('---\n')
}
const hpaYaml = `apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: assistant-cpu\n  namespace: assistant\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: assistant\n  minReplicas: 2\n  maxReplicas: 4\n  metrics:\n    - type: Resource\n      resource:\n        name: cpu\n        target:\n          type: Utilization\n          averageUtilization: 60\n  behavior:\n    scaleDown:\n      stabilizationWindowSeconds: 60\n`

export function advanceResourceIncident(run, lab) {
  const incident = state(run)?.resourcesRuntime?.incident; const phase = phases.find(item => item.phase === incident?.phase)
  if (lab?.id !== RESOURCES_TROUBLESHOOTING_LAB_ID || run.labId !== RESOURCES_TROUBLESHOOTING_LAB_ID || !phase) return { run, diagnostics: [diag('AKS_INCIDENT_NOT_READY', 'This Lab has no active resource incident.')], lines: [] }
  if (!phase.next) return { run, diagnostics: [diag('AKS_INCIDENT_COMPLETE', 'All resource incidents have been introduced.')], lines: [] }
  if (resourceExperimentActive(run) || Object.values(run.runtime.kubernetes.clusters ?? {}).some(value => value.health?.experiment?.status === 'active')) return { run, diagnostics: [diag('AKS_INCIDENT_ACTIVE', 'Finish the active experiment before continuing.')], lines: [] }
  const dirty = changed(run); if (dirty) return { run, diagnostics: [diag('AKS_UNSAVED_INCIDENT_SOURCE', `Save ${dirty} before continuing the incident.`)], lines: [] }
  const observation = record(run, phase.observation, lab); const recovery = record(run, phase.recovery, lab)
  if (!observation || !recovery || recovery.sequence <= observation.sequence || !recovered(run, phase.phase, lab)
    || observation.measurements?.fingerprint?.deploymentUid !== deployment(run)?.metadata?.uid || recovery.measurements?.fingerprint?.deploymentUid !== deployment(run)?.metadata?.uid)
    return { run, diagnostics: [diag('AKS_INCIDENT_NOT_READY', `Observe ${phase.observation} and complete the genuine ${phase.recovery} before continuing.`)], lines: [] }
  const text = mutate(run.project.savedFiles['k8s/deployment.yaml'], phase.phase); if (!text) return { run, diagnostics: [diag('AKS_INCIDENT_SOURCE_INVALID', 'The saved recovery manifest cannot receive the next controlled fault.')], lines: [] }
  const saved = saveProjectFile(run.project, 'k8s/deployment.yaml', text); if (saved.diagnostics.length) return { run, diagnostics: saved.diagnostics, lines: [] }
  let next = { ...run, project: saved.project, dependencyGenerations: { ...run.dependencyGenerations, 'file:k8s/deployment.yaml': (run.dependencyGenerations['file:k8s/deployment.yaml'] ?? 0) + 1 } }
  let parsed = parseKubernetesYaml(text, 'k8s/deployment.yaml'); let applied = applyKubernetesObjects(next, parsed.documents, { clusterId: RESOURCES_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant' }, lab)
  if (applied.diagnostics.length) return { run, diagnostics: applied.diagnostics, lines: [] }
  let reconciled = reconcileKubernetesResult(applied.run, lab); if (reconciled.diagnostics.length) return { run, diagnostics: reconciled.diagnostics, lines: [] }; next = reconciled.run
  if (phase.next === 'hpa') { const hpa = saveProjectFile(next.project, 'k8s/hpa.yaml', hpaYaml); if (hpa.diagnostics.length) return { run, diagnostics: hpa.diagnostics, lines: [] }; next = { ...next, project: hpa.project, dependencyGenerations: { ...next.dependencyGenerations, 'file:k8s/hpa.yaml': (next.dependencyGenerations['file:k8s/hpa.yaml'] ?? 0) + 1 } }; parsed = parseKubernetesYaml(hpaYaml, 'k8s/hpa.yaml'); applied = applyKubernetesObjects(next, parsed.documents, { clusterId: RESOURCES_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant' }, lab); if (applied.diagnostics.length) return { run, diagnostics: applied.diagnostics, lines: [] }; reconciled = reconcileKubernetesResult(applied.run, lab); if (reconciled.diagnostics.length) return { run, diagnostics: reconciled.diagnostics, lines: [] }; next = reconciled.run }
  const cluster = state(next); cluster.resourcesRuntime.incident = { ...incident, phase: phase.next, sequence: phase.sequence + 1, observations: { ...incident.observations, [phase.phase]: observation.id }, recoveries: { ...incident.recoveries, [phase.phase]: recovery.id } }
  return { run: next, diagnostics: [], lines: [{ kind: 'out', text: `Advanced to ${phase.next} resource incident and applied its declared fault.` }] }
}

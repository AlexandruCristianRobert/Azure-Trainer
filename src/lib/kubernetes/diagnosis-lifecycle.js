import { canonicalize } from '../labEngine/evidence.js'
import { requestDiagnosticsEnabled, redactRequestValue } from './request-records.js'

const same = (a, b) => canonicalize(a) === canonicalize(b)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')

export function serverStartupLogs(run, artifactId) {
  const artifact = run.artifacts.buildsById[artifactId]
  return requestDiagnosticsEnabled(run) && artifact ? [`Server startup: listening on port ${artifact.appSpec.listeningPort}`] : []
}

/** This projection is made only from native process/probe records, never an action payload. */
export function observeDiagnosisLifecycle(run, target, sinceMs) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const pods = Object.values(state.resources).filter(pod => pod.kind === 'Pod' && pod.metadata.namespace === target.namespace
    && pod.metadata.ownerReferences?.some(ref => Object.values(state.resources).some(rs => rs.kind === 'ReplicaSet' && rs.metadata.uid === ref.uid
      && rs.metadata.ownerReferences?.some(owner => owner.uid === state.resources[`Deployment/${target.namespace}/${target.deploymentName}`]?.metadata.uid))))
  for (const pod of pods) {
    const container = state.health?.containers[pod.metadata.uid], snapshot = state.podSnapshots[pod.metadata.uid]
    if (!container?.previous?.serverLogs?.length || container.restartCount < 1 || container.previous.reason !== 'LivenessProbeFailed'
      || pod.spec.containers[0].livenessProbe?.httpGet.path !== '/health/missing') continue
    const receipt = state.health.receipts.find(item => item.podUid === pod.metadata.uid && item.newContainerId === container.containerId && item.oldContainerId === container.previous.containerId)
    const events = receipt?.diagnosisLifecycle?.events ?? []
    const projection = { podUid: pod.metadata.uid, containerId: container.containerId, previousContainerId: container.previous.containerId,
      artifactId: snapshot.artifactId, restartCount: container.restartCount, startedAtMs: container.startedAtMs,
      previousServerLogs: [...container.previous.serverLogs], events }
    if (validDiagnosisLifecycle(projection, run, target, sinceMs)) return redactRequestValue(projection, state)
  }
  return null
}

/** Retained restart receipts authenticate identity after the faulty Pod is removed. */
export function validDiagnosisLifecycle(value, run, target, sinceMs) {
  if (!exact(value, ['podUid', 'containerId', 'previousContainerId', 'artifactId', 'restartCount', 'startedAtMs', 'previousServerLogs', 'events'])
    || !/^kube-[1-9]\d*$/.test(value.podUid) || !/^container-[1-9]\d*$/.test(value.containerId)
    || !/^container-[1-9]\d*$/.test(value.previousContainerId) || value.containerId === value.previousContainerId
    || !Number.isSafeInteger(value.restartCount) || value.restartCount < 1 || !Number.isSafeInteger(value.startedAtMs)
    || value.startedAtMs < sinceMs || value.startedAtMs > run.runtime.simTimeMs
    || !same(value.previousServerLogs, serverStartupLogs(run, value.artifactId)) || value.previousServerLogs.length !== 1
    || !Array.isArray(value.events) || value.events.length < 2 || value.events.length > 4) return false
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const receipt = [...state.health.receipts, ...(state.diagnosis?.receipts ?? []).flatMap(item => item.lifecycle ? [item.lifecycle] : [])].find(item => item.cause === 'probe' && item.probeType === 'LivenessProbeFailed'
    && item.podUid === value.podUid && item.oldContainerId === value.previousContainerId && item.newContainerId === value.containerId
    && item.restartCount === value.restartCount && item.atMs === value.startedAtMs)
  const deploymentUid = target.deploymentUid ?? state.resources[`Deployment/${target.namespace}/${target.deploymentName}`]?.metadata.uid
  return !!receipt && receipt.diagnosisLifecycle?.deploymentUid === deploymentUid && validSealedLifecycleReceipt(receipt, run)
    && receipt.diagnosisLifecycle.artifactId === value.artifactId && same(value.previousServerLogs, receipt.diagnosisLifecycle.previousServerLogs)
    && same(value.events, receipt.diagnosisLifecycle.events)
    && value.events.every(event => event.atMs >= sinceMs)
}

export function validSealedLifecycleReceipt(receipt, run) {
  const seal = receipt.diagnosisLifecycle
  if (seal === undefined) return true
  if (!exact(seal, ['artifactId', 'deploymentUid', 'previousServerLogs', 'events']) || !/^kube-[1-9]\d*$/.test(seal.deploymentUid)
    || receipt.cause !== 'probe' || receipt.probeType !== 'LivenessProbeFailed'
    || !/^kube-[1-9]\d*$/.test(receipt.podUid) || !/^container-[1-9]\d*$/.test(receipt.oldContainerId)
    || !/^container-[1-9]\d*$/.test(receipt.newContainerId) || receipt.oldContainerId === receipt.newContainerId
    || !Number.isSafeInteger(receipt.atMs) || receipt.atMs < 0 || receipt.atMs > run.runtime.simTimeMs
    || !Number.isSafeInteger(receipt.restartCount) || receipt.restartCount < 1
    || !same(seal.previousServerLogs, serverStartupLogs(run, seal.artifactId)) || seal.previousServerLogs.length !== 1
    || !Array.isArray(seal.events) || seal.events.length < 1 || seal.events.length > 4) return false
  return seal.events.every(event => exact(event, ['type', 'atMs', 'podUid', 'probeType', 'success', 'status', 'failures'])
    && event.type === 'probe-result' && event.probeType === 'liveness' && event.podUid === receipt.podUid && event.success === false
    && event.status === null && Number.isSafeInteger(event.failures) && event.failures > 0
    && Number.isSafeInteger(event.atMs) && event.atMs >= 0 && event.atMs <= receipt.atMs)
}

import { canonicalize } from '../labEngine/evidence.js'
import { getProjectManifest } from '../project/manifests.js'

export function kubernetesDependencies(clusterId, namespace, deploymentName, serviceName, { sourceSensitive = false } = {}) {
  const base = context => {
    const state = context.runtime.kubernetes?.clusters?.[clusterId]
    const resources = state?.resources ?? {}
    const deployment = resources[`Deployment/${namespace}/${deploymentName}`] ?? null
    const service = resources[`Service/${namespace}/${serviceName}`] ?? null
    const pods = Object.values(resources).filter(pod => pod.kind === 'Pod' && pod.metadata.namespace === namespace
      && pod.metadata.ownerReferences?.some(ref => Object.values(resources).some(rs => rs.kind === 'ReplicaSet'
        && rs.metadata.uid === ref.uid && rs.metadata.ownerReferences?.some(owner => owner.uid === deployment?.metadata.uid))))
      .map(pod => ({ uid: pod.metadata.uid, phase: pod.status?.phase, snapshot: state.podSnapshots[pod.metadata.uid] ?? null }))
      .sort((a, b) => a.uid.localeCompare(b.uid))
    return { clusterId, namespace, deployment, service, pods,
      ...(sourceSensitive ? { desiredSource: context.project.savedFiles['app.py'], fileVersion: context.project.fileVersions['app.py'] ?? 0 } : {}) }
  }
  const deps = { [`aks:${clusterId}:${namespace}:${deploymentName}:${serviceName}`]: base }
  if (sourceSensitive) deps[`aks-source:${clusterId}:${namespace}:${deploymentName}`] = context => {
    const image = base(context).deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null
    const artifactId = image ? context.artifacts.publishedTags[image] ?? null : null
    const artifact = artifactId ? context.artifacts.buildsById[artifactId] ?? null : null
    return { files: Object.fromEntries(getProjectManifest(context.project.manifestId).buildFiles
      .map(path => [path, context.project.savedFiles[path]])), image, artifactId,
      artifact: artifact ? { id: artifact.id, sourceHash: artifact.sourceHash, image: artifact.image } : null }
  }
  return deps
}

export function refreshKubernetesDependencies(previous, next, lab) {
  if (lab?.capabilities?.kubernetes !== true) return next
  const counters = { ...next.dependencyGenerations }; const changed = new Set()
  for (const task of lab.tasks ?? []) for (const [key, select] of Object.entries(task.dependencies ?? {})) {
    if (changed.has(key)) continue
    if (canonicalize(select({ ...previous, run: previous })) !== canonicalize(select({ ...next, run: next }))) {
      changed.add(key); counters[key] = (previous.dependencyGenerations[key] ?? 0) + 1
    }
  }
  return changed.size ? { ...next, dependencyGenerations: counters } : next
}

import { canonicalize } from '../labEngine/evidence.js'
import { getProjectManifest } from '../project/manifests.js'
import { parseKubernetesYaml } from './yaml.js'

function redactedDigest(value) {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `sha256:${(hash >>> 0).toString(16)}`
}

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
    const configuration = Object.values(resources).filter(item => ['ConfigMap', 'Secret'].includes(item.kind) && item.metadata.namespace === namespace)
      .map(item => ({ kind: item.kind, name: item.metadata.name, resourceVersion: item.metadata.resourceVersion, data: item.data })).sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`))
    return { clusterId, namespace, deployment, service, pods, configuration,
      savedConfiguration: Object.fromEntries(Object.entries(context.project.savedFiles).filter(([path]) => /^k8s\/(configmap|secret|deployment)\.ya?ml$/i.test(path))),
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

export function configurationDependencies(target, { historical = false } = {}) {
  const { clusterId, namespace, deploymentName, serviceName } = target ?? {}
  const dependencies = kubernetesDependencies(clusterId, namespace, deploymentName, serviceName, { sourceSensitive: true })
  if (!historical) return dependencies
  return {
    [`aks-config-history:${clusterId}:${namespace}:${deploymentName}`]: context => {
      const state = context.runtime.kubernetes?.clusters?.[clusterId]
      const deployment = state?.resources?.[`Deployment/${namespace}/${deploymentName}`]
      const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
      const artifact = image && context.artifacts.buildsById[context.artifacts.publishedTags[image]]
      return { clusterUid: context.sandbox.aksClusters?.find(item => item.id === clusterId)?.id ?? null,
        deploymentUid: deployment?.metadata?.uid ?? null, sourceHash: artifact?.sourceHash ?? null }
    },
  }
}

// Integration proofs deliberately capture only the things that determine a
// request result.  Request logs and attempt history are observations, not
// dependencies: a second scenario must not stale a first scenario's proof.
export function integrationDependencies(target) {
  const { clusterId, namespace, deploymentName, serviceName } = target ?? {}
  return {
    [`aks-integration:${clusterId}:${namespace}:${deploymentName}:${serviceName}`]: context => {
      const state = context.runtime.kubernetes?.clusters?.[clusterId]
      const resources = state?.resources ?? {}
      const deployment = resources[`Deployment/${namespace}/${deploymentName}`] ?? null
      const service = resources[`Service/${namespace}/${serviceName}`] ?? null
      const image = deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null
      const artifactId = image ? context.artifacts.publishedTags?.[image] ?? null : null
      const artifact = artifactId ? context.artifacts.buildsById?.[artifactId] ?? null : null
      const manifest = getProjectManifest(context.project.manifestId)
      const buildFiles = Object.fromEntries((manifest.buildFiles ?? []).map(path => [path, context.project.savedFiles[path] ?? null]))
      const capturedFiles = artifact ? context.artifacts.sourceSnapshotsByHash?.[artifact.sourceHash]?.files ?? null : null
      const configuration = Object.values(resources).filter(item => ['ConfigMap', 'Secret'].includes(item.kind) && item.metadata.namespace === namespace)
        .map(item => ({ kind: item.kind, name: item.metadata.name, uid: item.metadata.uid, resourceVersion: item.metadata.resourceVersion,
          keys: Object.keys(item.data ?? {}).sort() })).sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`))
      const pods = Object.values(resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === namespace)
        .map(pod => {
          const snapshot = state?.podSnapshots?.[pod.metadata.uid]
          const environment = Object.entries(snapshot?.environment ?? {})
          const secretEntries = environment.filter(([key]) => /(?:password|secret|token|credential|api[_-]?key)/i.test(key)).sort(([a], [b]) => a.localeCompare(b))
          return { uid: pod.metadata.uid, phase: pod.status?.phase ?? null, artifactId: snapshot?.artifactId ?? null,
            templateHash: snapshot?.templateHash ?? null,
            environment: Object.fromEntries(environment.filter(([key]) => !/(?:password|secret|token|credential|api[_-]?key)/i.test(key))),
            configRefs: (snapshot?.configRefs ?? []).map(ref => ({ kind: ref.kind, namespace: ref.namespace, name: ref.name, key: ref.key,
              resourceVersion: ref.resourceVersion, mode: ref.mode, target: ref.target })).sort((a, b) => `${a.kind}/${a.name}/${a.key}`.localeCompare(`${b.kind}/${b.name}/${b.key}`)),
            secretDigest: redactedDigest(secretEntries),
          }
        }).sort((a, b) => a.uid.localeCompare(b.uid))
      return { version: 1, clusterId, namespace, deploymentName, serviceName,
        route: service ? { uid: service.metadata?.uid ?? null, version: service.metadata?.resourceVersion ?? null, spec: service.spec ?? null } : null,
        image, artifact: artifact ? { id: artifact.id, image: artifact.image, sourceHash: artifact.sourceHash } : null,
        capturedFiles, savedBuildFiles: buildFiles, configuration, pods }
    },
  }
}

// Connectivity proof is about the route that exists now.  Keep the whole
// namespace candidate set because a label change can make a previously
// irrelevant Pod a backend without changing the Service itself.
export function connectivityDependencies(target, { historical = false } = {}) {
  const { clusterId, namespace, serviceName, clientPodUid, sourceRequired = false } = target ?? {}
  if (historical) return {
    [`aks-connectivity-history:${clusterId}:${namespace}:${serviceName}`]: context => {
      const state = context.runtime.kubernetes?.clusters?.[clusterId]
      const deployment = Object.values(state?.resources ?? {}).find(item => item.kind === 'Deployment' && item.metadata.namespace === namespace && item.metadata.name === 'assistant')
      const image = deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null
      const artifactId = image ? context.artifacts.publishedTags[image] ?? null : null
      return { clusterId, deploymentUid: deployment?.metadata?.uid ?? null, artifactId,
        sourceHash: artifactId ? context.artifacts.buildsById[artifactId]?.sourceHash ?? null : null }
    },
  }
  return {
    [`aks-connectivity:${clusterId}:${namespace}:${serviceName}`]: context => {
      const state = context.runtime.kubernetes?.clusters?.[clusterId]
      const resources = state?.resources ?? {}
      const service = resources[`Service/${namespace}/${serviceName}`] ?? null
      const pods = Object.values(resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === namespace)
        .map(pod => ({ uid: pod.metadata.uid, labels: pod.metadata.labels ?? {}, phase: pod.status?.phase ?? null,
          ready: !!pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'),
          podIP: pod.status?.podIP ?? null, snapshot: state?.podSnapshots?.[pod.metadata.uid] ?? null }))
        .sort((a, b) => a.uid.localeCompare(b.uid))
      const savedServiceFiles = Object.fromEntries(Object.entries(context.project.savedFiles).flatMap(([path, text]) => {
        if (!/^k8s\/service[^/]*\.ya?ml$/i.test(path)) return []
        const parsed = parseKubernetesYaml(text, path)
        return parsed.diagnostics.length === 0 && parsed.documents.some(document => document?.kind === 'Service'
          && document.metadata?.name === serviceName && (document.metadata?.namespace ?? namespace) === namespace) ? [[path, text]] : []
      }))
      const diagnostic = clientPodUid ? Object.values(resources).find(item => item.kind === 'Pod' && item.metadata.uid === clientPodUid) ?? null : null
      const result = { clusterId, service, pods, diagnostic, savedServiceFiles,
        configuration: Object.values(resources).filter(item => ['ConfigMap', 'Secret'].includes(item.kind) && item.metadata.namespace === namespace)
          .map(item => ({ kind: item.kind, name: item.metadata.name, resourceVersion: item.metadata.resourceVersion, data: item.data })) }
      if (sourceRequired) result.source = { app: context.project.savedFiles['app.py'] ?? null, version: context.project.fileVersions['app.py'] ?? 0 }
      return result
    },
  }
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

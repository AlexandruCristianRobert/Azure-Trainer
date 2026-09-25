import { kubeObjectKey } from './objects.js'

const clone = value => structuredClone(value)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const base64 = value => typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
const decodeBase64 = value => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))

function diagnostic(code, kind, name, key, mount = false) {
  const label = key ? `${kind} '${name}' key '${key}'` : `${kind} '${name}'`
  return { code, kind, name, ...(key ? { key } : {}), mount, message: `${label} was not found in this namespace.` }
}

function value(resources, namespace, kind, name, key, optional, mount) {
  const resource = resources[kubeObjectKey(kind, namespace, name)]
  if (!resource) return optional ? { omitted: true } : { diagnostic: diagnostic(`KUBE_${kind.toUpperCase()}_MISSING`, kind, name, undefined, mount) }
  if (!Object.hasOwn(resource.data ?? {}, key)) return optional ? { omitted: true } : { diagnostic: diagnostic(`KUBE_${kind.toUpperCase()}_KEY_MISSING`, kind, name, key, mount) }
  const raw = resource.data[key]
  if (kind === 'Secret') {
    if (!base64(raw)) return { diagnostic: { code: 'KUBE_SECRET_INVALID_BASE64', kind, name, key, mount, message: `Secret '${name}' has invalid encoded data for key '${key}'.` } }
    try { return { value: decodeBase64(raw), resource } } catch { return { diagnostic: { code: 'KUBE_SECRET_INVALID_BASE64', kind, name, key, mount, message: `Secret '${name}' has invalid encoded data for key '${key}'.` } } }
  }
  return { value: raw, resource }
}

function ref(kind, namespace, name, key, resource, mode, target) {
  return { kind, namespace, name, key, uid: resource?.metadata?.uid, resourceVersion: resource?.metadata?.resourceVersion, mode, target }
}

export function resolvePodConfiguration(resources, namespace, podSpec) {
  const environment = {}; const files = {}; const configRefs = []; const diagnostics = []
  const containers = podSpec?.containers ?? []
  for (const container of containers) for (const entry of container.env ?? []) {
    const source = entry.valueFrom?.configMapKeyRef ?? entry.valueFrom?.secretKeyRef
    if (!source) { if (typeof entry.value === 'string') environment[entry.name] = entry.value; continue }
    const kind = entry.valueFrom.configMapKeyRef ? 'ConfigMap' : 'Secret'
    const found = value(resources, namespace, kind, source.name, source.key, source.optional === true, false)
    if (found.diagnostic) { diagnostics.push(found.diagnostic); continue }
    if (!found.omitted) { environment[entry.name] = found.value; configRefs.push(ref(kind, namespace, source.name, source.key, found.resource, 'env', entry.name)) }
  }
  const volumes = new Map((podSpec?.volumes ?? []).map(item => [item.name, item]))
  for (const container of containers) for (const mount of container.volumeMounts ?? []) {
    const volume = volumes.get(mount.name); const source = volume?.configMap ?? volume?.secret
    if (!source) continue
    const kind = volume.configMap ? 'ConfigMap' : 'Secret'
    const resource = resources[kubeObjectKey(kind, namespace, source.name)]
    if (!resource) { diagnostics.push(diagnostic(`KUBE_${kind.toUpperCase()}_MISSING`, kind, source.name, undefined, true)); continue }
    const keys = source.items ?? Object.keys(resource.data ?? {}).map(key => ({ key, path: key }))
    for (const item of keys) {
      const found = value(resources, namespace, kind, source.name, item.key, false, true)
      if (found.diagnostic) { diagnostics.push(found.diagnostic); continue }
      const target = `${mount.mountPath.replace(/\/$/, '')}/${item.path}`
      files[target] = found.value
      configRefs.push(ref(kind, namespace, source.name, item.key, found.resource, 'file', target))
    }
  }
  return { environment, files, configRefs, diagnostics }
}

export function scheduleConfigurationProjection(input, clusterId, resourceKey) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters[clusterId]
  if (!state) return run
  for (const [uid, snapshot] of Object.entries(state.podSnapshots)) {
    if (snapshot.configRefs?.some(item => item.mode === 'file' && kubeObjectKey(item.kind, item.namespace, item.name) === resourceKey)) {
      state.projectionDue[uid] ??= run.runtime.simTimeMs + 60000
    }
  }
  return run
}

export function projectConfigurationAt(input, atMs) {
  const run = clone(input)
  if (!Number.isFinite(atMs) || atMs < 0) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters)) for (const [uid, due] of Object.entries(state.projectionDue)) {
    if (due > atMs) continue
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
    const snapshot = state.podSnapshots[uid]
    if (pod && snapshot) {
      const resolved = resolvePodConfiguration(state.resources, pod.metadata.namespace, pod.spec)
      if (!resolved.diagnostics.length) {
        for (const item of snapshot.configRefs.filter(item => item.mode === 'file')) delete snapshot.files[item.target]
        Object.assign(snapshot.files, resolved.files)
        snapshot.configRefs = [...snapshot.configRefs.filter(item => item.mode !== 'file'), ...resolved.configRefs.filter(item => item.mode === 'file')]
      }
    }
    delete state.projectionDue[uid]
  }
  return run
}

export function advanceConfigurationProjection(input, seconds) {
  const run = clone(input)
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) return run
  run.runtime.simTimeMs += seconds * 1000
  return projectConfigurationAt(run, run.runtime.simTimeMs)
}

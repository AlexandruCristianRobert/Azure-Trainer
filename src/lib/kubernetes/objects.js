import { validateKubernetesObject } from './schema.js'

export const kubeObjectKey = (kind, namespace = '', name) => `${kind}/${namespace ?? ''}/${name}`
const clone = value => structuredClone(value)

export function applyKubernetesObjects(run, documents, options = {}, lab) {
  const clusterId = options.clusterId
  const state = run.runtime.kubernetes.clusters[clusterId]
  let next = clone(run); const diagnostics = []; const lines = []
  if (!state) return { run, lines, diagnostics: [{ code: 'KUBE_CLUSTER_NOT_FOUND', message: 'The selected Kubernetes cluster is unavailable.' }] }
  for (let i = 0; i < documents.length; i++) {
    const result = validateKubernetesObject(documents[i], { namespace: options.namespace, capabilities: { deployments: Object.values(next.runtime.kubernetes.clusters[clusterId].resources).filter(x => x.kind === 'Deployment') }, sourceLocation: options.locations?.[i] })
    if (result.diagnostics.length) return { run: next, lines, diagnostics: result.diagnostics }
    const object = result.object
    const ns = object.metadata.namespace ?? ''
    if (object.kind !== 'Namespace' && !next.runtime.kubernetes.clusters[clusterId].resources[kubeObjectKey('Namespace', '', ns)]) {
      return { run: next, lines, diagnostics: [{ code: 'KUBE_NAMESPACE_NOT_FOUND', message: `Namespace '${ns}' was not found.` }] }
    }
    const key = kubeObjectKey(object.kind, ns, object.metadata.name); const old = next.runtime.kubernetes.clusters[clusterId].resources[key]
    const desired = JSON.stringify(object)
    if (old && JSON.stringify({ apiVersion: old.apiVersion, kind: old.kind, metadata: { name: old.metadata.name, ...(old.metadata.namespace ? { namespace: old.metadata.namespace } : {}) }, ...(old.spec ? { spec: old.spec } : {}) }) === desired) { lines.push({ text: `${object.kind.toLowerCase()}/${object.metadata.name} unchanged`, kind: 'out' }); continue }
    if (old?.kind === 'Deployment' && JSON.stringify(old.spec.selector) !== JSON.stringify(object.spec.selector)) return { run: next, lines, diagnostics: [{ code: 'KUBE_IMMUTABLE_SELECTOR', message: 'Deployment selector is immutable.' }] }
    const uid = old?.metadata.uid ?? `kube-${next.nextSequence++}`
    const resourceVersion = String(Number(old?.metadata.resourceVersion ?? '0') + 1)
    const generation = object.kind === 'Deployment' ? (old ? (JSON.stringify(old.spec) === JSON.stringify(object.spec) ? old.metadata.generation : (old.metadata.generation ?? 1) + 1) : 1) : undefined
    next.runtime.kubernetes.clusters[clusterId].resources[key] = { ...object, metadata: { ...object.metadata, uid, resourceVersion, ...(generation === undefined ? {} : { generation }) } }
    lines.push({ text: `${object.kind.toLowerCase()}/${object.metadata.name} ${old ? 'configured' : 'created'}`, kind: 'out' })
  }
  return { run: next, lines, diagnostics }
}

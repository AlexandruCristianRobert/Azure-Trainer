import { validateKubernetesObject } from './schema.js'
import { scheduleConfigurationProjection } from './configuration.js'
import { serviceAllocationDiagnostic } from './services.js'
import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { registerRevision } from './rollout-history.js'

export const kubeObjectKey = (kind, namespace = '', name) => `${kind}/${namespace ?? ''}/${name}`
const clone = value => structuredClone(value)
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
const desiredObject = value => ({ apiVersion: value.apiVersion, kind: value.kind, metadata: canonical({ name: value.metadata.name, ...(value.metadata.namespace ? { namespace: value.metadata.namespace } : {}), ...(value.metadata.labels ? { labels: value.metadata.labels } : {}) }), ...(value.spec ? { spec: canonical(value.spec) } : {}), ...(value.type ? { type: value.type } : {}), ...(value.data ? { data: canonical(value.data) } : {}) })

export function applyKubernetesObjects(run, documents, options = {}, lab) {
  const clusterId = options.clusterId
  const state = run.runtime.kubernetes.clusters[clusterId]
  let next = clone(run); const diagnostics = []; const lines = []
  if (!state) return { run, lines, diagnostics: [{ code: 'KUBE_CLUSTER_NOT_FOUND', message: 'The selected Kubernetes cluster is unavailable.' }] }
  const connectivity = state.connectivity
  if (lab?.capabilities?.kubernetesResources === true && !next.runtime.kubernetes.clusters[clusterId].resourcesRuntime) {
    next.runtime.kubernetes.clusters[clusterId].resourcesRuntime = { version: 1, nodes: clone(RESOURCE_FIXTURES.nodes), assignments: {}, usage: {}, metrics: {}, hpa: {}, experiment: null, receipts: [], incident: null, terminationDue: {}, accountedUntilMs: null }
  }
  if (connectivity) {
    const incoming = documents.filter(item => item?.kind === 'Service').filter(item => {
      const namespace = item.metadata?.namespace ?? options.namespace
      return !state.resources[kubeObjectKey('Service', namespace, item.metadata?.name)]
    })
    const external = incoming.filter(item => (item.spec?.type ?? 'ClusterIP') === 'LoadBalancer')
    if (connectivity.nextServiceAddress + incoming.length - 1 > 4063 || connectivity.nextExternalAddress + external.length - 1 > 254) {
      return { run, lines, diagnostics: [{ code: 'SIMULATOR_LIMIT', message: 'The simulated Service address range is exhausted.' }] }
    }
  }
  for (let i = 0; i < documents.length; i++) {
    const result = validateKubernetesObject(documents[i], { namespace: options.namespace, capabilities: { deployments: Object.values(next.runtime.kubernetes.clusters[clusterId].resources).filter(x => x.kind === 'Deployment' || x.kind === 'HorizontalPodAutoscaler'), kubernetesConfiguration: lab?.capabilities?.kubernetesConfiguration === true, kubernetesProbes: lab?.capabilities?.kubernetesProbes === true, kubernetesResources: lab?.capabilities?.kubernetesResources === true, kubernetesRollouts: lab?.capabilities?.kubernetesRollouts === true }, sourceLocation: options.locations?.[i] })
    if (result.diagnostics.length) return { run: next, lines, diagnostics: result.diagnostics }
    const object = result.object
    const ns = object.metadata.namespace ?? ''
    if (object.kind !== 'Namespace' && !next.runtime.kubernetes.clusters[clusterId].resources[kubeObjectKey('Namespace', '', ns)]) {
      return { run: next, lines, diagnostics: [{ code: 'KUBE_NAMESPACE_NOT_FOUND', message: `Namespace '${ns}' was not found.` }] }
    }
    const key = kubeObjectKey(object.kind, ns, object.metadata.name); const old = next.runtime.kubernetes.clusters[clusterId].resources[key]
    const explicitReplicas = documents[i]?.kind === 'Deployment' && Object.hasOwn(documents[i]?.spec ?? {}, 'replicas')
    if (object.kind === 'Deployment' && lab?.capabilities?.kubernetesResources === true) {
      const ownership = next.runtime.kubernetes.clusters[clusterId].applyOwnership ??= {}
      if (!old) ownership[key] = { replicas: explicitReplicas }
      else if (explicitReplicas) ownership[key] = { replicas: true }
      else if (ownership[key]?.replicas) { object.spec.replicas = 1; ownership[key] = { replicas: false } }
      else object.spec.replicas = old.spec.replicas
    }
    const allocationIssue = object.kind === 'Service' ? serviceAllocationDiagnostic(next, clusterId, object, old) : null
    if (allocationIssue) return { run: next, lines, diagnostics: [allocationIssue] }
    if (object.kind === 'Deployment' && old?.spec?.template?.metadata?.annotations?.['kubectl.kubernetes.io/restarted-at']
      && object.spec.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at'] === undefined) {
      object.spec.template.metadata.annotations = { ...(object.spec.template.metadata.annotations ?? {}), 'kubectl.kubernetes.io/restarted-at': old.spec.template.metadata.annotations['kubectl.kubernetes.io/restarted-at'] }
    }
    const desired = JSON.stringify(desiredObject(object))
    if (old && JSON.stringify(desiredObject(old)) === desired) { lines.push({ text: `${object.kind.toLowerCase()}/${object.metadata.name} unchanged`, kind: 'out' }); continue }
    if (old?.kind === 'Deployment' && JSON.stringify(canonical(old.spec.selector)) !== JSON.stringify(canonical(object.spec.selector))) return { run: next, lines, diagnostics: [{ code: 'KUBE_IMMUTABLE_SELECTOR', message: 'Deployment selector is immutable.' }] }
    if (old?.kind === 'Service' && old.spec.type !== object.spec.type) return { run: next, lines, diagnostics: [{ code: 'KUBE_IMMUTABLE_SERVICE_TYPE', message: 'Changing a Service type in place is unsupported by this trainer.' }] }
    const uid = old?.metadata.uid ?? `kube-${next.nextSequence++}`
    const resourceVersion = String(Number(old?.metadata.resourceVersion ?? '0') + 1)
    const generation = object.kind === 'Deployment' ? (old ? (JSON.stringify(old.spec) === JSON.stringify(object.spec) ? old.metadata.generation : (old.metadata.generation ?? 1) + 1) : 1) : undefined
    const generatedService = old?.kind === 'Service' ? {
      spec: { ...(old.spec.clusterIP ? { clusterIP: old.spec.clusterIP } : {}) },
      ...(old.status ? { status: clone(old.status) } : {}),
    } : {}
    next.runtime.kubernetes.clusters[clusterId].resources[key] = { ...object, ...generatedService,
      ...(object.kind === 'Service' ? { spec: { ...object.spec, ...(generatedService.spec ?? {}) } } : {}),
      metadata: { ...object.metadata, uid, resourceVersion, ...(generation === undefined ? {} : { generation }) } }
    if (object.kind === 'Deployment' && lab?.capabilities?.kubernetesRollouts === true) {
      const revision = registerRevision(next, { clusterId, namespace: object.metadata.namespace, deploymentName: object.metadata.name, deploymentUid: uid }, object.spec.template)
      next = revision.run
    }
    if (object.kind === 'HorizontalPodAutoscaler' && old && JSON.stringify(old.spec) !== JSON.stringify(object.spec)) {
      const controller = next.runtime.kubernetes.clusters[clusterId].resourcesRuntime?.hpa?.[uid]
      if (controller) {
        controller.policyGeneration += 1
        controller.recommendations = []
        controller.lastDecision = { reason: 'policy-changed', rawDesired: null, adjustedDesired: null, stabilizedDesired: null, observedUtilization: null, missingSamples: false, unreadySamples: false, atMs: next.runtime.simTimeMs, beforeStabilization: null }
      }
    }
    if (object.kind === 'ConfigMap' || object.kind === 'Secret') next = scheduleConfigurationProjection(next, clusterId, key)
    lines.push({ text: `${object.kind.toLowerCase()}/${object.metadata.name} ${old ? 'configured' : 'created'}`, kind: 'out' })
  }
  return { run: next, lines, diagnostics }
}

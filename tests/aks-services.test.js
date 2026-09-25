import { expect, it } from 'vitest'
import { seedFoundation, seedConnectivityTest, act } from './helpers/aks.js'
import { getServiceBackends, initializeConnectivity, reconcileServices } from '../src/lib/kubernetes/services.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'

it('keeps a numeric backend port even if the application does not listen there', () => {
  let { run, clusterId } = seedFoundation()
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  const service = run.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/assistant']
  service.spec.ports[0].targetPort = 8081
  const view = getServiceBackends(run, { clusterId, namespace: 'assistant', serviceName: 'assistant' })
  expect(view.readyEndpoints).toHaveLength(2)
  expect(view.readyEndpoints.every(endpoint => endpoint.port === 8081)).toBe(true)
})

it('seeds a configured assistant and a trusted diagnostic Pod without requests', () => {
  const { lab, run, clusterId, diagnosticPodUid, target } = seedConnectivityTest()
  const state = run.runtime.kubernetes.clusters[clusterId]
  expect(target.serviceName).toBe('assistant-internal')
  expect(state.resources['Service/assistant/assistant-internal']).toBeTruthy()
  expect(state.connectivity.diagnosticPodUids).toEqual([diagnosticPodUid])
  expect(state.resources[`Pod/diagnostics/diagnostics`].metadata.uid).toBe(diagnosticPodUid)
  expect(run.runtime.kubernetes.requests).toEqual([])
  expect(state.connectivity.applicationLogs).toEqual([])
  expect(lab.scenarios['network-internal'].expected.body.environment).toBe('training')
  expect(validateBehavioralRun(run, lab)).toBe(run)
})

it('uses the requested profile in the named internal scenario', () => {
  const { lab } = seedConnectivityTest({ profile: 'review' })
  expect(lab.scenarios['network-internal'].expected.body.environment).toBe('review')
})

it('rejects exhausted Service address allocation before creating a Service', () => {
  const { lab, run, clusterId } = seedConnectivityTest()
  const exhausted = structuredClone(run)
  exhausted.runtime.kubernetes.clusters[clusterId].connectivity.nextServiceAddress = 4064
  const result = applyKubernetesObjects(exhausted, [{ apiVersion: 'v1', kind: 'Service', metadata: { name: 'another', namespace: 'assistant' }, spec: { type: 'ClusterIP', selector: { app: 'assistant' }, ports: [{ port: 80, targetPort: 'http', protocol: 'TCP' }] } }], { clusterId }, lab)
  expect(result.diagnostics[0]).toMatchObject({ code: 'SIMULATOR_LIMIT' })
  expect(result.run.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/another']).toBeUndefined()
})

it('reconciles EndpointSlices when kubectl deletes a Service', () => {
  let { lab, run, clusterId } = seedConnectivityTest()
  run = act(run, lab, { type: 'command', line: 'kubectl delete service assistant-internal -n assistant' }).run
  expect(Object.values(run.runtime.kubernetes.clusters[clusterId].resources).some(item => item.kind === 'EndpointSlice')).toBe(false)
})

it('rejects forged diagnostic identities and stale EndpointSlices', () => {
  const { lab, run, clusterId } = seedConnectivityTest()
  const forgedDiagnostic = structuredClone(run)
  forgedDiagnostic.runtime.kubernetes.clusters[clusterId].connectivity.diagnosticPodUids = [Object.values(forgedDiagnostic.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant').metadata.uid]
  expect(() => validateBehavioralRun(forgedDiagnostic, lab)).toThrow(/Kubernetes/)
  const staleSlice = structuredClone(run)
  Object.values(staleSlice.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'EndpointSlice').endpoints = []
  expect(() => validateBehavioralRun(staleSlice, lab)).toThrow(/Kubernetes/)
})

it('allocates stable addresses and projects ready EndpointSlice endpoints', () => {
  let { run, clusterId } = seedFoundation()
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  const state = run.runtime.kubernetes.clusters[clusterId]
  const service = state.resources['Service/assistant/assistant']
  const slice = Object.values(state.resources).find(item => item.kind === 'EndpointSlice')
  const before = { address: service.spec.clusterIP, external: service.status.loadBalancer.ingress[0].ip, uid: slice.metadata.uid, version: slice.metadata.resourceVersion, sequence: run.nextSequence }
  run = reconcileServices(run, clusterId)
  const next = run.runtime.kubernetes.clusters[clusterId]
  const nextSlice = Object.values(next.resources).find(item => item.kind === 'EndpointSlice')
  expect(next.resources['Service/assistant/assistant'].spec.clusterIP).toBe(before.address)
  expect(next.resources['Service/assistant/assistant'].status.loadBalancer.ingress[0].ip).toBe(before.external)
  expect(nextSlice.metadata.uid).toBe(before.uid)
  expect(nextSlice.metadata.resourceVersion).toBe(before.version)
  expect(nextSlice.endpoints).toHaveLength(2)
  expect(run.nextSequence).toBe(before.sequence)
})

it('does not select identically labelled Pods in another namespace', () => {
  let { run, clusterId } = seedFoundation()
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  const state = run.runtime.kubernetes.clusters[clusterId]
  const pod = Object.values(state.resources).find(item => item.kind === 'Pod')
  state.resources['Pod/default/foreign'] = { ...structuredClone(pod), metadata: { ...pod.metadata, name: 'foreign', namespace: 'default', uid: 'foreign-pod' }, status: { ...pod.status, podIP: '10.244.0.250' } }
  const view = getServiceBackends(run, { clusterId, namespace: 'assistant', serviceName: 'assistant' })
  expect(view.selectedPods).toHaveLength(2)
  expect(view.endpoints.map(endpoint => endpoint.namespace)).toEqual(['assistant', 'assistant'])
})

it('removes derived slices when a Service is deleted without deleting Pods', () => {
  let { run, clusterId } = seedFoundation()
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  const state = run.runtime.kubernetes.clusters[clusterId]
  const podUids = Object.values(state.resources).filter(item => item.kind === 'Pod').map(item => item.metadata.uid)
  delete state.resources['Service/assistant/assistant']
  run = reconcileServices(run, clusterId)
  expect(Object.values(run.runtime.kubernetes.clusters[clusterId].resources).some(item => item.kind === 'EndpointSlice')).toBe(false)
  expect(Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'Pod').map(item => item.metadata.uid)).toEqual(podUids)
})

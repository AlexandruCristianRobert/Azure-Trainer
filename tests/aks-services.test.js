import { expect, it } from 'vitest'
import { seedFoundation } from './helpers/aks.js'
import { getServiceBackends, initializeConnectivity, reconcileServices } from '../src/lib/kubernetes/services.js'

it('keeps a numeric backend port even if the application does not listen there', () => {
  let { run, clusterId } = seedFoundation()
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  const service = run.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/assistant']
  service.spec.ports[0].targetPort = 8081
  const view = getServiceBackends(run, { clusterId, namespace: 'assistant', serviceName: 'assistant' })
  expect(view.readyEndpoints).toHaveLength(2)
  expect(view.readyEndpoints.every(endpoint => endpoint.port === 8081)).toBe(true)
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

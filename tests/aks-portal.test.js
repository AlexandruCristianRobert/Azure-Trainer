import { expect, it } from 'vitest'
import { projectKubernetesInspection } from '../src/lib/kubernetes/inspection.js'
import { seedFoundation } from './helpers/aks.js'
import { reconcileKubernetes } from '../src/lib/kubernetes/reconcile.js'
import { reactive } from 'vue'

it('projects a reactive store run without leaking Vue proxies into inspection', () => {
  const { run, clusterId } = seedFoundation()
  const before = structuredClone(run)
  const view = projectKubernetesInspection(reactive(run), clusterId)
  expect(view.cluster.id).toBe(clusterId)
  expect(view.pods).toHaveLength(2)
  expect(run).toEqual(before)
  expect(structuredClone(view)).toEqual(view)
})

it('projects only the selected cluster without mutating the run', () => {
  const { run, clusterId } = seedFoundation()
  const before = structuredClone(run)
  const view = projectKubernetesInspection(run, clusterId)
  expect(view.cluster.id).toBe(clusterId)
  expect(view.pods).toHaveLength(2)
  expect(view.deployments.map(item => item.metadata.namespace)).toEqual(['assistant'])
  expect(view.serviceEndpoints).toEqual([expect.objectContaining({ name: 'assistant', namespace: 'assistant', targetPort: 'http', resolvedPort: 8080, readyBackends: expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })]) })])
  expect(run).toEqual(before)
  expect(projectKubernetesInspection(run, 'missing')).toMatchObject({ cluster: null, pods: [], namespaces: [] })
})

it('keeps inspection scoped and redacts request bodies', () => {
  const { run, clusterId } = seedFoundation()
  const copy = structuredClone(run)
  copy.runtime.kubernetes.requests.push({ id: 'aks-request-99', clusterId, namespace: 'assistant', status: 200, body: { token: 'secret' }, selectedPods: [{ body: { token: 'secret' } }] })
  const other = structuredClone(copy.sandbox.aksClusters[0])
  other.id = 'second-cluster'; other.name = 'aks02'
  copy.sandbox.aksClusters.push(other)
  copy.runtime.kubernetes.clusters[other.id] = { ...structuredClone(copy.runtime.kubernetes.clusters[clusterId]), resources: {}, events: [] }
  const view = projectKubernetesInspection(copy, clusterId)
  expect(view.requests).toEqual([expect.objectContaining({ id: 'aks-request-99', status: 200, namespace: 'assistant' })])
  expect(view.requests[0]).not.toHaveProperty('body')
  expect(view.requests[0]).not.toHaveProperty('selectedPods')
})

it('retains an event namespace so the blade can scope image failures', () => {
  const { run, clusterId } = seedFoundation()
  run.runtime.kubernetes.clusters[clusterId].events.push({ metadata: { name: 'event-other', namespace: 'other' }, reason: 'ImageNotFound', message: 'Other namespace only.' })
  const view = projectKubernetesInspection(run, clusterId)
  expect(view.events[0].metadata.namespace).toBe('other')
})

it('keeps numeric targetPort endpoints even without a declared container port', () => {
  const { run, clusterId } = seedFoundation()
  const service = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Service')
  service.spec.ports[0].targetPort = 9090
  for (const pod of Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'Pod')) pod.spec.containers[0].ports = []
  const endpoint = projectKubernetesInspection(run, clusterId).serviceEndpoints[0]
  expect(endpoint.resolvedPort).toBe(9090)
  expect(endpoint.readyBackends).toHaveLength(2)
})

it('records the emitting namespace on new image pull events', () => {
  const { run, clusterId } = seedFoundation()
  const deployment = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Deployment')
  deployment.spec.replicas = 3
  deployment.spec.template.spec.containers[0].image = 'acraks01.azurecr.io/assistant:missing'
  const view = projectKubernetesInspection(reconcileKubernetes(run), clusterId)
  expect(view.events.find(item => item.reason === 'ImageNotFound')?.metadata.namespace).toBe('assistant')
})

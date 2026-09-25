import { expect, it } from 'vitest'
import { createAksTestRun, act } from './helpers/aks.js'
import { seedFoundation } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

it('requires a current Kubernetes context', () => {
  const { run, lab } = createAksTestRun()
  expect(() => act(run, lab, { type: 'command', line: 'kubectl get pods' })).toThrow(/context/i)
})

it('keeps Pod ids on a no-op saved apply', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(p => p.metadata.uid)
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(p => p.metadata.uid)).toEqual(before)
})

it('rejects an explicit namespace that conflicts with a manifest', () => {
  const { run, lab } = seedFoundation()
  expect(() => act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml -n wrong' })).toThrow(/namespace/i)
})

it('renders a saved deployment as structured JSON without mutating Kubernetes state', () => {
  const { run, lab } = seedFoundation()
  const before = structuredClone(run.runtime.kubernetes)
  const result = act(run, lab, { type: 'command', line: 'kubectl get deployment assistant -n assistant -o json' })
  expect(JSON.parse(result.lines[0].text).metadata.name).toBe('assistant')
  expect(result.run.runtime.kubernetes).toEqual(before)
})

it('reports rollout pending when a Deployment has no Pods and rejects unsupported rollout flags', () => {
  const { run, lab, clusterId } = seedFoundation()
  const empty = structuredClone(run)
  for (const pod of getDeploymentPods(empty, clusterId, 'assistant', 'assistant')) {
    delete empty.runtime.kubernetes.clusters[clusterId].resources[`Pod/assistant/${pod.metadata.name}`]
    delete empty.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.metadata.uid]
  }
  const status = act(empty, lab, { type: 'command', line: 'kubectl rollout status deployment/assistant -n assistant' })
  expect(status.lines[0].text).toMatch(/pending/i)
  expect(() => act(run, lab, { type: 'command', line: 'kubectl rollout status deployment/assistant -n assistant -o json' })).toThrow(/flag/i)
})

it('uses actual Service target ports for describe endpoints', () => {
  const { run, lab, clusterId } = seedFoundation()
  const changed = structuredClone(run)
  changed.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/assistant'].spec.ports[0].targetPort = 9999
  const result = act(changed, lab, { type: 'command', line: 'kubectl describe service assistant -n assistant' })
  expect(result.lines[0].text).toContain('Endpoints: <none>')
})

it('keeps dry-run and malformed saved syntax from mutating state', () => {
  let { run, lab } = seedFoundation()
  const before = structuredClone(run.runtime.kubernetes)
  const dry = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml --dry-run=client -o json' })
  expect(dry.run.runtime.kubernetes).toEqual(before)
  run = act(run, lab, { type: 'save-file', path: 'k8s/service.yaml', text: 'apiVersion: v1\nkind: Service\nmetadata: [' }).run
  const failed = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml' }, lab)
  expect(failed.run.runtime.kubernetes).toEqual(before)
})

it('rejects excess config arguments and filters namespaced events', () => {
  const { run, lab, clusterId } = seedFoundation()
  expect(() => act(run, lab, { type: 'command', line: 'kubectl config current-context extra' })).toThrow(/arguments/i)
  const next = structuredClone(run)
  next.runtime.kubernetes.clusters[clusterId].events.push(
    { apiVersion: 'v1', kind: 'Event', metadata: { name: 'assistant-event', namespace: 'assistant' }, reason: 'Test' },
    { apiVersion: 'v1', kind: 'Event', metadata: { name: 'other-event', namespace: 'other' }, reason: 'Test' },
  )
  const result = act(next, lab, { type: 'command', line: 'kubectl get events -n assistant -o json' })
  expect(JSON.parse(result.lines[0].text).metadata.name).toBe('assistant-event')
})

it('deletes a saved Deployment and its controller-owned Pods without deleting its Service', () => {
  let { run, lab, clusterId } = seedFoundation()
  run = act(run, lab, { type: 'command', line: 'kubectl delete -f k8s/deployment.yaml' }).run
  const resources = run.runtime.kubernetes.clusters[clusterId].resources
  expect(resources['Deployment/assistant/assistant']).toBeUndefined()
  expect(Object.values(resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')).toHaveLength(0)
  expect(resources['Service/assistant/assistant']).toBeTruthy()
})

it('does not leak case-sensitive namespaces or contexts', () => {
  const { run, lab } = seedFoundation()
  expect(() => act(run, lab, { type: 'command', line: 'kubectl get pods -n Assistant' })).toThrow(/Namespace 'Assistant'/)
  expect(() => act(run, lab, { type: 'command', line: 'kubectl get pods --context AKS01' })).toThrow(/context/i)
})

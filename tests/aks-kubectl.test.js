import { expect, it } from 'vitest'
import { createAksTestRun, act } from './helpers/aks.js'
import { seedFoundation } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'

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

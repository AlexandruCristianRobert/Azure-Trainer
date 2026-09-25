import { expect, it } from 'vitest'
import { seedFoundation, act } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

it('replaces a deleted Pod without changing its desired template', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  run = act(run, lab, { type: 'command', line: `kubectl delete pod ${before[0].metadata.name} -n assistant` }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(after).toHaveLength(2)
  expect(after.every(p => p.status.phase === 'Running')).toBe(true)
  expect(after.some(p => p.metadata.uid === before[0].metadata.uid)).toBe(false)
  expect(after.some(p => p.metadata.uid === before[1].metadata.uid)).toBe(true)
})

it('preserves an earlier object when a later object targets a missing namespace', () => {
  let { run, lab } = seedFoundation()
  run = act(run, lab, { type: 'save-file', path: 'k8s/namespace.yaml', text: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: retained\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: later\n  namespace: absent\nspec:\n  type: ClusterIP\n  selector:\n    app: absent\n  ports:\n  - port: 80\n    targetPort: 8080\n    protocol: TCP\n' }).run
  const result = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/namespace.yaml' }, lab)
  expect(result.lines.at(-1).text).toMatch(/Namespace 'absent'/)
  expect(result.run.runtime.kubernetes.clusters[result.run.sandbox.aksClusters[0].id].resources['Namespace//retained']).toBeTruthy()
})

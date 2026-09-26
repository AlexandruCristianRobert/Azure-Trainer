import { describe, expect, test } from 'vitest'
import { normalizeRolloutSpec, resolveRolloutBudget } from '../src/lib/kubernetes/rollout-schema.js'
import { registerRevision } from '../src/lib/kubernetes/rollout-history.js'

describe('rollout schema', () => {
  test('normalizes the supported rolling update defaults and percentage budget', () => {
    expect(normalizeRolloutSpec({}).value).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' }, minReadySeconds: 0, progressDeadlineSeconds: 600, revisionHistoryLimit: 10 })
    expect(resolveRolloutBudget({ maxSurge: '25%', maxUnavailable: '25%' }, 3)).toEqual({ surge: 1, unavailable: 0 })
  })

  test('rejects an invalid configured zero availability budget', () => {
    expect(normalizeRolloutSpec({ rollingUpdate: { maxSurge: 0, maxUnavailable: 0 } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_BUDGET')
  })
})

test('reuses a retained template while promoting a monotonic revision', () => {
  const one = { metadata: { labels: { app: 'assistant' } }, spec: { containers: [{ name: 'api', image: 'a:v1' }] } }
  const run = { nextSequence: 10, runtime: { simTimeMs: 0, kubernetes: { clusters: { c1: { resources: {
    'Deployment/assistant/assistant': { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'assistant', namespace: 'assistant', uid: 'deploy-1', generation: 1 }, spec: { replicas: 2, selector: { matchLabels: { app: 'assistant' } }, template: one } },
    'ReplicaSet/assistant/assistant-v1': { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: 'assistant-v1', namespace: 'assistant', uid: 'rs-1', ownerReferences: [{ uid: 'deploy-1', kind: 'Deployment', name: 'assistant' }] }, spec: { replicas: 2, selector: { matchLabels: { app: 'assistant' } }, template: one } },
  } } } } } }
  const target = { clusterId: 'c1', namespace: 'assistant', deploymentName: 'assistant', deploymentUid: 'deploy-1' }
  const two = { metadata: { labels: { app: 'assistant' } }, spec: { containers: [{ name: 'api', image: 'a:v2' }] } }
  const first = registerRevision(run, target, one)
  const second = registerRevision(first.run, target, two)
  const restored = registerRevision(second.run, target, one)
  expect(restored.revision).toBe(3)
  expect(restored.rsUid).toBe(first.rsUid)
})

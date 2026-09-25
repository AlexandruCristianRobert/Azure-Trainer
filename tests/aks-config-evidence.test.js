import { expect, it } from 'vitest'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { act, seedConfiguredAssistant } from './helpers/aks.js'
import { configurationDependencies } from '../src/lib/kubernetes/evidence.js'

it('keeps environment old but refreshes mounted files after explicit simulated time', () => {
  let { run, lab, clusterId } = seedConfiguredAssistant()
  const pod = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
  const before = structuredClone(run.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.metadata.uid])
  const text = run.project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: training-updated').replace('Training assistant', 'Updated assistant')
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  expect(run.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.metadata.uid].environment.APP_ENV).toBe('training')
  run = act(run, lab, { type: 'aks-advance', seconds: 60 }).run
  const after = run.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.metadata.uid]
  expect(after.environment).toEqual(before.environment)
  expect(after.files['/etc/assistant/settings.json']).toContain('Updated assistant')
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
  const next = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
  expect(next.metadata.uid).not.toBe(pod.metadata.uid)
  expect(run.runtime.kubernetes.clusters[clusterId].podSnapshots[next.metadata.uid].environment.APP_ENV).toBe('training-updated')
})

it('records a redacted supplied-assistant dependency trace for immutable ask scenarios', () => {
  let { run, lab, clusterId } = seedConfiguredAssistant()
  const scenario = { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' },
    request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
    expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' } } }
  lab = { ...lab, scenarios: { ask: scenario }, tasks: [{ id: 'ask-task', verification: { scenarioId: 'ask', scenarioVersion: 1 }, dependencies: {}, check: () => false }] }
  run = act(run, lab, { type: 'aks-request', scenarioId: 'ask' }).run
  const record = run.runtime.kubernetes.requests.at(-1)
  expect(record.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
  expect(JSON.stringify(record)).not.toContain('training-only-password')
})

it('does not mutate an ask scenario or leak its dependency trace into another request', () => {
  let { run, lab, clusterId } = seedConfiguredAssistant()
  const scenario = { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', displayName: 'Training assistant' } } }
  lab = { ...lab, scenarios: { ask: scenario }, tasks: [{ id: 'ask-task', verification: { scenarioId: 'ask', scenarioVersion: 1 }, dependencies: {}, check: () => false }] }
  run = act(run, lab, { type: 'aks-request', scenarioId: 'ask' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'ask' }).run
  expect(scenario).not.toHaveProperty('dependencyTrace')
  expect(run.runtime.kubernetes.requests.slice(-2).every(item => item.dependencyTrace.length === 3)).toBe(true)
})

it('separates current applied configuration from a captured stale environment', () => {
  let { run, lab, clusterId } = seedConfiguredAssistant()
  const text = run.project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: training-updated')
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  const selected = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
  const scenario = { kind: 'aks-request', version: 1, target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } }, expectedCurrentConfig: { APP_ENV: 'training-updated' }, expectedCapturedConfig: { APP_ENV: 'training' } }
  lab = { ...lab, scenarios: { stale: scenario }, tasks: [{ id: 'stale-task', verification: { scenarioId: 'stale', scenarioVersion: 1 }, dependencies: {}, check: () => false }] }
  run = act(run, lab, { type: 'aks-request', scenarioId: 'stale' }).run
  expect(run.runtime.kubernetes.requests.at(-1).selectedPodUid).toBe(selected.metadata.uid)
  expect(run.runtime.kubernetes.requests.at(-1).currentConfigMatches).toBe(true)
  expect(run.runtime.kubernetes.requests.at(-1).capturedConfigMatches).toBe(true)
})

it('tracks applied configuration for live evidence but retains only stable identity for history', () => {
  let { run, lab, clusterId } = seedConfiguredAssistant()
  const target = { clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant' }
  const live = configurationDependencies(target)
  const historical = configurationDependencies(target, { historical: true })
  const beforeLive = live[Object.keys(live)[0]](run)
  const beforeHistory = historical[Object.keys(historical)[0]](run)
  const text = run.project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: training-updated')
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  expect(live[Object.keys(live)[0]](run)).not.toEqual(beforeLive)
  expect(historical[Object.keys(historical)[0]](run)).toEqual(beforeHistory)
})

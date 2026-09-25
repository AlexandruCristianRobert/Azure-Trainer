import { expect, it } from 'vitest'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { act, seedConfiguredAssistant } from './helpers/aks.js'

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

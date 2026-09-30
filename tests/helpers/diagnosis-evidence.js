import { seedDiagnosisTest, act, advanceHealth } from './aks.js'
import { diagnosisDependencies } from '../../src/lib/kubernetes/evidence.js'

export function diagnosisFixture(options = {}) {
  const fixture = seedDiagnosisTest(options), { target } = fixture
  const requestTarget = Object.fromEntries(['clusterId', 'namespace', 'deploymentName', 'serviceName'].map(key => [key, target[key]]))
  const review = options.profile === 'review' || options.fault === 'review-audience'
  const body = { answer: review ? 'Review backups are kept for 7 days.' : 'Training backups are kept for 30 days.',
    sources: [review ? 'review-backups' : 'training-backups'], environment: review ? 'review' : 'training', release: '2.0' }
  const scenario = (expected, integrationProfile = 'healthy') => ({ kind: 'aks-request', version: 1, target: requestTarget,
    request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
    connectivity: { origin: { kind: 'diagnostic', name: 'diagnostics', namespace: 'diagnostics' }, hostname: 'assistant-internal.assistant', port: 80 },
    expected, integrationProfile, requireTwoReplicas: true })
  const scenarios = { current: scenario({ status: 200, body }), external: { ...scenario({ status: 200, body }), target: { ...requestTarget, serviceName: 'assistant-public' },
    connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-public', namespace: 'assistant' }, port: 80 } },
    blank: { ...scenario({ status: 400, body: { error: 'Question is required.' } }), request: { method: 'POST', path: '/api/ask', body: { question: ' ' } } },
    exhausted: scenario({ status: 503, body: { error: 'A dependency remained unavailable after retries.', code: 'DEPENDENCY_UNAVAILABLE' } }, 'answer-unavailable-always'),
    missing: { ...scenario({ status: 200, body: { answer: 'No matching documents.', sources: [], environment: review ? 'review' : 'training' } }),
      request: { method: 'POST', path: '/api/ask', body: { question: 'What is the travel allowance?' } } } }
  const lab = { ...fixture.lab, scenarios, tasks: Object.entries(scenarios).map(([id, value]) => ({ id, check: () => true,
    dependencies: diagnosisDependencies?.(value.target) ?? {}, verification: { scenarioId: id, scenarioVersion: 1 } })) }
  return { ...fixture, lab }
}

export function finalWitness(run, lab) {
  for (const path of ['k8s/deployment.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml'])
    run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  return advanceHealth(run, lab, 90)
}

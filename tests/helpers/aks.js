import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { createBehavioralRun } from '../../src/lib/labEngine/run.js'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../../src/data/templates/aks-python/foundation.js'
import { kubernetesDependencies } from '../../src/lib/kubernetes/evidence.js'

export function makeAksLab(overrides = {}) {
  return {
    id: 'aks-test', engineVersion: 2, contentVersion: 1,
    manifestId: FOUNDATION_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true },
    initialProjectFiles: { ...FOUNDATION_FILES },
    tasks: [{ id: 'pending', check: () => false }],
    ...overrides,
  }
}

export function act(run, lab, action) {
  const result = applyRunAction(run, action, lab)
  const errors = (result.lines ?? []).filter(line => typeof line === 'string' ? /^\s*(ERROR|Error:)/.test(line) : line.kind === 'err')
  if (result.diagnostics?.length || errors.length) throw new Error([...result.diagnostics.map(item => item.message), ...errors.map(line => typeof line === 'string' ? line : line.text)].join('\n'))
  return result
}

export function createAksTestRun(overrides = {}) {
  const lab = makeAksLab(overrides)
  return { lab, run: createBehavioralRun(lab, { attemptId: 'test-aks' }) }
}

export function seedFoundation({ namespace = 'assistant', version = '1.0' } = {}) {
  const { lab, run: initial } = createAksTestRun()
  let run = initial
  run = act(run, lab, { type: 'command', line: 'az group create -n rgaks01 -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az acr create -g rgaks01 -n acraks01 --sku Basic' }).run
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: run.project.draftFiles['app.py'].replace('"0.1"', `"${version}"`) }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/namespace.yaml', text: `apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ${namespace}\n` }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.draftFiles['k8s/deployment.yaml'].replaceAll('assistant', namespace).replace('acraksguided.azurecr.io/assistant:starter', 'acraks01.azurecr.io/assistant:v1').replace('replicas: 1', 'replicas: 2').replace('value: development', 'value: training') }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/service.yaml', text: run.project.draftFiles['k8s/service.yaml'].replaceAll('assistant', namespace) }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraks01 -t assistant:v1 .' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rgaks01 -n aks01 --enable-managed-identity --generate-ssh-keys --attach-acr acraks01' }).run
  run = act(run, lab, { type: 'command', line: 'az aks get-credentials -g rgaks01 -n aks01' }).run
  for (const path of ['k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml']) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  const clusterId = run.sandbox.aksClusters[0].id
  const dependencies = kubernetesDependencies(clusterId, namespace, 'assistant', 'assistant', { sourceSensitive: true })
  const scenario = { kind: 'aks-request', version: 1,
    target: { clusterId, namespace, serviceName: 'assistant', deploymentName: 'assistant' },
    request: { method: 'GET', path: '/api/info' },
    expected: { status: 200, body: { service: 'knowledge-assistant', version, environment: 'training' } },
    requireReplacement: false }
  const evidenceLab = { ...lab, scenarios: { info: scenario, replacement: { ...scenario, requireReplacement: true } },
    tasks: [{ id: 'info-task', verification: { scenarioId: 'info', scenarioVersion: 1 }, dependencies, check: () => false },
      { id: 'replacement-task', verification: { scenarioId: 'replacement', scenarioVersion: 1 }, dependencies, check: () => false }] }
  return { lab: evidenceLab, run, clusterId }
}

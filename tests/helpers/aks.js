import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { createBehavioralRun } from '../../src/lib/labEngine/run.js'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../../src/data/templates/aks-python/foundation.js'
import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../src/data/templates/aks-python/configuration.js'
import { kubernetesDependencies } from '../../src/lib/kubernetes/evidence.js'
import { initializeConnectivity, reconcileServices } from '../../src/lib/kubernetes/services.js'

export function makeTrainingSnapshot() {
  return {
    artifactId: 'build-fixture', templateHash: 'template-fixture',
    environment: {
      APP_ENV: 'training',
      AI_ENDPOINT: 'https://ai-training.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1',
      PGHOST: 'pg-training.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_training', PGPASSWORD: 'training-only-password', COLLECTION: 'training',
    },
    files: { '/etc/assistant/settings.json': '{"display_name":"Training assistant","response_prefix":""}' },
    configRefs: [],
  }
}

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

export function executeAksSolution(run, lab, task) {
  for (const step of task.solution?.steps ?? []) {
    if (step.kind === 'file') {
      run = act(run, lab, { type: 'draft', path: step.path, text: step.content }).run
      run = act(run, lab, { type: 'save-file', path: step.path }).run
    } else if (step.kind === 'command') {
      const action = step.resolver
        ? lab.solutionActionResolvers?.[step.resolver]?.(run, lab, task, step.resolver)
        : { type: 'command', line: step.line }
      if (!action) throw new Error(`Unknown AKS solution command resolver: ${step.resolver ?? '(missing)'}`)
      run = act(run, lab, action).run
    } else if (step.kind === 'scenario') {
      run = act(run, lab, { type: 'aks-request', scenarioId: step.scenarioId }).run
    } else if (step.kind !== 'inspect') {
      throw new Error(`Unsupported AKS solution step: ${step.kind}`)
    }
  }
  return run
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

export function seedConfiguredAssistant({ namespace = 'assistant', profile = 'training' } = {}) {
  const { lab: initialLab, run: initial } = createAksTestRun({ manifestId: CONFIG_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true }, initialProjectFiles: { ...CONFIG_FILES } })
  let run = initial
  const lab = { ...initialLab, capabilities: { ...initialLab.capabilities, kubernetesConfiguration: true } }
  run = act(run, lab, { type: 'command', line: 'az group create -n rgaksconfig -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az acr create -g rgaksconfig -n acraksconfig --sku Basic' }).run
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: CONFIG_SOLUTION_FILES['app.py'] }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: CONFIG_FILES['k8s/deployment.yaml'].replace('acraksconfigguided.azurecr.io/assistant:starter', 'acraksconfig.azurecr.io/assistant:v1\n          imagePullPolicy: Always') }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksconfig -t assistant:v1 .' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rgaksconfig -n aksconfig --enable-managed-identity --generate-ssh-keys --attach-acr acraksconfig' }).run
  run = act(run, lab, { type: 'command', line: 'az aks get-credentials -g rgaksconfig -n aksconfig' }).run
  for (const path of CONFIG_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  const clusterId = run.sandbox.aksClusters[0].id
  const dependencies = kubernetesDependencies(clusterId, namespace, 'assistant', 'assistant', { sourceSensitive: true })
  const scenario = { kind: 'aks-request', version: 1, target: { clusterId, namespace, serviceName: 'assistant', deploymentName: 'assistant' }, request: { method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: profile } }, requireReplacement: false }
  return { lab: { ...lab, scenarios: { info: scenario }, tasks: [{ id: 'info-task', verification: { scenarioId: 'info', scenarioVersion: 1 }, dependencies, check: () => false }] }, run, clusterId }
}

export function seedConnectivityTest({ namespace = 'assistant', listener = 8080, serviceType = 'ClusterIP', targetPort = 'http' } = {}) {
  let { lab, run, clusterId } = seedFoundation({ namespace })
  lab = { ...lab, capabilities: { ...lab.capabilities, kubernetesConfiguration: true, kubernetesConnectivity: true } }
  const service = run.runtime.kubernetes.clusters[clusterId].resources[`Service/${namespace}/${namespace}`]
  service.spec.type = serviceType
  service.spec.ports[0].targetPort = targetPort
  if (listener !== 8080) {
    for (const pod of Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === namespace)) pod.spec.containers[0].ports[0].containerPort = listener
  }
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  return { lab, run, clusterId, diagnosticPodUid: null, target: { clusterId, namespace, serviceName: namespace } }
}

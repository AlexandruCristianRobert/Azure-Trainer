import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { createBehavioralRun } from '../../src/lib/labEngine/run.js'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../../src/data/templates/aks-python/foundation.js'
import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../src/data/templates/aks-python/configuration.js'
import { kubernetesDependencies } from '../../src/lib/kubernetes/evidence.js'
import { initializeConnectivity, reconcileServices } from '../../src/lib/kubernetes/services.js'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../../src/data/templates/aks-python/integration.js'
import { integrationDependencies } from '../../src/lib/kubernetes/evidence.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../../src/data/templates/aks-python/health.js'
import { HEALTH_FIXTURES } from '../../src/data/fixtures/aks/health.js'
import { probeDependencies } from '../../src/lib/kubernetes/probe-experiments.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getDeploymentPods } from '../../src/lib/kubernetes/reconcile.js'
import { RESOURCE_MANIFEST, RESOURCE_SOLUTION_FILES } from '../../src/data/templates/aks-python/resources.js'
import { inspectResources } from '../../src/lib/kubernetes/resource-inspection.js'

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
      if (lab.scenarios?.[step.scenarioId]?.kind === 'aks-probe') {
        run = act(run, lab, { type: 'aks-probe-start', scenarioId: step.scenarioId }).run
        for (const seconds of step.advances ?? []) run = act(run, lab, { type: 'aks-advance', seconds }).run
      } else run = act(run, lab, { type: 'aks-request', scenarioId: step.scenarioId }).run
    } else if (step.kind === 'advance') {
      run = act(run, lab, { type: 'aks-advance', seconds: step.seconds }).run
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

// This uses the public project/build/apply actions so evidence tests exercise
// the same immutable image capture path available to learners.
export function seedIntegrationTest() {
  const { lab: initialLab, run: initial } = createAksTestRun({
    manifestId: INTEGRATION_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true },
    initialProjectFiles: { ...INTEGRATION_SOLUTION_FILES },
  })
  let run = initial
  let lab = { ...initialLab, capabilities: { ...initialLab.capabilities, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true } }
  run = act(run, lab, { type: 'command', line: 'az group create -n rgaksintegration -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az acr create -g rgaksintegration -n acraksintegration --sku Basic' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.savedFiles['k8s/deployment.yaml'].replace('          ports:', `          imagePullPolicy: Always${String.fromCharCode(10)}          ports:`) }).run
  for (const path of ['k8s/service-internal.yaml', 'k8s/service-external.yaml']) {
    run = act(run, lab, { type: 'save-file', path, text: run.project.savedFiles[path].replace('    - port: 80', '    - port: 80\n      protocol: TCP') }).run
  }
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksintegration -t assistant:integration-v1 .' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rgaksintegration -n aksintegration --enable-managed-identity --generate-ssh-keys --attach-acr acraksintegration' }).run
  run = act(run, lab, { type: 'command', line: 'az aks get-credentials -g rgaksintegration -n aksintegration' }).run
  for (const path of INTEGRATION_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  const clusterId = run.sandbox.aksClusters[0].id
  const target = { clusterId, namespace: 'assistant', serviceName: 'assistant-public', deploymentName: 'assistant' }
  const dependencies = integrationDependencies(target)
  const scenario = (id, integrationProfile, expected) => ({ kind: 'aks-request', version: 1, target,
    request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
    expected, integrationProfile })
  lab = { ...lab, scenarios: {
    'ai-healthy': scenario('ai-healthy', 'healthy', { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } }),
    'ai-transient': scenario('ai-transient', 'embedding-throttle-once', { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } }),
  }, tasks: [
    { id: 'healthy', verification: { scenarioId: 'ai-healthy', scenarioVersion: 1 }, dependencies, check: () => false },
    { id: 'transient', verification: { scenarioId: 'ai-transient', scenarioVersion: 1 }, dependencies, check: () => false },
  ] }
  return { lab, run, clusterId }
}

export function seedHealthTest({ startupSeconds = 24, files = HEALTH_SOLUTION_FILES, probeOverrides = {} } = {}) {
  const projectFiles = structuredClone(files)
  if (Object.keys(probeOverrides).length) {
    const deployment = parseYaml(projectFiles['k8s/deployment.yaml'])
    const container = deployment.spec.template.spec.containers[0]
    const routeByProbe = { startupProbe: 'startup', readinessProbe: 'ready', livenessProbe: 'live' }
    for (const [field, overrides] of Object.entries(probeOverrides)) {
      if (overrides === null) { delete container[field]; continue }
      container[field] ??= { httpGet: { path: `/health/${routeByProbe[field] ?? 'startup'}`, port: 'http' },
        initialDelaySeconds: 0, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 3, successThreshold: 1 }
      if (overrides.httpGet) container[field].httpGet = { ...container[field].httpGet, ...overrides.httpGet }
      for (const [key, value] of Object.entries(overrides)) if (key !== 'httpGet') container[field][key] = value
    }
    projectFiles['k8s/deployment.yaml'] = stringifyYaml(deployment)
  }
  const { lab: initialLab, run: initial } = createAksTestRun({
    manifestId: HEALTH_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesProbes: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true },
    initialProjectFiles: projectFiles,
  })
  const baseLab = { ...initialLab, capabilities: { ...initialLab.capabilities, kubernetesConfiguration: true, kubernetesProbes: true,
    kubernetesConnectivity: true, kubernetesAiIntegration: true },
    healthFixture: { initializationSeconds: startupSeconds } }
  const lab = baseLab
  let run = initial
  run = act(run, lab, { type: 'command', line: 'az group create -n rgaksprobesguided -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az acr create -g rgaksprobesguided -n acraksprobesguided --sku Basic' }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksprobesguided -t assistant:health-v1 .' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rgaksprobesguided -n aksprobesguided --enable-managed-identity --generate-ssh-keys --attach-acr acraksprobesguided' }).run
  run = act(run, lab, { type: 'command', line: 'az aks get-credentials -g rgaksprobesguided -n aksprobesguided' }).run
  for (const path of HEALTH_MANIFEST.kubernetesFiles) {
    try { run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run }
    catch (error) { throw new Error(`Health test seed could not apply ${path}: ${error.message}`) }
  }
  const clusterId = run.sandbox.aksClusters[0].id
  const podUids = getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(pod => pod.metadata.uid).sort()
  const target = { clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-internal' }
  const scenarios = Object.fromEntries(Object.entries(HEALTH_FIXTURES.scenarios).map(([id, fixture]) => {
    const script = structuredClone(fixture)
    const durationSeconds = script.finishAfterStartSeconds ?? (Number.isInteger(script.initializationSeconds) ? script.initializationSeconds + 6 : 60)
    return [id, { kind: 'aks-probe', version: 1, title: id, target: structuredClone(target), durationSeconds, script }]
  }))
  const probeTasks = Object.entries(scenarios).map(([id, scenario]) => ({ id: `probe-${id}`, verification: { scenarioId: id, scenarioVersion: 1 },
    dependencies: probeDependencies(target), check: () => false }))
  const seededLab = { ...baseLab, scenarios: { ...(baseLab.scenarios ?? {}), ...scenarios }, tasks: [...(baseLab.tasks ?? []), ...probeTasks] }
  return { lab: seededLab, run, clusterId, podUids, target }
}

export function seedResourceTest({ resources = null, replicas = 2, hpa = null, units = 20, scratchMiB = 96 } = {}) {
  const { lab: initialLab, run: initial } = createAksTestRun({ manifestId: RESOURCE_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesProbes: true, kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesResources: true }, initialProjectFiles: structuredClone(RESOURCE_SOLUTION_FILES) })
  const lab = { ...initialLab, healthFixture: { initializationSeconds: 6 } }
  let run = initial
  if (resources || replicas !== 2) {
    const deployment = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    deployment.spec.replicas = replicas
    if (resources) deployment.spec.template.spec.containers[0].resources = resources
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
  }
  const workload = run.project.savedFiles['app.py']
    .replace(/WORK_UNITS = \d+/, `WORK_UNITS = ${units}`)
    .replace(/SCRATCH_MIB = \d+/, `SCRATCH_MIB = ${scratchMiB}`)
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: workload }).run
  for (const line of ['az group create -n rgaksresources -l eastus', 'az acr create -g rgaksresources -n acraksprobesguided --sku Basic', 'az acr build --registry acraksprobesguided -t assistant:health-v1 .', 'az aks create -g rgaksresources -n aksresources --enable-managed-identity --generate-ssh-keys --attach-acr acraksprobesguided', 'az aks get-credentials -g rgaksresources -n aksresources', ...RESOURCE_MANIFEST.kubernetesFiles.filter(path => path !== 'k8s/hpa.yaml').map(path => `kubectl apply -f ${path}`)]) run = act(run, lab, { type: 'command', line }).run
  const clusterId = run.sandbox.aksClusters[0].id; const target = { clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-internal' }
  lab.scenarios = { ...(lab.scenarios ?? {}), 'test-local-work': { kind: 'aks-resource-profile', version: 1,
    target: { clusterId, namespace: 'assistant', deploymentName: 'assistant' }, requiredReadyReplicas: replicas },
  'test-ai-wait': { kind: 'aks-resource-profile', version: 1,
    target: { clusterId, namespace: 'assistant', deploymentName: 'assistant' }, requiredReadyReplicas: replicas } }
  run = initializeConnectivity(run, clusterId)
  run = reconcileServices(run, clusterId)
  if (hpa) {
    run = act(run, lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
  }
  return { lab, run, clusterId, target, podUids: getDeploymentPods(run, clusterId, target.namespace, target.deploymentName).map(pod => pod.metadata.uid).sort() }
}

export function advanceResources(run, lab, seconds) { return act(run, lab, { type: 'aks-advance', seconds }).run }
export function resourceView(run, target) { return inspectResources(run, target) }

export function advanceHealth(run, lab, seconds) {
  return act(run, lab, { type: 'aks-advance', seconds }).run
}

export function healthContainer(run, clusterId, podUid) {
  const value = run.runtime.kubernetes.clusters[clusterId]?.health?.containers?.[podUid]
  return value === undefined ? undefined : structuredClone(value)
}

export function startHealthFault(run, clusterId, podUid, fault, enabled = true) {
  if (!['admissionClosed', 'hung'].includes(fault)) throw new Error(`Unknown health fault: ${fault}`)
  const next = structuredClone(run)
  const container = next.runtime.kubernetes.clusters[clusterId]?.health?.containers?.[podUid]
  if (!container) throw new Error(`No health container state for Pod ${podUid}`)
  container.localFaults[fault] = enabled
  return next
}

export function seedConnectivityTest({ profile = 'training', namespace = 'assistant', listener = 8080, serviceType = 'ClusterIP', targetPort = 'http' } = {}) {
  let { lab, run, clusterId } = seedConfiguredAssistant({ namespace, profile })
  run = reconcileServices(initializeConnectivity(run, clusterId), clusterId)
  lab = { ...lab, capabilities: { ...lab.capabilities, kubernetesConnectivity: true }, scenarios: { 'network-internal': { kind: 'aks-request', version: 1,
    target: { clusterId, namespace, serviceName: 'assistant-internal', deploymentName: 'assistant' }, request: { method: 'GET', path: '/api/info' },
    expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: profile } }, requireReplacement: false } } }
  if (listener !== 8080) {
    run = act(run, lab, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'].replace('PORT = 8080', `PORT = ${listener}`) }).run
    run = act(run, lab, { type: 'save-file', path: 'Dockerfile', text: run.project.savedFiles.Dockerfile.replace('EXPOSE 8080', `EXPOSE ${listener}`) }).run
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.savedFiles['k8s/deployment.yaml'].replace('containerPort: 8080', `containerPort: ${listener}`) }).run
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksconfig -t assistant:v1 .' }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  }
  run = act(run, lab, { type: 'command', line: `kubectl delete service assistant -n ${namespace}` }).run
  const service = run.project.savedFiles['k8s/service.yaml'].replace('name: assistant\n', 'name: assistant-internal\n').replace('type: LoadBalancer', `type: ${serviceType}`).replace('targetPort: http', `targetPort: ${targetPort}`)
  run = act(run, lab, { type: 'save-file', path: 'k8s/service.yaml', text: service }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }).run
  const state = run.runtime.kubernetes.clusters[clusterId]
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  const diagnosticPodUid = `diagnostic/${clusterId}`
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid: diagnosticPodUid, resourceVersion: '1', labels: { app: 'diagnostics' } },
    spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [diagnosticPodUid]
  run = reconcileServices(run, clusterId)
  return { lab, run, clusterId, diagnosticPodUid, target: { clusterId, namespace, serviceName: 'assistant-internal' } }
}

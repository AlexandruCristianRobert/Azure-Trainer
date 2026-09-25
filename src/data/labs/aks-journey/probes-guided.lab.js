import { parsePythonProject } from '../../../lib/project/python.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { probeScenario, probeTask, requestTask, probeReceiptPassed } from './probe-helpers.js'
import { seedProbesGuided, PROBES_GUIDED_CLUSTER, PROBES_GUIDED_GROUP, PROBES_GUIDED_IMAGE, PROBES_GUIDED_REGISTRY } from './probe-seeds.js'
import { HEALTH_FILES, HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../../templates/aks-python/health.js'
import { HEALTH_FIXTURES } from '../../fixtures/aks/health.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${PROBES_GUIDED_GROUP}/providers/Microsoft.ContainerService/managedClusters/${PROBES_GUIDED_CLUSTER}`
const namespace = 'assistant'
const target = { clusterId, namespace, deploymentName: 'assistant', serviceName: 'assistant-internal' }
const finalTarget = { ...target, serviceName: 'assistant-public' }
const file = path => ({ kind: 'file', path, content: HEALTH_SOLUTION_FILES[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const experiment = (scenarioId, seconds) => [scenario(scenarioId), { kind: 'advance', seconds }]
const starterApp = HEALTH_FILES['app.py']
  .replace('def startup():\n    return {"status": 503', 'def startup():\n    return {"status": 200')
  .replace('def ready():\n    return {"status": 503', 'def ready():\n    return {"status": 200')

function appHealth(context) {
  const parsed = parsePythonProject(context.project.savedFiles, HEALTH_MANIFEST)
  if (parsed.diagnostics.length || !parsed.appSpec?.health || !parsed.appSpec?.integration) return null
  return parsed.appSpec.health
}

function expressionValue(expression, signals) {
  if (expression?.kind === 'constant') return expression.value
  if (expression?.kind === 'signal') return signals[expression.name] === true
  if (expression?.kind === 'not') return !expressionValue(expression.operand, signals)
  if (expression?.kind === 'and') return expression.operands.every(item => expressionValue(item, signals))
  if (expression?.kind === 'or') return expression.operands.some(item => expressionValue(item, signals))
  if (expression?.kind === 'conditional') return expressionValue(expression.condition, signals) ? expression.then : expression.else
  return undefined
}

function correctHealthFunctions(context) {
  const endpoints = appHealth(context)?.endpoints
  if (!endpoints || endpoints.length !== 3) return false
  const expected = {
    '/health/startup': signals => signals.initialized,
    '/health/ready': signals => signals.initialized && signals.accepting_requests,
    '/health/live': () => true,
  }
  return Object.entries(expected).every(([path, evaluate]) => {
    const endpoint = endpoints.find(item => item.path === path)
    if (!endpoint) return false
    return [false, true].every(initialized => [false, true].every(accepting_requests =>
      [false, true].every(postgres_available => [false, true].every(ai_available => {
        const signals = { initialized, accepting_requests, postgres_available, ai_available }
        const want = evaluate(signals) ? 200 : 503
        return expressionValue(endpoint.statusExpression, signals) === want
      }))))
  })
}

function healthImageIsCurrent(context) {
  const artifactId = context.artifacts.publishedTags?.[PROBES_GUIDED_IMAGE]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  return !!artifact && artifact.image?.tag === 'health-v1'
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, HEALTH_MANIFEST))
}

function currentDeployment(context) {
  return context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.['Deployment/assistant/assistant']
}

function sourceAndDeploymentCurrent(context) {
  const health = appHealth(context)
  const deployment = currentDeployment(context)
  const manifest = parseKubernetesYaml(context.project.savedFiles['k8s/deployment.yaml'], 'k8s/deployment.yaml')
  const artifactId = context.artifacts.publishedTags?.[PROBES_GUIDED_IMAGE]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const container = deployment?.spec?.template?.spec?.containers?.[0]
  const saved = structuredClone(manifest.documents?.[0])
  for (const savedContainer of saved?.spec?.template?.spec?.containers ?? []) {
    for (const name of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
      if (savedContainer[name]?.httpGet) savedContainer[name].httpGet.scheme ??= 'HTTP'
    }
  }
  const validProbe = (actual, path, { periodSeconds, failureThreshold }) => actual?.httpGet?.path === path
    && actual.httpGet.port === 'http' && actual.initialDelaySeconds === 0 && actual.periodSeconds === periodSeconds
    && actual.timeoutSeconds === 1 && actual.failureThreshold === failureThreshold && actual.successThreshold === 1
  const supportedProbeSet = container?.startupProbe && container?.readinessProbe && container?.livenessProbe
    && validProbe(container.startupProbe, '/health/startup', { periodSeconds: 5, failureThreshold: 6 })
    && validProbe(container.readinessProbe, '/health/ready', { periodSeconds: 2, failureThreshold: 1 })
    && validProbe(container.livenessProbe, '/health/live', { periodSeconds: 5, failureThreshold: 2 })
  return correctHealthFunctions(context) && healthImageIsCurrent(context) && !!artifact && !!health
    && artifact.appSpec?.health?.helperDigest === health.helperDigest
    && container?.image === PROBES_GUIDED_IMAGE && deployment.spec.replicas === 2
    && deployment.spec.template.spec.terminationGracePeriodSeconds === 1 && supportedProbeSet
    && canonicalize(deployment.spec.template.spec) === canonicalize(saved?.spec?.template?.spec)
    && getDeploymentPods(context.run ?? context, clusterId, namespace, 'assistant').length === 2
}

function healthyCurrentPods(context) {
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const pods = getDeploymentPods(context.run ?? context, clusterId, namespace, 'assistant')
  const artifactId = context.artifacts.publishedTags?.[PROBES_GUIDED_IMAGE]
  return sourceAndDeploymentCurrent(context) && pods.length === 2 && pods.every(pod =>
    pod.status?.phase === 'Running' && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
      && state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}

function finalAnswer(context) {
  const evidenceId = context.evidence.currentEvidenceByTask?.['final-answer']
  const record = evidenceId && context.evidence.experimentsById?.[evidenceId]
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const deployment = currentDeployment(context)
  const container = deployment?.spec?.template?.spec?.containers?.[0]
  return healthyCurrentPods(context) && record?.completed === true && record.outcome === 'passed'
    && record.scenarioId === 'guided-probe-final' && record.measurements?.body?.sources?.includes('training-backups')
    && record.measurements?.body?.answer === 'Training backups are kept for 30 days.'
    && container?.image === PROBES_GUIDED_IMAGE && ['startupProbe', 'readinessProbe', 'livenessProbe'].every(name => !!container[name])
    && state.health.receipts.some(item => item.scenarioId === 'guided-probe-hang' && item.outcome === 'passed')
}

const probeTaskDef = (id, stageId, text, explanation, hints, examNote, scenarioId, check, solution) => probeTask({
  id, stageId, text, explanation, hints, examNote, scenarioId, check, solution, target,
})

function inspectPodAction(run, _lab, task, resolver) {
  if (task.id !== 'automatic-recovery') throw new Error('Current Pod inspection is only available in the recovery Solution.')
  const pods = getDeploymentPods(run, clusterId, namespace, 'assistant')
  const completedHang = run.runtime.kubernetes?.clusters?.[clusterId]?.health?.receipts?.findLast(item =>
    item.scenarioId === 'guided-probe-hang' && item.status === 'completed' && item.outcome === 'passed')
  const restartedUid = completedHang?.summary?.restartReceipts?.[0]?.podUid
  const state = run.runtime.kubernetes?.clusters?.[clusterId]
  const podWithPrevious = pods.find(item => state.health.containers[item.metadata.uid]?.previous)
  const pod = resolver === 'previous-current-pod-logs'
    ? podWithPrevious ?? (restartedUid ? pods.find(item => item.metadata.uid === restartedUid) : null)
    : pods[0]
  if (!pod) throw new Error('No current assistant Pod is available to inspect.')
  const line = resolver === 'describe-current-pod'
    ? `kubectl describe pod ${pod.metadata.name} -n ${namespace}`
    : resolver === 'previous-current-pod-logs' ? `kubectl logs ${pod.metadata.name} -n ${namespace} --previous` : null
  if (!line) throw new Error('Unknown current Pod inspection command.')
  return { type: 'command', line }
}

export const aksProbesGuidedLab = {
  id: 'aks-probes-guided', title: 'Protect and recover an AKS service with probes', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 45,
  brief: 'Add meaningful startup, readiness, and liveness checks to the supplied Python knowledge assistant. Prove that startup is protected, unhealthy Pods leave Service traffic, and a hung process restarts inside its existing Pod.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 13, labMode: 'guided',
  manifestId: HEALTH_MANIFEST.id,
  healthFixture: { initializationSeconds: HEALTH_FIXTURES.initializationSeconds },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true },
  solutionActionResolvers: { 'describe-current-pod': inspectPodAction, 'previous-current-pod-logs': inspectPodAction },
  initialProjectFiles: { ...HEALTH_FILES, 'app.py': starterApp }, solutionFiles: HEALTH_SOLUTION_FILES, initializeSimulation: seedProbesGuided,
  stages: [
    { id: 'implement', title: 'Implement application health', taskIds: ['health-source'] },
    { id: 'configure', title: 'Configure Kubernetes probes', taskIds: ['probe-manifest'] },
    { id: 'prove', title: 'Observe startup, traffic, and recovery', taskIds: ['protected-startup', 'traffic-withdrawal', 'automatic-recovery'] },
    { id: 'verify', title: 'Verify the assistant after recovery', taskIds: ['final-answer'] },
  ],
  scenarios: {
    'guided-probe-startup': probeScenario('guided-probe-startup', target, HEALTH_FIXTURES.scenarios.coldStartup, 30),
    'guided-probe-readiness': probeScenario('guided-probe-readiness', target, HEALTH_FIXTURES.scenarios.temporaryAdmissionClosure, 60),
    'guided-probe-hang': probeScenario('guided-probe-hang', target, HEALTH_FIXTURES.scenarios.processHang, 150),
    'guided-probe-final': { kind: 'aks-request', version: 1, target: finalTarget,
      connectivity: { origin: { kind: 'external' }, service: { namespace, name: 'assistant-public' }, port: 80 },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
      expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } },
      integrationProfile: 'healthy' },
  },
  tasks: [
    probeTask({ id: 'health-source', stageId: 'implement', text: 'Implement `startup()`, `ready()`, and `live()` in `app.py`. Startup must reflect initialization, readiness must also reflect admission, and liveness must report that the local process can answer. Save the complete integration source and build `assistant:health-v1`.',
      explanation: 'The adapter exposes local fixture signals to these handlers. Startup protects initialization, readiness controls Service eligibility, and liveness asks whether the process responds; health checks should not depend on an AI call or database query. The existing question-to-answer flow remains part of the source and image.',
      hints: ['Use `initialized()` for startup, and combine it with `accepting_requests()` for readiness.', 'Keep liveness independent of remote services. Then save `app.py` and build `assistant:health-v1` from the saved project.'],
      examNote: 'A useful health endpoint reports the state it represents. A constant success can hide startup or admission failures.', check: context => correctHealthFunctions(context) && healthImageIsCurrent(context),
      solution: { steps: [file('app.py'), ...commands(`az acr build -r ${PROBES_GUIDED_REGISTRY} -t assistant:health-v1 .`)] } }),
    probeTask({ id: 'probe-manifest', stageId: 'configure', text: 'Add startup, readiness, and liveness HTTP probes to the complete two-replica Deployment. Use the named `http` port, `/health/startup`, `/health/ready`, and `/health/live`, appropriate supported thresholds, a one-second termination grace, and the current `assistant:health-v1` image. Save and apply `k8s/deployment.yaml`.',
      explanation: 'Kubelet probes the Pod directly, even when it is not a Service endpoint. Startup gates readiness and liveness until it succeeds; readiness withdraws traffic without restarting a container; liveness failure restarts the container in its existing Pod. The one-second grace is only a short deterministic Lab setting.',
      hints: ['Edit the full Deployment from the solution so replicas, configuration references, and environment stay intact.', 'Use `kubectl apply` after saving. A saved manifest and a built image are separate from the running Deployment and its Pods.'],
      examNote: 'Probe status is observed behavior. A Running Pod can be unready, and a readiness failure does not stop kubelet from probing the Pod.', check: sourceAndDeploymentCurrent,
      solution: { steps: [file('k8s/deployment.yaml'), ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl get pods -n assistant', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-internal -o yaml')] } }),
    probeTaskDef('protected-startup', 'prove', 'Run `guided-probe-startup`. Verify both Pods stay out of Service traffic during the 24-second initialization, no readiness or liveness probes run before startup succeeds, and both Pods become Ready without restarting.',
      'The startup experiment recreates the Pods so the 24-second initialization is measured from a cold container start. The startup probe must succeed before readiness and liveness begin.',
      ['Start the named cold-start experiment after the current image and Deployment are applied.', 'Advance the experiment to completion, then inspect its measured probe events and Pod status.'],
      'Startup protects slow initialization from premature liveness restarts and traffic.', 'guided-probe-startup',
      context => probeReceiptPassed(context, 'protected-startup', 'guided-probe-startup') && healthyCurrentPods(context),
      { steps: [...experiment('guided-probe-startup', 30), { kind: 'inspect' }] }),
    probeTaskDef('traffic-withdrawal', 'prove', 'Run `guided-probe-readiness`. Verify the temporarily non-accepting Pod is removed from Service routing, the other Pod serves requests, and the endpoint returns after recovery without a container restart.',
      'Readiness follows the local admission signal. A failed readiness check removes the Pod from Service traffic but leaves its process running and available for later checks.',
      ['Start the named readiness experiment and inspect the request samples at seconds 9 and 25.', 'Compare ready Service endpoints and restart counts while admission closes and reopens.'],
      'Readiness changes Service eligibility; it does not restart a container.', 'guided-probe-readiness',
      context => probeReceiptPassed(context, 'traffic-withdrawal', 'guided-probe-readiness') && healthyCurrentPods(context),
      { steps: [...experiment('guided-probe-readiness', 60), { kind: 'inspect' }] }),
    probeTaskDef('automatic-recovery', 'prove', 'Run `guided-probe-hang`. Verify requests time out while the process is hung, liveness restarts the container, the Pod UID stays the same, startup gates it again, and the assistant recovers.',
      'A process hang prevents every HTTP handler from responding, including a hardcoded liveness success. Liveness restarts the container in place; the Pod keeps its UID and IP while startup gates the new container.',
      ['Start the hang experiment and inspect its request timeouts and restart receipt.', 'Compare the container ID and restart count with the unchanged Pod UID, then inspect current and previous logs.'],
      'A container restart and a Pod replacement have different identities and recovery behavior.', 'guided-probe-hang',
      context => probeReceiptPassed(context, 'automatic-recovery', 'guided-probe-hang') && healthyCurrentPods(context),
      { steps: [...experiment('guided-probe-hang', 150), ...commands('kubectl get pods -n assistant'),
        { kind: 'command', resolver: 'describe-current-pod' }, { kind: 'command', resolver: 'previous-current-pod-logs' }, { kind: 'inspect' }] }),
    requestTask({ id: 'final-answer', stageId: 'verify', text: 'After recovery, verify the current external assistant returns the prepared backups answer with the `training-backups` source from both Ready Pods.',
      explanation: 'The final request proves the recovered Deployment still runs the current built source and applied probes while preserving the existing AI integration.',
      hints: ['Use the named final question through the external assistant Service.', 'Inspect the request evidence and confirm both current Pods are Ready and the hang experiment passed.'],
      examNote: 'A health-probe change must preserve normal application behavior after recovery.', check: finalAnswer,
      solution: { steps: [...commands('kubectl get pods -n assistant', 'kubectl get endpointslices -n assistant -l kubernetes.io/service-name=assistant-public -o yaml'), scenario('guided-probe-final'), { kind: 'inspect' }] },
      scenarioId: 'guided-probe-final', target: finalTarget }),
  ],
}

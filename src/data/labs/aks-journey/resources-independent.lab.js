import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { inspectResources } from '../../../lib/kubernetes/resource-inspection.js'
import { normalizeContainerResources } from '../../../lib/kubernetes/resource-schema.js'
import { integrationDependencies, resourceDependencies } from '../../../lib/kubernetes/evidence.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { RESOURCE_INDEPENDENT_SOLUTION_FILES, RESOURCE_MANIFEST } from '../../templates/aks-python/resources.js'
import { RESOURCES_INDEPENDENT_CLUSTER, RESOURCES_INDEPENDENT_FILES, RESOURCES_INDEPENDENT_GROUP, RESOURCES_INDEPENDENT_IMAGE, RESOURCES_INDEPENDENT_REGISTRY, seedResourcesIndependent } from './resource-independent-seeds.js'
import { resourceReceipt, resourceScenario, resourceTask } from './resource-helpers.js'

export const RESOURCES_INDEPENDENT_LAB_ID = 'aks-resources-independent'
export const RESOURCES_INDEPENDENT_CLUSTER_ID = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${RESOURCES_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${RESOURCES_INDEPENDENT_CLUSTER}`
const namespace = 'assistant'
const target = { clusterId: RESOURCES_INDEPENDENT_CLUSTER_ID, namespace, deploymentName: 'assistant' }
const requestTarget = { ...target, serviceName: 'assistant-public' }
const cycleDependencies = resourceDependencies(target, { historical: true, profileId: 'independent-cycle' })
const aiDependencies = resourceDependencies(target, { historical: true, profileId: 'ai-wait' })
const deploymentSolution = RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_INDEPENDENT_IMAGE)
const deploymentHpa = deploymentSolution.replace(/^  replicas: \d+\n/m, '')
const hpaSolution = RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/hpa.yaml']
const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const advance = seconds => ({ kind: 'advance', seconds })
const start = scenarioId => ({ kind: 'scenario', scenarioId })
const live = context => context.runtime.kubernetes?.clusters?.[target.clusterId]
const deployment = context => live(context)?.resources?.['Deployment/assistant/assistant']
const pods = context => getDeploymentPods(context.run ?? context, target.clusterId, namespace, 'assistant')
const savedTarget = (context, path, kind, name) => parseKubernetesYaml(context.project.savedFiles[path] ?? '', path).documents
  .find(doc => doc?.kind === kind && doc.metadata?.namespace === namespace && doc.metadata?.name === name) ?? null
const savedDeployment = context => savedTarget(context, 'k8s/deployment.yaml', 'Deployment', 'assistant')
const savedHpa = context => savedTarget(context, 'k8s/hpa.yaml', 'HorizontalPodAutoscaler', 'assistant-cpu')
const hpa = context => Object.values(live(context)?.resources ?? {}).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.namespace === namespace && item.metadata.name === 'assistant-cpu')
const record = (context, id) => { const evidenceId = context.evidence.currentEvidenceByTask?.[id]; return evidenceId ? context.evidence.experimentsById?.[evidenceId] : null }
const sourceCurrent = context => {
  const app = parsePythonProject(context.project.savedFiles, RESOURCE_MANIFEST)
  const artifactId = context.artifacts.publishedTags?.[RESOURCES_INDEPENDENT_IMAGE]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const snapshot = artifactId && context.artifacts.sourceSnapshotsByHash?.[artifact?.sourceHash]?.files
  return !app.diagnostics.length && app.appSpec?.workload?.operation === 'process_batch' && app.appSpec.workload.units === 30 && app.appSpec.workload.scratchMiB === 160
    && deployment(context)?.spec?.template?.spec?.containers?.[0]?.image === RESOURCES_INDEPENDENT_IMAGE && artifact?.image?.tag === 'workload-v1'
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, RESOURCE_MANIFEST)) && snapshot?.['app.py'] === context.project.savedFiles['app.py']
}
const resourceDesign = context => {
  const liveResources = normalizeContainerResources(deployment(context)?.spec?.template?.spec?.containers?.[0]?.resources ?? {})
  const savedResources = normalizeContainerResources(savedDeployment(context)?.spec?.template?.spec?.containers?.[0]?.resources ?? {})
  const view = inspectResources(context.run ?? context, target)
  const max = hpa(context)?.spec?.maxReplicas ?? 6
  const authored = resources => [resources.authored.cpuRequest, resources.authored.cpuLimit, resources.authored.memoryRequest, resources.authored.memoryLimit].every(value => value !== null)
  const perNode = Object.values(view.nodes).every(node => Math.ceil(max / 2) * liveResources.effective.cpuRequestM <= node.allocatableCpuM - node.fixedCpuM
    && Math.ceil(max / 2) * liveResources.effective.memoryRequestBytes <= node.allocatableMemoryBytes - node.fixedMemoryBytes)
  return sourceCurrent(context) && !liveResources.diagnostics.length && !savedResources.diagnostics.length && authored(liveResources) && authored(savedResources)
    && [liveResources.authored.cpuRequest, liveResources.authored.cpuLimit, liveResources.authored.memoryRequest, liveResources.authored.memoryLimit].every(value => value !== null)
    && liveResources.effective.cpuRequestM > 0 && liveResources.effective.cpuLimitM >= liveResources.effective.cpuRequestM
    && liveResources.effective.memoryRequestBytes > 0 && liveResources.effective.memoryLimitBytes >= 256 * 1024 * 1024 && liveResources.effective.memoryLimitBytes >= liveResources.effective.memoryRequestBytes
    && savedResources.effective.cpuRequestM === liveResources.effective.cpuRequestM && savedResources.effective.cpuLimitM === liveResources.effective.cpuLimitM
    && savedResources.effective.memoryRequestBytes === liveResources.effective.memoryRequestBytes && savedResources.effective.memoryLimitBytes === liveResources.effective.memoryLimitBytes
    && Object.values(view.nodes).every(node => node.remainingCpuM >= 0 && node.remainingMemoryBytes >= 0) && perNode
}
const hpaDesign = context => {
  const policy = hpa(context); const saved = savedDeployment(context); const authored = savedHpa(context)
  return resourceDesign(context) && policy?.spec?.scaleTargetRef?.name === 'assistant' && policy.spec.minReplicas === 2
    && policy.spec.maxReplicas >= 4 && policy.spec.maxReplicas <= 6 && policy.spec.metrics?.[0]?.resource?.target?.averageUtilization >= 50
    && policy.spec.metrics?.[0]?.resource?.target?.averageUtilization <= 70 && policy.spec.behavior?.scaleDown?.stabilizationWindowSeconds >= 30
    && policy.spec.behavior?.scaleDown?.stabilizationWindowSeconds <= 120 && authored?.kind === 'HorizontalPodAutoscaler'
    && authored.metadata?.name === 'assistant-cpu' && authored.metadata?.namespace === namespace && canonicalize(authored.spec) === canonicalize(policy.spec)
    && !Object.hasOwn(saved?.spec ?? {}, 'replicas')
    && live(context)?.applyOwnership?.['Deployment/assistant/assistant']?.replicas === false
}
const cycle = context => {
  const measures = resourceReceipt(context, 'steady-burst-cooldown', 'independent-resource-cycle', cycleDependencies)
  const experiment = record(context, 'steady-burst-cooldown')?.measurements
  const scaled = (measures?.scaleReceipts ?? []).some(item => item.cause === 'hpa' && item.to >= 4)
  const down = (measures?.scaleReceipts ?? []).some(item => item.cause === 'hpa' && item.to === 2 && item.from > item.to)
  const at90 = experiment?.observations?.find(item => item.second === 90)
  const at150 = experiment?.observations?.find(item => item.second === 150)
  return hpaDesign(context) && !!measures && scaled && down && measures.totals?.remaining === 0 && measures.totals?.completed === measures.totals?.arrivals
    && at90?.completed >= 32 - 1e-9 && at150?.remaining === 0 && measures.observations?.at(-1)?.readyReplicas === 2
}
const placement = context => {
  const measures = resourceReceipt(context, 'steady-burst-cooldown', 'independent-resource-cycle', cycleDependencies)
  return cycle(context) && !!measures && measures.observations?.every(observation => observation.pods.every(pod => pod.restartCount === 0
    && (pod.phase === 'Pending' ? pod.placementAgeSeconds <= 30 && !pod.nodeName : !!pod.nodeName)))
}
const aiWait = context => {
  const measures = resourceReceipt(context, 'cpu-not-wait', 'independent-resource-ai-wait', aiDependencies)
  return placement(context) && !!measures && measures.samples?.length >= 2 && measures.samples.every(sample => sample.integrationTrace?.profileId === 'answer-wait-150ms' && sample.body?.answer === 'Training backups are kept for 30 days.')
    && !(measures.scaleReceipts ?? []).some(item => item.cause === 'hpa' && item.to > item.from)
}
const final = context => {
  const evidence = record(context, 'final-answer')
  return aiWait(context) && evidence?.completed && evidence.outcome === 'passed' && evidence.scenarioId === 'independent-resource-final'
    && evidence.measurements?.body?.answer === 'Training backups are kept for 30 days.' && evidence.measurements?.body?.sources?.includes('training-backups')
    && pods(context).length === 2 && pods(context).every(pod => pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True'))
}
const integrationScenario = { kind: 'aks-request', version: 1, target: requestTarget, connectivity: { origin: { kind: 'external' }, service: { namespace, name: 'assistant-public' }, port: 80 }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } }, integrationProfile: 'healthy' }

export const aksResourcesIndependentLab = {
  id: RESOURCES_INDEPENDENT_LAB_ID, title: 'Meet an AKS workload sizing brief', status: 'available', minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 18, labMode: 'independent', skillAreaId: 'containers', service: 'aks', manifestId: RESOURCE_MANIFEST.id,
  brief: 'Size the fixed 30-unit, 256Mi assistant workload for two fixed nodes. Choose explicit requests and limits, then a CPU HPA with min 2, max 4–6, target 50–70%, and 30–120 seconds of scale-down stabilization. During the supplied cycle, prove throughput, backlog conservation, four ready burst replicas, no OOM, and return to two; HPA maximum is not node capacity.',
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 360 }, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true },
  initialProjectFiles: RESOURCES_INDEPENDENT_FILES, solutionFiles: RESOURCE_INDEPENDENT_SOLUTION_FILES, initializeSimulation: seedResourcesIndependent,
  stages: [{ id: 'design', title: 'Size the fixed workload', taskIds: ['resource-design', 'hpa-design'] }, { id: 'measure', title: 'Measure throughput and placement', taskIds: ['steady-burst-cooldown', 'memory-and-placement'] }, { id: 'verify', title: 'Verify CPU and AI behavior', taskIds: ['cpu-not-wait', 'final-answer'] }],
  scenarios: { 'independent-resource-cycle': resourceScenario('independent-cycle', target, 2), 'independent-resource-ai-wait': resourceScenario('ai-wait', target, 2), 'independent-resource-final': integrationScenario },
  tasks: [
    resourceTask({ id: 'resource-design', stageId: 'design', target, text: 'Build and deploy the inspectable 30-unit / 160Mi scratch source as assistant:workload-v1. Choose explicit positive CPU and memory requests and limits for the 256Mi peak. Both steady state and the chosen maximum replica allocation must fit the two fixed nodes.', explanation: 'Requests reserve one-node capacity; limits constrain a running Pod. HPA max creates no node capacity. The reference 300m/256Mi requests and 600m/384Mi limits fit, but any supported sizing must meet the measured workload.', hints: ['Keep process_batch with 30 units and 160Mi scratch.', 'Use get nodes and top after applying to inspect reservations and demand.'], examNote: 'Reducing the declared workload cannot pass this fixed brief.', check: resourceDesign, solution: { steps: [file('app.py', RESOURCE_INDEPENDENT_SOLUTION_FILES['app.py']), file('k8s/deployment.yaml', deploymentSolution), command(`az acr build -r ${RESOURCES_INDEPENDENT_REGISTRY} -t assistant:workload-v1 .`), command('kubectl apply -f k8s/deployment.yaml'), advance(30), command('kubectl get nodes'), command('kubectl top pods -n assistant')] } }),
    resourceTask({ id: 'hpa-design', stageId: 'design', target, text: 'Relinquish saved Deployment replica ownership and apply a CPU HPA: min 2, max 4–6, target 50–70%, and 30–120 seconds of scale-down stabilization.', explanation: 'CPU utilization divides delivered CPU by requests. A fixed replica count cannot substitute for controller decisions or stabilization history.', hints: ['Remove spec.replicas before applying the HPA.', 'Use autoscaling/v2 Resource CPU Utilization.'], examNote: 'A positive explicit request is required for a CPU-utilization denominator.', check: hpaDesign, solution: { steps: [file('k8s/deployment.yaml', deploymentHpa), file('k8s/hpa.yaml', hpaSolution), command('kubectl apply -f k8s/deployment.yaml'), command('kubectl apply -f k8s/hpa.yaml'), advance(30), command('kubectl describe hpa assistant-cpu -n assistant')] } }),
    resourceTask({ id: 'steady-burst-cooldown', stageId: 'measure', scenarioId: 'independent-resource-cycle', target, dependencies: cycleDependencies, text: 'Run independent-cycle. Complete steady and burst work, reach at least four ready replicas, deliver 32 req/s without increasing backlog by phase 90, drain it by phase 150, and return to two by phase 300.', explanation: 'The receipt records actual metrics, controller scale receipts, readiness, and conserved arrivals/completions. Replica count alone does not prove throughput or cooldown.', hints: ['Wait for two Ready Pods and complete metric windows before starting.', 'Advance the public clock through warmup and the full 300-second cycle.'], examNote: 'Manual scaling during this automated experiment cancels the proof.', check: cycle, solution: { steps: [start('independent-resource-cycle'), advance(30), advance(300), command('kubectl get pods -n assistant -o wide'), command('kubectl describe hpa assistant-cpu -n assistant')] } }),
    resourceTask({ id: 'memory-and-placement', stageId: 'measure', target, text: 'Inspect the completed cycle receipt and current resource view. Every required Pod must have scheduled within 30 seconds, remain under its memory limit, and avoid OOM/restarts.', explanation: 'This task consumes the owned current cycle receipt; it does not run another scenario or accept a manually-set completion flag.', hints: ['Inspect nodes, Pods, and the cycle receipt.', 'Check node assignment and previous container state.'], examNote: 'A Pod must fit one node; aggregate free capacity is not a placement guarantee.', check: placement, solution: { steps: [command('kubectl get nodes'), command('kubectl get pods -n assistant -o wide'), { kind: 'inspect', instruction: 'Inspect the owned independent-cycle receipt for assignments, OOM absence, and work conservation.' }] } }),
    resourceTask({ id: 'cpu-not-wait', stageId: 'verify', scenarioId: 'independent-resource-ai-wait', target, dependencies: aiDependencies, text: 'Run the supplied AI wait profile after scale-in. Verify healthy answers while 150ms dependency waiting stays out of local CPU demand and does not scale above minimum.', explanation: 'This deterministic fixture isolates local CPU from dependency wait; it is not a remote-service concurrency model.', hints: ['Start only after the cycle has returned to two Ready Pods.', 'Inspect top and the sampled healthy answer.'], examNote: 'CPU HPA does not use dependency wait milliseconds as utilization.', check: aiWait, solution: { steps: [start('independent-resource-ai-wait'), advance(90), command('kubectl top pods -n assistant'), { kind: 'inspect', instruction: 'Inspect low local CPU and correct AI wait samples.' }] } }),
    resourceTask({ id: 'final-answer', stageId: 'verify', scenarioId: 'independent-resource-final', target: requestTarget, dependencies: { ...resourceDependencies(target), ...integrationDependencies(requestTarget) }, text: 'After the workload returns to two Ready Pods, send the supplied backups question through the public assistant and inspect the fresh retrieval trace.', explanation: 'The final request rechecks the current captured artifact, routing, configuration, resources, and answer after all workload evidence.', hints: ['Confirm two Ready Pods before sending.', 'Use the Healthy question control and inspect training-backups.'], examNote: 'A historical answer cannot prove the current live state.', check: final, solution: { steps: [command('kubectl get pods -n assistant'), start('independent-resource-final'), { kind: 'inspect', instruction: 'Inspect the Healthy training-backups response.' }] } }),
  ],
}

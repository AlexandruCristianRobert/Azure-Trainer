import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { inspectResources } from '../../../lib/kubernetes/resource-inspection.js'
import { normalizeContainerResources } from '../../../lib/kubernetes/resource-schema.js'
import { integrationDependencies, resourceDependencies } from '../../../lib/kubernetes/evidence.js'
import { RESOURCE_MANIFEST, RESOURCE_FILES, RESOURCE_SOLUTION_FILES } from '../../templates/aks-python/resources.js'
import { RESOURCES_GUIDED_FILES, RESOURCES_GUIDED_GROUP, RESOURCES_GUIDED_IMAGE, RESOURCES_GUIDED_CLUSTER, RESOURCES_GUIDED_REGISTRY, seedResourcesGuided } from './resource-seeds.js'
import { resourceReceipt, resourceScenario, resourceTask } from './resource-helpers.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${RESOURCES_GUIDED_GROUP}/providers/Microsoft.ContainerService/managedClusters/${RESOURCES_GUIDED_CLUSTER}`
const namespace = 'assistant'
const target = { clusterId, namespace, deploymentName: 'assistant' }
const requestTarget = { ...target, serviceName: 'assistant-public' }
const manualDependencies = resourceDependencies(target, { historical: true, profileId: 'manual-work' })
const cycleDependencies = resourceDependencies(target, { historical: true, profileId: 'guided-cycle' })
const aiWaitDependencies = resourceDependencies(target, { historical: true, profileId: 'ai-wait' })
const deploymentBase = RESOURCE_SOLUTION_FILES['k8s/deployment.yaml'].replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_GUIDED_IMAGE)
const deploymentSized = deploymentBase
const deploymentSourceOnly = RESOURCE_FILES['k8s/deployment.yaml'].replace('acraksprobesguided.azurecr.io/assistant:health-v1', RESOURCES_GUIDED_IMAGE)
const deploymentManual = deploymentSized.replace('  replicas: 2\n', '  replicas: 3\n')
const deploymentAdopted = deploymentSized.replace(/^  replicas: \d+\n/m, '')
const file = (path, content) => ({ kind: 'file', path, content })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const profile = (scenarioId, ...advances) => [{ kind: 'scenario', scenarioId }, ...advances.map(seconds => ({ kind: 'advance', seconds }))]
const evidenceRecord = (context, taskId) => {
  const id = context.evidence.currentEvidenceByTask?.[taskId]
  return id ? context.evidence.experimentsById?.[id] : null
}
const live = context => context.runtime.kubernetes?.clusters?.[clusterId]
const deployment = context => live(context)?.resources?.['Deployment/assistant/assistant']
const pods = context => getDeploymentPods(context.run ?? context, clusterId, namespace, 'assistant')
const savedDeployment = context => {
  try { return parseYaml(context.project.savedFiles['k8s/deployment.yaml']) } catch { return null }
}
const workloadSourceCurrent = context => {
  const app = parsePythonProject(context.project.savedFiles, RESOURCE_MANIFEST)
  const deploymentObject = deployment(context)
  const image = deploymentObject?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[RESOURCES_GUIDED_IMAGE]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const builtFiles = selectBuildFiles(context.project.savedFiles, RESOURCE_MANIFEST)
  const snapshot = artifactId && context.artifacts.sourceSnapshotsByHash?.[artifact?.sourceHash]?.files
  return !app.diagnostics.length && app.appSpec?.workload?.operation === 'process_batch'
    && app.appSpec.workload.units === 20 && app.appSpec.workload.scratchMiB === 96
    && image === RESOURCES_GUIDED_IMAGE && artifact?.image?.tag === 'resources-v1'
    && artifact.sourceHash === projectSourceHash(builtFiles) && snapshot?.['app.py'] === context.project.savedFiles['app.py']
}
const currentImagePods = context => {
  const state = live(context); const artifactId = context.artifacts.publishedTags?.[RESOURCES_GUIDED_IMAGE]
  return workloadSourceCurrent(context) && pods(context).length === (deployment(context)?.spec?.replicas ?? 0)
    && pods(context).every(pod => state?.podSnapshots?.[pod.metadata.uid]?.artifactId === artifactId)
}
const correctResources = context => {
  const resourceView = inspectResources(context.run ?? context, target)
  const container = deployment(context)?.spec?.template?.spec?.containers?.[0]
  const normalized = normalizeContainerResources(container?.resources ?? {})
  const savedResources = normalizeContainerResources(savedDeployment(context)?.spec?.template?.spec?.containers?.[0]?.resources ?? {})
  const workload = parsePythonProject(context.project.savedFiles, RESOURCE_MANIFEST).appSpec?.workload
  const modeledPeakBytes = 96 * 1024 * 1024 + (workload?.scratchMiB ?? 0) * 1024 * 1024
  return currentImagePods(context) && !normalized.diagnostics.length && !savedResources.diagnostics.length
    && normalized.effective.cpuRequestM === 250 && normalized.effective.cpuLimitM === 500
    && normalized.effective.memoryRequestBytes === 128 * 1024 * 1024 && normalized.effective.memoryLimitBytes === 256 * 1024 * 1024
    && savedResources.effective.cpuRequestM === normalized.effective.cpuRequestM
    && savedResources.effective.cpuLimitM === normalized.effective.cpuLimitM
    && savedResources.effective.memoryRequestBytes === normalized.effective.memoryRequestBytes
    && savedResources.effective.memoryLimitBytes === normalized.effective.memoryLimitBytes
    && [savedResources.authored.cpuRequest, savedResources.authored.cpuLimit, savedResources.authored.memoryRequest, savedResources.authored.memoryLimit].every(value => value !== null)
    && workload?.units === 20 && workload?.scratchMiB === 96 && modeledPeakBytes === 192 * 1024 * 1024
    && resourceView.pods.length > 0
    && resourceView.pods.every(pod => pod.ready && !!pod.nodeName && resourceView.assignments[pod.uid])
    && Object.values(resourceView.nodes).every(node => node.remainingCpuM >= 0 && node.remainingMemoryBytes >= 0)
}
const manualPassed = context => {
  const measures = resourceReceipt(context, 'manual-replicas', 'guided-resource-manual', manualDependencies)
  const summary = evidenceRecord(context, 'manual-replicas')?.measurements
  const workSamples = summary?.samples?.filter(sample => sample.request?.path === '/api/work') ?? []
  return !!measures && summary?.profileId === 'manual-work' && summary.totals?.remaining === 0
    && summary.totals?.completed === summary.totals?.arrivals && workSamples.length >= 2
    && workSamples.every(sample => sample.workload?.operation === 'process_batch' && sample.workload.units === 20
      && sample.workload.checksum === 3230 && sample.body?.checksum === 3230)
    && measures.observations?.some(item => item.pods?.filter(pod => pod.ready).length === 3)
}
const adoptedHpa = context => {
  const state = live(context)
  const deploymentObject = deployment(context)
  const hpa = Object.values(state?.resources ?? {}).find(item => item.kind === 'HorizontalPodAutoscaler'
    && item.metadata.namespace === namespace && item.metadata.name === 'assistant-cpu')
  const doc = savedDeployment(context)
  return correctResources(context) && hpa?.spec?.scaleTargetRef?.name === 'assistant' && hpa.spec.minReplicas === 2
    && hpa.spec.maxReplicas === 4 && hpa.spec.metrics?.[0]?.resource?.target?.averageUtilization === 60
    && hpa.spec.behavior?.scaleDown?.stabilizationWindowSeconds === 60 && !Object.hasOwn(doc?.spec ?? {}, 'replicas')
    && state.applyOwnership?.['Deployment/assistant/assistant']?.replicas === false
    && deploymentObject?.metadata?.uid && Object.values(state.resources).filter(item => item.kind === 'HorizontalPodAutoscaler'
      && item.spec?.scaleTargetRef?.name === 'assistant').length === 1 && manualPassed(context)
}
const cyclePassed = context => {
  const measures = resourceReceipt(context, 'scale-cycle', 'guided-resource-cycle', cycleDependencies)
  const record = evidenceRecord(context, 'scale-cycle')
  const scales = measures?.scaleReceipts ?? []
  const up = scales.some(item => item.cause === 'hpa' && item.from === 2 && item.to === 4)
  const down = scales.find(item => item.cause === 'hpa' && item.from > item.to && item.to === 2)
  return adoptedHpa(context) && !!measures && up && !!down && down.atMs >= record.startedAtMs + 180_000
    && down.atMs <= record.startedAtMs + 270_000 && measures.totals?.remaining === 0
    && measures.totals?.completed === measures.totals?.arrivals
}
const aiWaitPassed = context => {
  const measures = resourceReceipt(context, 'cpu-versus-wait', 'guided-resource-ai-wait', aiWaitDependencies)
  return cyclePassed(context) && !!measures && measures.samples?.length >= 2
    && measures.samples.every(sample => sample.integrationTrace?.profileId === 'answer-wait-150ms'
      && sample.body?.answer === 'Training backups are kept for 30 days.')
    && !(measures.scaleReceipts ?? []).some(item => item.cause === 'hpa' && item.to > item.from)
}
const finalAnswerPassed = context => {
  const record = evidenceRecord(context, 'final-answer')
  const hpa = Object.values(live(context)?.resources ?? {}).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.name === 'assistant-cpu')
  return aiWaitPassed(context) && record?.completed === true && record.outcome === 'passed'
    && record.scenarioId === 'guided-resource-final' && record.measurements?.body?.sources?.includes('training-backups')
    && record.measurements?.body?.answer === 'Training backups are kept for 30 days.'
    && record.measurements?.integrationTrace?.profileId === 'healthy'
    && record.measurements?.integrationTrace?.selectedIds?.includes('training-backups')
    && record.measurements?.integrationTrace?.contextIds?.includes('training-backups')
    && record.measurements?.integrationTrace?.sourceProvenance === 'rows'
    && pods(context).length === 2 && pods(context).every(pod => pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True'))
    && hpa?.spec?.minReplicas === 2 && currentImagePods(context)
}
const resourceScenarios = {
  'guided-resource-manual': resourceScenario('manual-work', target, 3),
  'guided-resource-cycle': resourceScenario('guided-cycle', target, 2),
  'guided-resource-ai-wait': resourceScenario('ai-wait', target, 2),
}
const integrationScenario = {
  kind: 'aks-request', version: 1, target: requestTarget,
  connectivity: { origin: { kind: 'external' }, service: { namespace, name: 'assistant-public' }, port: 80 },
  request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
  expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } },
  integrationProfile: 'healthy',
}

export const aksResourcesGuidedLab = {
  id: 'aks-resources-guided', title: 'Size and scale the AKS assistant', status: 'available',
  brief: 'Measure a fixed local workload, reserve node capacity with requests, constrain each assistant container with limits, scale replicas by hand, then observe CPU utilization drive an HPA. The supplied AI fixtures separate local CPU work from dependency waiting.',
  minutes: 55, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 16,
  labMode: 'guided', skillAreaId: 'containers', service: 'aks', manifestId: RESOURCE_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true },
  initialProjectFiles: RESOURCES_GUIDED_FILES, solutionFiles: RESOURCE_SOLUTION_FILES,
  initializeSimulation: seedResourcesGuided,
  stages: [
    { id: 'workload', title: 'Capture the fixed workload', taskIds: ['workload-source'] },
    { id: 'resources', title: 'Reserve and limit container resources', taskIds: ['resource-sizing'] },
    { id: 'manual', title: 'Scale and measure manually', taskIds: ['manual-replicas'] },
    { id: 'autoscaling', title: 'Adopt and evaluate CPU HPA', taskIds: ['adopt-hpa', 'scale-cycle', 'cpu-versus-wait'] },
    { id: 'verify', title: 'Verify the current AI answer', taskIds: ['final-answer'] },
  ],
  scenarios: { ...resourceScenarios, 'guided-resource-final': integrationScenario },
  tasks: [
    resourceTask({ id: 'workload-source', stageId: 'workload',
      text: 'Implement the supplied `training_workload.process_batch` operation with 20 units and 96 MiB scratch, then build and deploy `assistant:resources-v1`. Preserve the health endpoints and successful AI flow.',
      explanation: 'The workload adapter is a fixed training fixture. Its source declares the units and scratch working set; the browser projects these values into deterministic CPU and memory demand. It does not run Python or allocate the declared memory on your computer.',
      hints: ['Import `training_workload`, set the two module constants, then have `work()` call `process_batch` with both constants.', 'Build from saved files and point the Deployment at the fully qualified `resources-v1` image before applying it.'],
      examNote: 'A literal checksum response is not workload evidence. The captured image must contain the supported operation and declared units.',
      check: currentImagePods,
      solution: { steps: [file('app.py', RESOURCE_SOLUTION_FILES['app.py']),
        file('k8s/deployment.yaml', deploymentSourceOnly),
        ...commands(`az acr build -r ${RESOURCES_GUIDED_REGISTRY} -t assistant:resources-v1 .`, 'kubectl apply -f k8s/deployment.yaml', 'kubectl get pods -n assistant')] } }),
    resourceTask({ id: 'resource-sizing', stageId: 'resources',
      text: 'Set requests to 250m CPU and 128Mi memory, and limits to 500m CPU and 256Mi memory. Apply the Deployment, inspect a node, and confirm the 192Mi modeled peak during local work fits below the memory limit. After the idle metrics window, `kubectl top` should show 96Mi.',
      explanation: 'A request is reserved on one node for placement; it is not a per-container CPU consumption ceiling. A limit constrains use. Each supplied node has 2000m/8192Mi capacity, 1800m/7168Mi allocatable, and fixed reservations of 800m/6144Mi, leaving 1000m and 1024Mi for assistant Pods. The reservation includes the diagnostic fixture once. The modeled process footprint is 96Mi base plus 96Mi scratch while local work runs; the idle process returns to its 96Mi base.',
      hints: ['Use Kubernetes quantities such as `250m`, `128Mi`, and `256Mi`; Mi is binary while M is decimal.', 'Read node `remaining` capacity and idle top usage separately. The following manual-work experiment measures the 96Mi scratch added to the 96Mi process base.'],
      examNote: 'Scheduling checks per-node requests against allocatable capacity after fixed reservations. Current consumption and a larger replica count do not make an oversized Pod fit.',
      check: correctResources,
      solution: { steps: [file('k8s/deployment.yaml', deploymentSized), ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl get nodes'),
        { kind: 'command', line: 'kubectl describe node worker-a' }, { kind: 'advance', seconds: 30 },
        ...commands('kubectl top nodes', 'kubectl top pods -n assistant')] } }),
    resourceTask({ id: 'manual-replicas', stageId: 'manual', scenarioId: 'guided-resource-manual', target, dependencies: manualDependencies,
      text: 'Scale the applied Deployment to three replicas, save `replicas: 3` in its manifest, and apply that consistent state. Run `manual-work`; prove three ready replicas execute the 20-unit operation with no HPA and no remaining work.',
      explanation: 'Manual scale changes live Deployment scale but does not edit the file. Saving and applying `replicas: 3` makes the manifest agree. This proof is retained as history when the later HPA adopts replica ownership.',
      hints: ['Run the supported `kubectl scale` command, then edit the saved Deployment to declare three replicas and apply it.', 'Start the named profile and advance the public AKS clock until it finishes. Inspect the checksum, work totals, Pod readiness, and HPA list.'],
      examNote: 'Manual replica scaling changes desired count while preserving existing Pod identity and the Deployment template. Applying a saved replica count can reset live scale.',
      check: manualPassed,
      solution: { steps: [...commands('kubectl scale deployment/assistant --replicas 3 -n assistant'), file('k8s/deployment.yaml', deploymentManual),
        ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl get nodes', 'kubectl get pods -n assistant -o wide', 'kubectl top pods -n assistant'),
        ...profile('guided-resource-manual', 30, 30), { kind: 'inspect', instruction: 'Inspect the completed manual-work receipt, three ready Pods, checksums, and resource totals.' }] } }),
    resourceTask({ id: 'adopt-hpa', stageId: 'autoscaling', target,
      text: 'Remove `spec.replicas` from the Deployment, apply it, then apply `assistant-cpu` targeting CPU utilization 60%, minimum two and maximum four replicas, with a 60-second scale-down stabilization window. Keep the earlier manual proof current.',
      explanation: 'After adoption, the HPA owns desired scale. The first apply that removes an apply-owned replicas field resets scale once; the HPA enforces its minimum. Later applies that omit replicas preserve HPA changes. Utilization uses effective CPU requests as its denominator, not limits or raw CPU alone.',
      hints: ['Remove the Deployment replica field and apply that saved file before applying the HPA manifest.', 'Use `autoscaling/v2`, one Resource CPU Utilization metric, and the stated min/max and stabilization window. Wait through explicit simulation advances for two ready Pods and complete metrics.'],
      examNote: 'A Deployment manifest that keeps an explicit replicas field can fight with its HPA. A no-op apply after ownership is omitted must preserve scale.',
      check: adoptedHpa,
      solution: { steps: [file('k8s/deployment.yaml', deploymentAdopted), file('k8s/hpa.yaml', RESOURCE_FILES['k8s/hpa.yaml']),
        ...commands('kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/hpa.yaml', 'kubectl get hpa -n assistant', 'kubectl describe hpa assistant-cpu -n assistant'),
        { kind: 'advance', seconds: 30 }, { kind: 'inspect', instruction: 'Inspect HPA policy, Deployment replica ownership, and the preserved manual proof.' }] } }),
    resourceTask({ id: 'scale-cycle', stageId: 'autoscaling', scenarioId: 'guided-resource-cycle', target, dependencies: cycleDependencies,
      text: 'Run `guided-cycle` with the HPA adopted. Observe metric-driven scale-out from two to four during the burst, completion and backlog drain, then scale-in to two after the demand stops and the stabilization history elapses.',
      explanation: 'The profile sends 2 requests/second before a 28 requests/second burst, then no local work. The HPA samples complete 15-second windows. The 60-second scale-down window delays contraction; the Task records actual utilization, scale receipts, readiness, and conserved work.',
      hints: ['Make sure the HPA has two ready replicas and full CPU metrics before starting the profile.', 'Advance through warmup and the complete 270-second profile. Split the public clock into increments no larger than 300 seconds.'],
      examNote: 'HPA desired replicas are not the same as ready or schedulable replicas. Missing metrics are unknown data, not zero CPU.',
      check: cyclePassed,
      solution: { steps: [...profile('guided-resource-cycle', 30, 270), { kind: 'inspect', instruction: 'Inspect the 2-to-4 HPA scale-out, drained workload totals, scale-in receipt, and current ready Pods.' },
        ...commands('kubectl get hpa -n assistant', 'kubectl get pods -n assistant -o wide', 'kubectl top pods -n assistant')] } }),
    resourceTask({ id: 'cpu-versus-wait', stageId: 'autoscaling', scenarioId: 'guided-resource-ai-wait', target, dependencies: aiWaitDependencies,
      text: 'Run `ai-wait`. Confirm successful backups answers during 150ms answer-stage latency without HPA scale-out above two replicas. Keep the completed local-work scale-cycle proof.',
      explanation: 'This fixed AI fixture holds remote answer latency at 150ms, inside the 200ms per-attempt timeout, while charging only 1ms of local CPU per request. It isolates local CPU from dependency waiting; it is not full concurrency or capacity planning.',
      hints: ['Allow the HPA to return to two ready replicas and obtain a complete metrics window before starting.', 'Advance through the full 60-second AI-wait profile and inspect answer provenance and HPA scale receipts.'],
      examNote: 'Elapsed dependency wait is not local CPU consumption. CPU utilization HPA responds to measured CPU relative to requests.',
      check: aiWaitPassed,
      solution: { steps: [...profile('guided-resource-ai-wait', 30, 60), { kind: 'inspect', instruction: 'Inspect successful answer traces and confirm no HPA increase above two replicas.' }, { kind: 'command', line: 'kubectl get hpa -n assistant' }] } }),
    { id: 'final-answer', stageId: 'verify', text: 'Send the external backups question through the current assistant and verify the answer and `training-backups` source. Leave two ready replicas on the current workload and HPA.',
      explanation: 'This final request uses the ordinary Service route and current captured image. The AI answer is supplied by the browser fixture; no model or cloud endpoint is called.',
      hints: ['Run the declared external request scenario after the HPA and Deployment are current.', 'Check the returned answer, source ID, current image, and two ready replicas.'],
      examNote: 'Verify the deployed response through the current Service and source snapshot, not from an earlier manual request.',
      check: finalAnswerPassed, verification: { scenarioId: 'guided-resource-final', scenarioVersion: 1 }, dependencies: {
        ...resourceDependencies(target), ...integrationDependencies(requestTarget),
      }, solution: { steps: [{ kind: 'scenario', scenarioId: 'guided-resource-final' }, { kind: 'inspect' }] } },
  ],
}

import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { DIAGNOSIS_MANIFEST } from '../../templates/aks-python/diagnosis.js'
import { diagnosisTask } from './diagnosis-helpers.js'
import { createDiagnosisSeed, DIAGNOSIS_GROUP, DIAGNOSIS_CLUSTER, DIAGNOSIS_TROUBLESHOOTING_FILES as initialFiles, DIAGNOSIS_GUIDED_SOLUTION_FILES as files } from './diagnosis-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${DIAGNOSIS_GROUP}/providers/Microsoft.ContainerService/managedClusters/${DIAGNOSIS_CLUSTER}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' }
const external = { ...target, serviceName: 'assistant-external' }
const servicePaths = ['k8s/service-internal.yaml', 'k8s/service-external.yaml']
const configPath = 'k8s/configmap.yaml'
const command = line => ({ kind: 'command', line })
const file = path => ({ kind: 'file', path, content: files[path] })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const inspect = instruction => ({ kind: 'inspect', instruction })
const advance = seconds => ({ kind: 'advance', seconds })
const control = action => ({ kind: 'scenario', scenarioId: 'incident', control: action,
  instruction: `${action === 'start' ? 'Start diagnosis of the already faulty saved and live cluster' : 'Complete the recovered diagnosis incident'} in Experiments.` })
const healthy = { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '2.0' } }
const endpointFailure = { status: 502, body: { error: 'The configured AI endpoint is not available in this trainer.', code: 'AI_ENDPOINT' } }
const routeFailure = { status: null, body: null, transport: { ok: false, reason: 'CONNECTION_REFUSED' }, route: { selectedCount: 2 } }
const request = (expected, destination = target, options = {}) => ({ kind: 'aks-request', version: 1, target: destination,
  request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected,
  connectivity: destination.serviceName === 'assistant-external'
    ? { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 }
    : { origin: { kind: 'diagnostic', name: 'diagnostics', namespace: 'diagnostics' }, hostname: 'assistant-internal.assistant', port: 80 },
  ...options })
const fullFlow = 'Inspect the actual training-backups source, 30-day answer and succeeded embedding, postgres-query and answer stages linked by this fresh request ID.'

/** Every desired Pod must have captured the repaired config on the intended v2 artifact. */
export function diagnosisTwoPodRepair(context) {
  const state = context.runtime.kubernetes.clusters[target.clusterId]
  const deployment = state?.resources['Deployment/assistant/assistant-api']
  const pods = getDeploymentPods(context, target.clusterId, 'assistant', 'assistant-api')
  const artifactId = context.artifacts.publishedTags[deployment?.spec.template.spec.containers[0].image]
  const artifact = context.artifacts.buildsById[artifactId]
  const services = servicePaths.map((path, index) => state?.resources[`Service/assistant/assistant-${index ? 'external' : 'internal'}`])
  return deployment?.spec.replicas === 2 && pods.length === 2 && artifact?.appSpec?.listeningPort === 8080
    && deployment.spec.template.spec.containers[0].ports.some(port => port.name === 'http' && port.containerPort === 8080)
    && services.every(service => service?.spec.ports[0]?.targetPort === 8080 || service?.spec.ports[0]?.targetPort === 'http')
    && state.resources['ConfigMap/assistant/assistant-config']?.data?.AI_ENDPOINT === 'https://ai-training.example'
    && pods.every(pod => state.health.containers[pod.metadata.uid]?.ready === true
      && state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId
      && state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'training'
      && state.podSnapshots[pod.metadata.uid]?.environment?.AI_ENDPOINT === 'https://ai-training.example')
}

export const diagnosisTroubleshootingLab = {
  id: 'aks-diagnosis-troubleshooting', title: 'Find both causes of an AKS assistant failure', status: 'available',
  brief: 'Two faults are already present: both Services point to the wrong container port and every Pod captured an unavailable AI endpoint. Preserve each observation, repair saved and live state, then prove both routes and a repeatable rollout.',
  minutes: 45, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 23,
  labMode: 'troubleshooting', skillAreaId: 'containers', service: 'aks', manifestId: DIAGNOSIS_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true,
    kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true, kubernetesDiagnostics: true, acrBuild: true },
  initialProjectFiles: initialFiles, solutionFiles: files,
  initializeSimulation: run => createDiagnosisSeed(diagnosisTroubleshootingLab, { run, incident: 'port-and-endpoint' }),
  stages: [{ id: 'investigate', title: 'Observe both causes', taskIds: ['route-observed', 'dependency-observed'] },
    { id: 'recover', title: 'Recover both routes', taskIds: ['internal-recovered', 'external-recovered'] },
    { id: 'prove', title: 'Prove repeatability', taskIds: ['repeatable-repair'] }],
  scenarios: {
    incident: { kind: 'aks-diagnosis', version: 1, target, initialFaults: true,
      investigationArea: 'Already saved Service targetPort and captured AI endpoint failures',
      controlledProbe: { kind: 'isolated-port-repair', labId: 'aks-diagnosis-troubleshooting', phaseId: 'port-and-endpoint', servicePort: 'http' },
      phases: [{ id: 'port-and-endpoint', edits: [...servicePaths, configPath].map(path => ({ path, before: files[path], after: initialFiles[path] })),
        commands: [...servicePaths, configPath].map(path => `kubectl apply -f ${path}`),
        observationScenarioId: 'route-observed', recoveryScenarioId: 'internal-recovered' }] },
    'route-observed': request(routeFailure),
    'dependency-observed': request(endpointFailure, target, { historicalProbeOf: 'route-observed' }),
    'internal-recovered': request(healthy, target, { requireCompleteRollout: true, expectedCapturedConfig: { AI_ENDPOINT: 'https://ai-training.example' }, expectedCurrentConfig: { AI_ENDPOINT: 'https://ai-training.example' } }),
    'external-recovered': request(healthy, external, { requireCompleteRollout: true, expectedCapturedConfig: { AI_ENDPOINT: 'https://ai-training.example' } }),
    'repeatable-repair': request(healthy, target, { requireTwoReplicas: true, expectedCapturedConfig: { AI_ENDPOINT: 'https://ai-training.example' }, expectedCurrentConfig: { AI_ENDPOINT: 'https://ai-training.example' } }),
  },
  tasks: [],
}

const task = (id, content) => diagnosisTask(id, id, { target: content.target ?? target, lab: diagnosisTroubleshootingLab, ...content })
const historicalRoute = task('route-observed', { historical: true, target, stageId: 'investigate',
  text: 'Inspect the initial internal route and capture its real refused connection while both Pods are Ready.',
  explanation: 'The Service selects two Ready endpoints, but targetPort 8081 has no listener. The request stops before Python and before every dependency stage. Both saved Services and the captured Pod environment already contain their faults at the start.',
  hints: ['Inspect the Services, EndpointSlices and generated Pods in assistant before changing any file.', 'Start diagnosis, then Verify route-observed from diagnostics; inspect selectedCount, CONNECTION_REFUSED and empty application/dependency records.'],
  examNote: 'A selected Ready endpoint does not prove that its target port is listening; a refused connection cannot create handler or dependency logs.',
  solution: { steps: [command('kubectl get pods -n assistant -o wide'), command('kubectl get services -n assistant'), command('kubectl get endpointslices -n assistant'),
    control('start'), verify('route-observed'), inspect('Retain the native failure snapshot with both selected endpoints, null HTTP status and no handler/dependency work.')] } })
diagnosisTroubleshootingLab.tasks = [
  historicalRoute,
  task('dependency-observed', { dependencies: {}, stageId: 'investigate',
    check: context => {
      const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask['dependency-observed']]
      const incident = context.runtime.kubernetes.clusters[target.clusterId]?.diagnosis?.incident
      const route = incident?.observations.find(item => item.scenarioId === 'route-observed')
      const measurements = record?.measurements
      return !!route && route.kind === 'failure' && route.capsule?.environment?.AI_ENDPOINT === 'https://ai-missing.example'
        && measurements?.status === 502 && measurements.body?.code === 'AI_ENDPOINT' && measurements.provenanceValid === true
        && (measurements.origin === 'incident-snapshot' ? measurements.observationId === route.id
          : measurements.transport?.ok === true && measurements.dependencyTrace?.length === 1
            && measurements.dependencyTrace[0].operation === 'embedding' && measurements.dependencyTrace[0].status === 'failed')
    },
    text: 'Expose and retain the second failure. Repair the saved and live Service targetPorts, then Verify the real 502 at embedding. If both causes were repaired together, Verify uses the immutable isolated snapshot probe and labels it historical.',
    explanation: 'A corrected route reaches Python, where the captured AI_ENDPOINT is unavailable and the embedding stage fails with HTTP 502. A controlled snapshot probe changes only the historical Service port in an isolated clone; it cannot prove live recovery or change the run.',
    hints: ['Set both saved Service targetPorts to 8080 or the existing named port http, and apply both manifests.', 'Verify dependency-observed while the old Pods still hold ai-missing.example. If you repaired both causes together, inspect the incident-snapshot origin of the controlled historical result.'],
    examNote: 'A later dependency failure may have been hidden by an earlier transport failure; label counterfactual history separately from current traffic.',
    solution: { steps: [...servicePaths.flatMap(path => [file(path), command(`kubectl apply -f ${path}`)]), verify('dependency-observed'),
      inspect('Retain a real 502 AI_ENDPOINT at embedding. If already repaired together, use the labeled incident-snapshot probe tied to the captured route observation.')] } }),
  task('internal-recovered', { stageId: 'recover', check: diagnosisTwoPodRepair,
    text: 'Repair the saved ConfigMap, apply it, replace the Pods and Verify the full internal training answer.',
    explanation: 'Applying a ConfigMap does not refresh an environment variable inside an existing container. The new Pods must both capture ai-training.example; the fresh request must return the 30-day training-backups answer with all three dependency stages.',
    hints: ['Save the training AI endpoint in k8s/configmap.yaml, apply it and restart assistant-api.', 'Wait for both Pods and the rollout, then Verify internal-recovered and inspect the complete request trace.'],
    examNote: 'Check the environment actually captured by each Pod, not merely the current ConfigMap value.',
    solution: { steps: [file(configPath), command(`kubectl apply -f ${configPath}`), command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(60), advance(30),
      command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), verify('internal-recovered'), inspect(fullFlow)] } }),
  task('external-recovered', { target: external, stageId: 'recover', check: diagnosisTwoPodRepair,
    text: 'Complete the incident and independently Verify the external Service with a fresh full-flow request.',
    explanation: 'The external LoadBalancer route has its own saved and applied targetPort. It must reach the same healthy two-Pod revision and return actual training sources and all succeeded stages.',
    hints: ['After the internal recovery snapshot, complete the diagnosis incident in Experiments.', 'Inspect assistant-external and Verify external-recovered; compare its request ID and source trail to the internal case.'],
    examNote: 'An internal success does not prove the external Service target port or external request path.',
    solution: { steps: [control('next'), command('kubectl get services -n assistant'), verify('external-recovered'), inspect(fullFlow)] } }),
  task('repeatable-repair', { stageId: 'prove', check: diagnosisTwoPodRepair,
    text: 'Reapply all six saved manifests, restart and wait for both intended Pods, then collect fresh internal and external proofs against the current witness.',
    explanation: 'The final witness binds saved files, built source, applied objects, captured environment, Pod identities and a completed rollout. Earlier historical failures remain, while current proof is renewed after the witnessed restart.',
    hints: ['Reapply namespace, ConfigMap, Secret, Deployment and both Services from saved files; then restart.', 'Wait for rollout completion, renew internal/external requests and Verify repeatable-repair on the same current two-Pod state.'],
    examNote: 'A live-only repair, stale Pod or old HTTP 200 is insufficient evidence of a repeatable saved and deployed recovery.',
    solution: { steps: [...DIAGNOSIS_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)),
      command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(60), advance(30),
      command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), verify('internal-recovered'), verify('external-recovered'),
      verify('repeatable-repair'), inspect(fullFlow)] } }),
]

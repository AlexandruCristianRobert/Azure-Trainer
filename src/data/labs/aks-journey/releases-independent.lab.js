import { RELEASE_MANIFEST } from '../../templates/aks-python/releases.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { releaseTask, previousHealthyReleaseAction } from './release-helpers.js'
import { createReleaseSeed, RELEASES_INDEPENDENT_FILES, RELEASES_INDEPENDENT_SOLUTION_FILES,
  RELEASES_INDEPENDENT_GROUP as group, RELEASES_INDEPENDENT_REGISTRY as registry, RELEASES_INDEPENDENT_CLUSTER as cluster } from './release-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}/providers/Microsoft.ContainerService/managedClusters/${cluster}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-public' }
const command = line => ({ kind: 'command', line })
const commands = (...lines) => lines.map(command)
const file = (path, content) => ({ kind: 'file', path, content })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const inspect = instruction => ({ kind: 'inspect', instruction })
const advance = seconds => ({ kind: 'advance', seconds })
const control = (scenarioId, control) => ({ kind: 'scenario', scenarioId, control,
  instruction: `${control === 'finish' ? 'Finish' : 'Start'} ${scenarioId} in the release experiment controls.` })
const milestone = () => ({ kind: 'aks-release-milestone', version: 1, target, requiredReplicas: 3 })
const release = requireIncident => ({ kind: 'aks-release', version: 1, target, expectedRelease: '2.0', requiredAvailable: 3,
  zeroFailedRequests: true, requireIncident, requireDeadline: requireIncident, incidentEpoch: requireIncident ? 2 : 1,
  ...(requireIncident ? { freshIncidentEpoch: true } : {}) })
const healthy = RELEASES_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml']
const missing = healthy.replace('release-v2', 'release-missing')
const wait = [advance(30), advance(30), advance(30)]

export const aksReleasesIndependentLab = {
  id: 'aks-releases-independent', title: 'Meet an AKS release and recovery brief', status: 'available',
  brief: 'Release the assistant with info.version and successful answer.release 2.0, preserving fixed answers and sources. Keep exactly three desired replicas and at least three Available throughout observed release and recovery, at most one nonterminating surge Pod, minReadySeconds ≥5, deadline 45–120 seconds and history ≥2. Fixed nodes and requests supply capacity; choose explicit RollingUpdate controls. Then observe a deliberately unpublished image revision and recover intended v2 with repeatable saved files.',
  minutes: 55, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 21,
  labMode: 'independent', skillAreaId: 'containers', service: 'aks', manifestId: RELEASE_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true },
  releaseRequirements: { replicas: 3, maxSurge: 1, maxUnavailable: 0, minReadySeconds: 5, deadlineMinimum: 45, deadlineMaximum: 120, historyMinimum: 2,
    cpuRequestM: 250, memoryRequestBytes: 134217728 },
  initialProjectFiles: RELEASES_INDEPENDENT_FILES, solutionFiles: RELEASES_INDEPENDENT_SOLUTION_FILES,
  initializeSimulation: run => createReleaseSeed(aksReleasesIndependentLab, { run, replicas: 3, independent: true }),
  solutionActionResolvers: { 'previous-healthy-release': run => previousHealthyReleaseAction(run, target) },
  stages: [
    { id: 'prepare', title: 'Establish baseline and publish', taskIds: ['baseline-v1', 'published-v2'] },
    { id: 'release', title: 'Meet the rolling release brief', taskIds: ['release-v2'] },
    { id: 'recover', title: 'Observe and recover an unpublished revision', taskIds: ['failed-revision', 'recovered-v2'] },
    { id: 'repeatable', title: 'Prove the final saved release', taskIds: ['final-v2'] },
  ],
  scenarios: {
    'baseline-v1': milestone(), 'published-v2': { ...milestone(), imageRef: `${registry}.azurecr.io/assistant:release-v2` },
    'release-v2': release(false), 'recover-v2': release(true),
    'failed-revision': { ...milestone(), experimentScenarioId: 'recover-v2', incidentKind: 'missing-image' },
    'recovered-v2': { ...milestone(), experimentScenarioId: 'recover-v2', incidentKind: 'missing-image' },
    'final-v2': { kind: 'aks-release-final', version: 1, target, expectedRelease: '2.0' },
  },
  tasks: [
    releaseTask('baseline-v1', 'baseline-v1', { target, milestone: true, stageId: 'prepare',
      text: 'Establish the independently seeded v1 baseline. Inspect every desired Pod, retained revisions, resolved artifact and public info/AI behavior.',
      explanation: 'Three healthy v1 Pods are supplied. The complete Deployment deliberately omits release controls. Known questions are How long are backups kept? (training-backups) and Who provides support? (training-support). Files are app.py and the six k8s manifests; use get/describe/logs/events/history/status and explicit Advance controls to inspect.',
      hints: ['Inspect assistant-api, ReplicaSets and Pods in namespace assistant; compare source with captured artifact digests.', 'Verify baseline-v1: info.version 1.0 and the fixed backups answer must exercise embedding, PostgreSQL retrieval and answer generation.'],
      examNote: 'Default rollout controls are valid Kubernetes settings but do not satisfy this independent availability timing brief.',
      solution: { steps: [...commands('kubectl get deployments -n assistant', 'kubectl get replicasets -n assistant', 'kubectl get pods -n assistant -o wide', 'kubectl describe deployment assistant-api -n assistant'), verify('baseline-v1')] } }),
    releaseTask('published-v2', 'published-v2', { target, milestone: true, stageId: 'prepare',
      text: 'Publish saved source with version 2.0 and release=2.0 in successful generated answers while the live baseline still serves v1.',
      explanation: 'Keep input validation, retrieval, generated answer text and retrieved source IDs. Builds capture the six saved build files. Editing source or a tag cannot update running containers.',
      hints: ['Use SERVICE_VERSION in info and format_answer; preserve every dependency and error branch.', `Save app.py and build assistant:release-v2 with az acr build --registry ${registry}; verify publication against current saved source.`],
      examNote: 'A correctly named v2 tag can still contain stale v1 source; captured source and immutable artifact identity determine the release.',
      solution: { steps: [file('app.py', RELEASES_INDEPENDENT_SOLUTION_FILES['app.py']), command(`az acr build --registry ${registry} --image assistant:release-v2 .`), verify('published-v2')] } }),
    releaseTask('release-v2', 'release-v2', { target, stageId: 'release', check: () => true,
      text: 'Choose release controls meeting the brief, deploy published v2 and retain an observation proving full completion, three Available replicas and ten stable seconds of successful v2 answers.',
      explanation: 'Both integer 1/0 and percentage 25%/0% budgets resolve to one surge and zero unavailable for three replicas. Pending and unready Pods consume the surge slot. Terminating Pods have separate accounting and reserve node resources through grace.',
      hints: ['Choose minReadySeconds at least 5, deadline 45–120 and history at least 2; retain three replicas and supplied requests of 250m CPU/128Mi memory.', 'Start release-v2 before applying your saved Deployment. Inspect status and every backend, advance explicitly, then finish after complete stable v2.'],
      examNote: 'A Ready Pod becomes Available only after continuous readiness; successful deterministic request samples are evidence, not production availability guarantees.',
      solution: { steps: [file('k8s/deployment.yaml', healthy), control('release-v2', 'start'), command('kubectl apply -f k8s/deployment.yaml'), ...wait,
        ...commands('kubectl rollout history deployment/assistant-api -n assistant', 'kubectl rollout status deployment/assistant-api -n assistant --watch=false'), control('release-v2', 'finish')] } }),
    releaseTask('failed-revision', 'failed-revision', { target, milestone: true, stageId: 'recover',
      text: 'After successful v2, save and apply a new template using assistant:release-missing, a deliberately unpublished tag. Observe its actual image failure and deadline while old v2 Pods serve; Verify the current incident before repair.',
      explanation: 'The registry has no release-missing tag. Applying your saved file creates the fault; observation controls do not inject it. ProgressDeadlineExceeded does not automatically undo. A previous successful v2 receipt cannot replace this current incident.',
      hints: ['Start recover-v2 before applying the missing image. Inspect current Pod state and kubectl get events; keep healthy v2 backends.', 'Wait for ImageNotFound and ProgressDeadlineExceeded, then Verify failed-revision while that stalled revision is current.'],
      examNote: 'Distinguish missing-image pull failures from configuration creation errors and Running Pods with failed readiness.',
      solution: { steps: [control('recover-v2', 'start'), file('k8s/deployment.yaml', missing), command('kubectl apply -f k8s/deployment.yaml'), advance(30), advance(30), advance(15),
        ...commands('kubectl get pods -n assistant', 'kubectl get events -n assistant', 'kubectl describe deployment assistant-api -n assistant'), verify('failed-revision')] } }),
    releaseTask('recovered-v2', 'recovered-v2', { target, milestone: true, stageId: 'recover',
      text: 'Recover the observed incident to the intended published v2 using retained-template undo or saved-image correction and apply. Meet the same availability brief, complete the rollout and finish stable recovery.',
      explanation: 'Both recovery routes are accepted. Select an actual retained healthy v2 revision from history, or restore the saved release-v2 image and apply. An undo promotes the template to a new revision; it does not repair saved files or separately managed configuration.',
      hints: ['Inspect history for the latest preceding healthy v2 template; no final revision integer is required.', 'Alternatively correct release-missing to release-v2 in saved YAML and apply. Wait for three Available current artifact backends and ten stable seconds, finish recover-v2 and Verify recovered-v2.'],
      examNote: 'Retained templates contain mutable image references, not backups of registry contents or captured external configuration.',
      solution: { steps: [command('kubectl rollout history deployment/assistant-api -n assistant'), { kind: 'command', resolver: 'previous-healthy-release',
        line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=<selected-revision>', instruction: 'Select the actual latest retained healthy v2 revision and substitute its number.' },
        ...wait, command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), control('recover-v2', 'finish'), verify('recovered-v2')],
        alternatives: [{ title: 'Correct the saved image and apply', steps: [file('k8s/deployment.yaml', healthy), command('kubectl apply -f k8s/deployment.yaml'), ...wait,
          command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), control('recover-v2', 'finish'), verify('recovered-v2')] }] } }),
    releaseTask('final-v2', 'final-v2', { target, historical: false, stageId: 'repeatable', check: () => true,
      text: 'Leave corrected saved v2 files, reapply all six manifests and then rollout restart. Prove every fresh Pod uses the current intended artifact/configuration and a fresh correct v2 AI flow.',
      explanation: 'Final verification checks current saved source, immutable artifact, applied Deployment, configuration and Services plus witnessed apply then restart. Live-only undo, stale traffic and a historical receipt cannot replace repeatability. Lab Result retains the verified outcomes and recorded Hint/Solution assistance.',
      hints: ['Correct the saved missing image even when live undo already recovered. Preserve your chosen valid release controls.', 'Reapply namespace, ConfigMap, Secret, Deployment and both Services, then restart. Advance until completion and Verify final-v2; subsequent relevant edits invalidate this proof.'],
      examNote: 'Verified outcomes: version 2.0 info and generated answers, a diagnosed unpublished revision, three-replica availability and repeatable saved files with fresh Pods. Current proof and historical milestones answer different questions. Hint and Solution assistance is recorded in the Result.',
      solution: { steps: [file('k8s/deployment.yaml', healthy), ...RELEASE_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)),
        command('kubectl rollout restart deployment/assistant-api -n assistant'), ...wait, command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), verify('final-v2'),
        inspect('Inspect three fresh Pod UIDs, info.version 2.0, release=2.0 and correct fixed answer/source provenance.')] } }),
  ],
}

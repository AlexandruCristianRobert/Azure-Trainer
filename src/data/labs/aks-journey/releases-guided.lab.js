import { RELEASE_MANIFEST, RELEASE_SOLUTION_FILES } from '../../templates/aks-python/releases.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { releaseTask, previousHealthyReleaseAction } from './release-helpers.js'
import { createReleaseSeed, RELEASES_GUIDED_FILES, RELEASES_GUIDED_GROUP, RELEASES_GUIDED_CLUSTER, RELEASES_GUIDED_REGISTRY } from './release-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RELEASES_GUIDED_GROUP}/providers/Microsoft.ContainerService/managedClusters/${RELEASES_GUIDED_CLUSTER}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-public' }
const imageRef = `${RELEASES_GUIDED_REGISTRY}.azurecr.io/assistant:release-v2`
const deploymentV2 = RELEASE_SOLUTION_FILES['k8s/deployment.yaml']
const deploymentFailed = deploymentV2.replace('/health/ready', '/health/missing')
const command = line => ({ kind: 'command', line })
const commands = (...lines) => lines.map(command)
const file = (path, content) => ({ kind: 'file', path, content })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const control = (scenarioId, action) => ({ kind: 'scenario', scenarioId, control: action,
  instruction: `${action === 'finish' ? 'Finish' : 'Start'} ${scenarioId} in the release experiment controls.` })
const advance = seconds => ({ kind: 'advance', seconds })
const inspect = instruction => ({ kind: 'inspect', instruction })
const milestone = () => ({ kind: 'aks-release-milestone', version: 1, target })
const release = requireIncident => ({ kind: 'aks-release', version: 1, target, expectedRelease: '2.0', requiredAvailable: 2,
  zeroFailedRequests: true, requireIncident, requireDeadline: requireIncident, incidentEpoch: requireIncident ? 2 : 1,
  ...(requireIncident ? { freshIncidentEpoch: true } : {}) })

export const aksReleasesGuidedLab = {
  id: 'aks-releases-guided', title: 'Release and recover the AKS assistant', status: 'available',
  brief: 'Publish version 2, observe a rolling update, expose a failed readiness revision while old Pods serve, then undo and leave repeatable deployment files. Use explicit simulated time and inspect every new Pod.',
  minutes: 55, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 19,
  labMode: 'guided', skillAreaId: 'containers', service: 'aks', manifestId: RELEASE_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true },
  initialProjectFiles: RELEASES_GUIDED_FILES, solutionFiles: RELEASE_SOLUTION_FILES,
  initializeSimulation: run => createReleaseSeed(aksReleasesGuidedLab, { run }),
  solutionActionResolvers: { 'previous-healthy-release': run => previousHealthyReleaseAction(run, target) },
  stages: [
    { id: 'baseline', title: 'Inspect and publish', taskIds: ['inspect-v1', 'publish-v2'] },
    { id: 'release', title: 'Observe the rolling update', taskIds: ['release-v2'] },
    { id: 'recovery', title: 'Diagnose and undo', taskIds: ['failed-revision', 'recover-v2'] },
    { id: 'repeatable', title: 'Prove repeatable recovery', taskIds: ['final-v2'] },
  ],
  scenarios: {
    'baseline-v1': milestone(), 'published-v2': { ...milestone(), imageRef },
    'release-v2': release(false), 'recover-v2': release(true),
    'failed-revision': { ...milestone(), experimentScenarioId: 'recover-v2' },
    'recovered-v2': { ...milestone(), experimentScenarioId: 'recover-v2' },
    'final-v2': { kind: 'aks-release-final', version: 1, target, expectedRelease: '2.0' },
  },
  tasks: [
    releaseTask('inspect-v1', 'baseline-v1', { target, milestone: true, stageId: 'baseline',
      text: 'Inspect Deployment assistant-api, ReplicaSets, Pods and captured image digests. Verify v1 info and the backups answer with training-backups and all three dependency stages.',
      explanation: 'The standalone project starts with two Available v1 Pods. Startup first succeeds at age 10 seconds; five continuous Ready seconds make a Pod Available. Service readiness and rollout completion are different observations.',
      hints: ['Use kubectl get deployments, replicasets and pods in namespace assistant, then describe assistant-api.', 'Run baseline-v1 in Experiments; inspect version 1.0, training-backups, the digest and embedding, PostgreSQL and answer stages.'],
      examNote: 'A successful request to one old backend does not prove every desired Pod is on the intended release.',
      solution: { steps: [...commands('kubectl get deployments -n assistant', 'kubectl get replicasets -n assistant', 'kubectl get pods -n assistant -o wide', 'kubectl describe deployment assistant-api -n assistant'),
        verify('baseline-v1'), inspect('Inspect info version 1.0, the captured v1 digest and the complete backups dependency trace.')] } }),
    releaseTask('publish-v2', 'published-v2', { target, milestone: true, stageId: 'baseline',
      text: 'Set SERVICE_VERSION to 2.0 and include release in format_answer after answer generation. Save the complete app.py, build assistant:release-v2 in ACR, then verify publication while live Pods still serve v1.',
      explanation: 'Build captures saved source into an immutable artifact. Editing source or publishing a new tag does not change the running Pod template. Both versions retain input checks, retrieval and dependency-error behavior.',
      hints: ['Add "release": SERVICE_VERSION to format_answer and keep the generated answer and retrieved row IDs.', 'Run az acr build --registry acraksreleasesguided --image assistant:release-v2 . after saving; verify published-v2 before applying the new image.'],
      examNote: 'Image tags are mutable references. The resolved artifact digest and captured source establish what actually runs.',
      solution: { steps: [file('app.py', RELEASE_SOLUTION_FILES['app.py']), command(`az acr build --registry ${RELEASES_GUIDED_REGISTRY} --image assistant:release-v2 .`), verify('published-v2'),
        inspect('Compare the new artifact source/digest with unchanged captured v1 Pods.')] } }),
    releaseTask('release-v2', 'release-v2', { target, stageId: 'release', check: () => true,
      text: 'Save the v2 image with two replicas, RollingUpdate maxSurge 1/maxUnavailable 0, minReadySeconds 5, deadline 60 and history 3. Start release-v2, apply, advance and inspect; finish only after full rollout and ten stable seconds.',
      explanation: 'One surge Pod fits the supplied node budgets. Old Ready Pods continue serving until new Pods become Available. Terminating Pods still reserve resources during their 30-second grace. Requests are deterministic samples of availability.',
      hints: ['Start observation before kubectl apply -f k8s/deployment.yaml. Reads and rollout status do not advance time.', 'Advance 30 seconds three times, inspect history/status/describe and finish explicitly. Require two Available v2 Pods, release=2.0 and no failed requests.'],
      examNote: 'Measured successful samples do not guarantee continuous production availability or approximate load balancing.',
      solution: { steps: [file('k8s/deployment.yaml', deploymentV2), control('release-v2', 'start'), command('kubectl apply -f k8s/deployment.yaml'),
        advance(30), advance(30), advance(30), ...commands('kubectl rollout history deployment/assistant-api -n assistant', 'kubectl rollout status deployment/assistant-api -n assistant --watch=false', 'kubectl describe deployment assistant-api -n assistant'),
        control('release-v2', 'finish'), inspect('Inspect zero failed samples and both Available v2 artifact backends.')] } }),
    releaseTask('failed-revision', 'failed-revision', { target, milestone: true, stageId: 'recovery',
      text: 'Start recover-v2, save and apply readiness path /health/missing. Advance until ProgressDeadlineExceeded. Verify the incident while old v2 Pods still answer and the new revision remains unready.',
      explanation: 'This is a real changed Pod template and actual failing HTTP readiness probes. The progress deadline reports a stalled rollout and does not undo automatically. Old successful traffic cannot certify the new ReplicaSet.',
      hints: ['Change only readinessProbe.httpGet.path; preserve responsive liveness and correct startup probes.', 'Advance 30 + 30 + 15 seconds, inspect the Deployment condition and new Pods, then verify failed-revision while observation remains active.'],
      examNote: 'ProgressDeadlineExceeded is a diagnosis. Recovery requires an explicit learner repair or retained-template undo.',
      solution: { steps: [control('recover-v2', 'start'), file('k8s/deployment.yaml', deploymentFailed), command('kubectl apply -f k8s/deployment.yaml'), advance(30), advance(30), advance(15),
        ...commands('kubectl get replicasets -n assistant', 'kubectl get pods -n assistant', 'kubectl describe deployment assistant-api -n assistant'), verify('failed-revision'),
        inspect('Inspect readiness failure events, the stalled current revision and successful old v2 samples.')] } }),
    releaseTask('recover-v2', 'recovered-v2', { target, milestone: true, stageId: 'recovery',
      text: 'Inspect rollout history, select the preceding retained healthy v2 template and run rollout undo with that revision. Wait until completion and ten stable terminal seconds, finish recover-v2, then verify recovered-v2.',
      explanation: 'Undo promotes the retained template to a new increasing revision. It restores neither separately managed ConfigMaps/Secrets nor saved files, and a mutable image reference resolves its current artifact. Readiness YAML is still broken on disk until the next Task.',
      hints: ['Find the latest preceding v2 entry whose retained readiness path is /health/ready; retries and restart can change its revision number.', 'Run kubectl rollout undo deployment/assistant-api -n assistant --to-revision=<selected>; advance 30 + 30 + 30, finish, then verify recovered-v2.'],
      examNote: 'Retained history restores a Pod template. Verify current captured artifact and configuration after undo.',
      solution: { steps: [command('kubectl rollout history deployment/assistant-api -n assistant'), { kind: 'command', resolver: 'previous-healthy-release',
        instruction: 'Inspect retained history and select the latest preceding healthy v2 revision. Substitute its actual number into the undo command.', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=<selected-revision>' },
        advance(30), advance(30), advance(30), command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), control('recover-v2', 'finish'), verify('recovered-v2'),
        inspect('Confirm the completed recovery receipt and new increasing revision; saved YAML still has /health/missing.')] } }),
    releaseTask('final-v2', 'final-v2', { target, historical: false, stageId: 'repeatable', check: () => true,
      text: 'Restore /health/ready in the saved Deployment. Reapply all six manifests, rollout restart and wait for completion. Verify final-v2 against current source, artifact, configuration, Services and fresh three-stage AI evidence.',
      explanation: 'The witnessed apply then restart proves fresh containers can start from your final saved files. A live undo alone is insufficient. Later source, artifact, YAML or configuration edits invalidate this current proof even if reverted.',
      hints: ['Save the complete healthy v2 Deployment and apply namespace, ConfigMap, Secret, Deployment and both Services.', 'Restart assistant-api only after all applies. Advance 30 + 30 + 30 seconds and use final-v2; do not assume a final revision number.'],
      examNote: 'Repeatable recovery requires saved manifests and captured containers to agree, plus a fresh dependency-backed response.',
      solution: { steps: [file('k8s/deployment.yaml', deploymentV2), ...RELEASE_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)),
        command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(30), advance(30), advance(30), command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'),
        verify('final-v2'), inspect('Inspect both newly restarted Pods and current saved/live proof with training-backups provenance.')] } }),
  ],
}

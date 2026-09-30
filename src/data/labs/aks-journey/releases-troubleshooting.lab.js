import { RELEASE_MANIFEST } from '../../templates/aks-python/releases.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { releaseTask } from './release-helpers.js'
import { createReleaseSeed, RELEASES_TROUBLESHOOTING_FILES, RELEASES_TROUBLESHOOTING_SOLUTION_FILES,
  RELEASES_TROUBLESHOOTING_GROUP as group, RELEASES_TROUBLESHOOTING_REGISTRY as registry, RELEASES_TROUBLESHOOTING_CLUSTER as cluster } from './release-seeds.js'

const target = { clusterId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}/providers/Microsoft.ContainerService/managedClusters/${cluster}`,
  namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-public' }
const command = line => ({ kind: 'command', line })
const commands = (...lines) => lines.map(command)
const file = (path, content) => ({ kind: 'file', path, content })
const verify = scenarioId => ({ kind: 'scenario', scenarioId })
const inspect = instruction => ({ kind: 'inspect', instruction })
const advance = seconds => ({ kind: 'advance', seconds })
const control = control => ({ kind: 'scenario', scenarioId: 'recover-v2', control,
  instruction: `${control === 'start' ? 'Start' : 'Finish'} recover-v2 in the release experiment controls.` })
const milestone = () => ({ kind: 'aks-release-milestone', version: 1, target, experimentScenarioId: 'recover-v2', incidentKind: 'missing-config-key' })
const healthyDeployment = RELEASES_TROUBLESHOOTING_SOLUTION_FILES['k8s/deployment.yaml']
export const RELEASES_SUPPLIED_KEY_CONFIG = RELEASES_TROUBLESHOOTING_FILES['k8s/configmap.yaml']
  .replace('  ANSWER_DEPLOYMENT: answers-v1', '  ANSWER_DEPLOYMENT: answers-v1\n  ANSWER_DEPLOYMENT_V2: answers-v1')

export const aksReleasesTroubleshootingLab = {
  id: 'aks-releases-troubleshooting', title: 'Diagnose a stalled AKS release', status: 'available',
  brief: 'A published version 2 is stalled while healthy old v1 Pods still serve. Inspect the current Pod, events and deadline, repair saved configuration, and prove a repeatable v2 rollout.',
  minutes: 45, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 20,
  labMode: 'troubleshooting', skillAreaId: 'containers', service: 'aks', manifestId: RELEASE_MANIFEST.id,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true },
  initialProjectFiles: RELEASES_TROUBLESHOOTING_FILES, solutionFiles: RELEASES_TROUBLESHOOTING_SOLUTION_FILES,
  initializeSimulation: run => createReleaseSeed(aksReleasesTroubleshootingLab, { run, group, registry, cluster, incident: 'missing-config-key' }),
  stages: [
    { id: 'diagnose', title: 'Establish scope and cause', taskIds: ['incident-observed', 'config-diagnosis'] },
    { id: 'recover', title: 'Recover and prevent recurrence', taskIds: ['recovered-v2', 'final-v2'] },
  ],
  scenarios: {
    'recover-v2': { kind: 'aks-release', version: 1, target, expectedRelease: '2.0', requiredAvailable: 2,
      zeroFailedRequests: false, requireIncident: true, requireDeadline: true, incidentEpoch: 2 },
    'incident-observed': milestone(), 'config-diagnosis': milestone(), 'recovered-v2': milestone(),
    'final-v2': { kind: 'aks-release-final', version: 1, target, expectedRelease: '2.0' },
  },
  tasks: [
    releaseTask('incident-observed', 'incident-observed', { target, milestone: true, stageId: 'diagnose',
      text: 'Inspect the current Deployment, ReplicaSets and Pod status. Start recover-v2 to observe the existing stall, then Verify incident-observed while the new v2 revision is still failing and old v1 answers succeed.',
      explanation: 'The supplied incident is already real: v2 is published, but its new container cannot be created. Two Available v1 Pods keep serving. ProgressDeadlineExceeded reports a stalled revision without automatic rollback. You do not need to recreate the outage.',
      hints: ['Use kubectl get replicasets and pods in assistant, describe Deployment assistant-api, and inspect rollout status.', 'Start recover-v2. Compare the current waiting Pod with old Ready Pods and the successful version 1.0 backups sample; Verify before repair.'],
      examNote: 'Available old backends can hide a broken current revision; successful traffic alone cannot prove a release completed.',
      solution: { steps: [...commands('kubectl get replicasets -n assistant', 'kubectl get pods -n assistant -o wide',
        'kubectl describe deployment assistant-api -n assistant'),
        { ...command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), expectedFailure: 'ProgressDeadlineExceeded' },
        control('start'), inspect('Inspect the current waiting v2 Pod and successful retained v1 training-backups request.'), verify('incident-observed')] } }),
    releaseTask('config-diagnosis', 'config-diagnosis', { target, milestone: true, stageId: 'diagnose',
      text: 'Describe the failing current Pod and read events. Compare the ANSWER_DEPLOYMENT environment reference with the ConfigMap key list. Verify config-diagnosis to record the conclusion: ANSWER_DEPLOYMENT_V2 is missing from assistant-config.',
      explanation: 'CreateContainerConfigError means the container cannot start because the ConfigMap reference cannot resolve. The image is already published and pull access works. This differs from ImageNotFound/RegistryAccessDenied, and from a Running container whose readiness probe fails. Inspect key names without decoding credentials.',
      hints: ['Copy the waiting current Pod name from kubectl get pods and run kubectl describe pod <name> -n assistant; then kubectl get events -n assistant.', 'Compare the saved/applied Deployment reference key ANSWER_DEPLOYMENT_V2 with assistant-config, which currently contains ANSWER_DEPLOYMENT. Verify this diagnosis while the incident is active.'],
      examNote: 'Correlate Pod state, event reason and referenced configuration before choosing rollback or a forward repair. Secret values are unnecessary.',
      solution: { steps: [{ kind: 'command', resolver: 'describe-failing-pod', line: 'kubectl describe pod <current-waiting-pod> -n assistant',
        instruction: 'Select the current waiting Pod from get pods and substitute its actual name.' },
        ...commands('kubectl get events -n assistant', 'kubectl describe configmap assistant-config -n assistant', 'kubectl describe deployment assistant-api -n assistant'),
        inspect('In deployment.yaml, ANSWER_DEPLOYMENT requests ANSWER_DEPLOYMENT_V2; assistant-config has only ANSWER_DEPLOYMENT=answers-v1. Select this configuration conclusion through Verify config-diagnosis.'), verify('config-diagnosis')] } }),
    releaseTask('recovered-v2', 'recovered-v2', { target, milestone: true, stageId: 'recover',
      text: 'Repair and apply either the saved Deployment reference or saved ConfigMap key. Observe both desired v2 Pods Available, rollout completion and ten stable seconds of real v2 AI answers. Finish recover-v2 and Verify recovered-v2.',
      explanation: 'Repair the reference to ANSWER_DEPLOYMENT, or supply ANSWER_DEPLOYMENT_V2: answers-v1 in assistant-config and keep the requested reference. A temporary rollout undo to retained v1 is allowed after diagnosis; then apply corrected v2. Undo alone leaves saved YAML faulty and does not restore ConfigMaps or Secrets.',
      hints: ['Reference repair: save deployment.yaml with key ANSWER_DEPLOYMENT and the published release-v2 image, then apply it. Supply-key repair: save configmap.yaml with ANSWER_DEPLOYMENT_V2: answers-v1 and apply it.', 'After diagnosis you may inspect history and undo to retained v1 while repairing. Advance 30 + 30 + 30 seconds after the forward repair; inspect both captured v2 digests, finish observation and Verify.'],
      examNote: 'Rollback restores a retained Pod template, not source, saved manifests, external configuration or immutable old tag contents.',
      solution: { steps: [file('k8s/deployment.yaml', healthyDeployment), command('kubectl apply -f k8s/deployment.yaml'),
        advance(30), advance(30), advance(30), ...commands('kubectl rollout history deployment/assistant-api -n assistant', 'kubectl rollout status deployment/assistant-api -n assistant --watch=false'),
        control('finish'), verify('recovered-v2'), inspect('Alternative complete repair: keep the original v2 Deployment reference, save and apply the supplied ConfigMap below, then use the same advance/finish/Verify steps.')],
        alternatives: [{ title: 'Supply the requested ConfigMap key', steps: [file('k8s/configmap.yaml', RELEASES_SUPPLIED_KEY_CONFIG), command('kubectl apply -f k8s/configmap.yaml'),
          advance(30), advance(30), advance(30), command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), control('finish'), verify('recovered-v2')] }] } }),
    releaseTask('final-v2', 'final-v2', { target, historical: false, stageId: 'recover', check: () => true,
      text: 'Keep your chosen saved repair, reapply all six manifests and rollout restart. Wait for completion and Verify final-v2 against current saved source, artifact, configuration, Services and fresh v2 dependency-backed responses.',
      explanation: 'Fresh containers must resolve your final files successfully. Both reference repair and supplied-key repair are accepted. A live-only fix or v1-only undo cannot prove repeatable version 2. A restart reads the current separately managed configuration and current image artifact.',
      hints: ['If you supplied the key, retain it and the matching saved Deployment reference. If you repaired the reference, retain the corrected Deployment. Save every changed file.', 'Apply namespace, ConfigMap, Secret, Deployment and both Services, then restart assistant-api. Advance 30 + 30 + 30, inspect status and Verify final-v2.'],
      examNote: 'Prevent recurrence by aligning saved manifests, applied objects and newly captured containers; a past recovery receipt does not prove current state.',
      solution: { steps: [inspect('Preserve either chosen saved repair. For reference repair the complete healthy Deployment is supplied in the previous Solution; for supply-key use its complete alternative ConfigMap.'),
        ...RELEASE_MANIFEST.kubernetesFiles.map(path => command(`kubectl apply -f ${path}`)), command('kubectl rollout restart deployment/assistant-api -n assistant'),
        advance(30), advance(30), advance(30), command('kubectl rollout status deployment/assistant-api -n assistant --watch=false'), verify('final-v2')] } }),
  ],
  solutionActionResolvers: {
    'describe-failing-pod': run => {
      const state = run.runtime.kubernetes.clusters[target.clusterId]
      const d = state.resources['Deployment/assistant/assistant-api']
      const rsUid = state.rollouts.deployments[d.metadata.uid].currentRsUid
      const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && !item.metadata.deletionTimestamp
        && item.metadata.ownerReferences?.some(owner => owner.uid === rsUid) && item.status.containerStatuses?.[0]?.state.waiting)
      if (!pod) throw new Error('Inspect the current failing Pod before repair.')
      return { type: 'command', line: `kubectl describe pod ${pod.metadata.name} -n assistant` }
    },
  },
}

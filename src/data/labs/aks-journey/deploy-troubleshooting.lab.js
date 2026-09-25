import { FOUNDATION_MANIFEST } from '../../templates/aks-python/foundation.js'
import { kubernetesDependencies } from '../../../lib/kubernetes/evidence.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import {
  TROUBLESHOOTING_CLUSTER, TROUBLESHOOTING_GROUP, TROUBLESHOOTING_IMAGE, TROUBLESHOOTING_REGISTRY,
  seedDeploymentTroubleshooting, troubleshootingInitialFiles, troubleshootingSolutionFiles,
} from './deployment-seeds.js'
import {
  troubleshootingContextReady, troubleshootingPublishedImageReady, troubleshootingRegistryAccessReady,
  troubleshootingRepairedManifestsReady, troubleshootingRecoveryReady,
} from './deployment-helpers.js'

const clusterId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${TROUBLESHOOTING_CLUSTER}`
const dependencies = kubernetesDependencies(clusterId, 'assistant', 'assistant', 'assistant', { sourceSensitive: true })
const command = (...lines) => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const file = path => ({ kind: 'file', path, content: troubleshootingSolutionFiles[path] })

export const aksDeployTroubleshootingLab = {
  id: 'aks-deploy-troubleshooting', title: 'Recover an AKS deployment incident', status: 'draft',
  skillAreaId: 'containers', service: 'aks', minutes: 30,
  brief: 'The assistant was applied in the staging namespace, cannot pull its image, and names a tag that was never published. Inspect the context, manifests and events, then recover the intended assistant deployment without leaving the accidental staging workload behind.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 2, labMode: 'troubleshooting',
  manifestId: FOUNDATION_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true },
  initialProjectFiles: troubleshootingInitialFiles, solutionFiles: troubleshootingSolutionFiles, initializeSimulation: seedDeploymentTroubleshooting,
  stages: [{ id: 'diagnose', title: 'Diagnose and recover', taskIds: ['target-namespace', 'published-image', 'registry-access', 'repaired-manifests', 'recovery'] }],
  scenarios: {
    'troubleshooting-recovery': { kind: 'aks-request', version: 1,
      target: { clusterId, namespace: 'assistant', serviceName: 'assistant', deploymentName: 'assistant' },
      request: { method: 'GET', path: '/api/info' },
      expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } },
      requireTwoReplicas: true, requireReplacement: false },
  },
  tasks: [
    { id: 'target-namespace', stageId: 'diagnose', text: 'Select the intended `assistant` namespace in the connected AKS context.',
      explanation: 'A kubectl context carries a namespace default. The incident began because the saved manifests and selected context both pointed at staging.', check: troubleshootingContextReady,
      hints: ['Run `kubectl config current-context`, then inspect the selected namespace before making repairs.', 'Set the current context namespace to `assistant` with `kubectl config set-context --current --namespace assistant`.'],
      solution: command('kubectl config set-context --current --namespace assistant'), examNote: 'Namespace names are case-sensitive boundaries; a correct command in the wrong namespace changes a different workload.' },
    { id: 'published-image', stageId: 'diagnose', text: 'Use the published `assistant:v1` image from `acrakstrouble` in the repaired Deployment.',
      explanation: 'The registry contains an immutable artifact for v1. The seeded missing tag is a distinct failure from authorization.', check: troubleshootingPublishedImageReady,
      hints: ['Inspect image-pull events and compare the Deployment image with the registry’s published tag.', 'The published image is `acrakstrouble.azurecr.io/assistant:v1`; update saved YAML before applying it.'],
      solution: { steps: [file('k8s/deployment.yaml')] }, examNote: 'ImageNotFound means the requested tag has no artifact; granting pull access cannot create that tag.' },
    { id: 'registry-access', stageId: 'diagnose', text: 'Attach `acrakstrouble` to `aks-troubleshooting` so its kubelet identity receives registry-scoped AcrPull.',
      explanation: 'A valid private image still needs the cluster kubelet to authenticate before new Pods can pull it.', check: troubleshootingRegistryAccessReady,
      hints: ['A denied pull is separate from a missing tag; inspect the cluster kubelet identity and registry scope.', 'Run `az aks update -g rg-aks-troubleshooting -n aks-troubleshooting --attach-acr acrakstrouble`.'],
      solution: command(`az aks update -g ${TROUBLESHOOTING_GROUP} -n ${TROUBLESHOOTING_CLUSTER} --attach-acr ${TROUBLESHOOTING_REGISTRY}`), examNote: 'AcrPull is granted to the kubelet identity at the registry scope, not embedded as a password in the manifest.' },
    { id: 'repaired-manifests', stageId: 'diagnose', text: 'Save and apply corrected Namespace, Deployment and Service manifests for two training Pods in `assistant`.',
      explanation: 'Applying a live repair alone is insufficient: saved manifests must semantically describe the recovered workload so a future apply reproduces it.', check: troubleshootingRepairedManifestsReady,
      hints: ['Correct namespace metadata, the image tag, labels/selectors, two replicas and APP_ENV in the saved files.', 'Apply the Namespace first, then the Deployment and Service. A Service routes only to ready Pods whose labels match its selector.'],
      solution: { steps: [file('k8s/namespace.yaml'), file('k8s/deployment.yaml'), file('k8s/service.yaml'), ...[
        'kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/service.yaml',
      ].map(line => ({ kind: 'command', line }))] }, examNote: 'Desired YAML and applied state must agree; an accidental live-only repair is not repeatable infrastructure.' },
    { id: 'recovery', stageId: 'diagnose', text: 'Delete the accidental staging Deployment and Service, then verify the two-Pod assistant response.',
      explanation: 'Staging may remain as an empty namespace, but its accidental workload must be removed. The request is fixed to the target cluster and assistant Service, so the decoy cannot prove recovery.', check: troubleshootingRecoveryReady,
      dependencies, verification: { scenarioId: 'troubleshooting-recovery', scenarioVersion: 1 },
      hints: ['Remove the staging Deployment and Service explicitly, then inspect Pods and Service endpoints in assistant.', 'Use the declared troubleshooting recovery request after both assistant Pods are running.'],
      solution: { steps: [...[
        'kubectl delete deployment assistant -n staging', 'kubectl delete service assistant -n staging',
      ].map(line => ({ kind: 'command', line })), { kind: 'scenario', scenarioId: 'troubleshooting-recovery' }] }, examNote: 'A recovery request must prove the intended cluster, namespace, Service and current Pods; an unrelated successful endpoint is not evidence.' },
  ],
}

import { CONFIG_INDEPENDENT_FILES, CONFIG_INDEPENDENT_MANIFEST, CONFIG_INDEPENDENT_SOLUTION_FILES } from '../../templates/aks-python/configuration-independent.js'
import { CONFIG_INDEPENDENT_CLUSTER, CONFIG_INDEPENDENT_GROUP, configurationIndependentPrimaryDependencies, configurationIndependentPrimaryReady, configurationIndependentReviewConfigReady, configurationIndependentReviewDependencies, configurationIndependentReviewManifestsReady, configurationIndependentSharedArtifactReady } from './configuration-helpers.js'
import { seedConfigurationIndependent } from './configuration-seeds.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONFIG_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONFIG_INDEPENDENT_CLUSTER}`
const reviewDependencies = configurationIndependentReviewDependencies(clusterId)
const primaryDependencies = configurationIndependentPrimaryDependencies(clusterId)
const file = path => ({ kind: 'file', path, content: CONFIG_INDEPENDENT_SOLUTION_FILES[path] })
const commands = lines => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const task = (id, stageId, text, explanation, check, hints, solution, examNote, verification, dependencies) => ({ id, stageId, text, explanation, check, hints, solution, examNote, ...(verification ? { verification, dependencies } : {}) })

export const aksConfigIndependentLab = {
  id: 'aks-config-independent', title: 'Reuse a shared AKS assistant image safely', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 40, engineVersion: 2, contentVersion: 1,
  journeyId: 'aks-knowledge-assistant', journeyOrder: 6, labMode: 'independent',
  brief: 'Run a second assistant in a review namespace using the supplied shared artifact, while keeping the primary production configuration and response intact.',
  manifestId: CONFIG_INDEPENDENT_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true },
  initialProjectFiles: CONFIG_INDEPENDENT_FILES, solutionFiles: CONFIG_INDEPENDENT_SOLUTION_FILES, initializeSimulation: seedConfigurationIndependent,
  stages: [
    { id: 'review-configuration', title: 'Configure the review instance', taskIds: ['review-config', 'review-manifests', 'shared-image'] },
    { id: 'review-evidence', title: 'Verify independent behavior', taskIds: ['review-answer'] },
    { id: 'primary-evidence', title: 'Protect the primary instance', taskIds: ['primary-intact'] },
  ],
  scenarios: {
    'independent-config-review': { kind: 'aks-request', version: 1,
      target: { clusterId, namespace: 'review', serviceName: 'review-assistant', deploymentName: 'review-assistant' },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, requireTwoReplicas: true,
      expected: { status: 200, body: { answer: '[Review] Review backups are kept for 7 days.', sources: ['review-backups'], environment: 'review', displayName: 'Review assistant' } } },
    'independent-config-primary': { kind: 'aks-request', version: 1,
      target: { clusterId, namespace: 'primary', serviceName: 'assistant', deploymentName: 'assistant' },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, requireTwoReplicas: true,
      expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'production', displayName: 'Primary assistant' } } },
  },
  tasks: [
    task('review-config', 'review-configuration', 'Save a ConfigMap and Secret for the review namespace.',
      'Use the supplied fictional review endpoint, database profile, credentials, collection, and mounted display settings. ConfigMaps carry ordinary configuration; the Secret carries the fictional password.',
      configurationIndependentReviewConfigReady,
      ['Set every review profile key under `review`, including `COLLECTION: review` and the mounted settings.json.', 'Reference review-only credentials through a Secret; do not copy the primary profile.'],
      { steps: [file('k8s/review-namespace.yaml'), file('k8s/review-configmap.yaml'), file('k8s/review-secret.yaml')] },
      'A ConfigMap and a Secret are namespaced resources. Base64 `data` and plain `stringData` are equivalent supported Secret representations.'),
    task('review-manifests', 'review-configuration', 'Save the review Deployment and Service manifests.',
      'Create `review-assistant` with two replicas. It must reference the review ConfigMap and Secret, mount settings.json, and route the Service to only the review Pod label.',
      configurationIndependentReviewManifestsReady,
      ['Use ConfigMap and Secret `valueFrom` references for all environment values and mount settings.json at `/etc/assistant`.', 'The Service selector must match the Deployment template label `app: review-assistant`.'],
      { steps: [file('k8s/review-deployment.yaml'), file('k8s/review-service.yaml')] },
      'A Service selects Pods only in its namespace. A matching primary label is not a cross-namespace shortcut.'),
    task('shared-image', 'review-configuration', 'Apply the review workload with the exact immutable shared assistant image.',
      'The primary instance already captured the supplied `assistant:shared` artifact. Apply the review Namespace, configuration, Deployment, and Service; rebuilding a lookalike image does not reuse that artifact.',
      configurationIndependentSharedArtifactReady,
      ['Apply the review files after saving them. The required image is `acraksconfigindependent.azurecr.io/assistant:shared`.', 'Inspect the captured artifact ID on the review Pods and compare it with the primary Pods.'],
      commands(['kubectl apply -f k8s/review-namespace.yaml', 'kubectl apply -f k8s/review-configmap.yaml', 'kubectl apply -f k8s/review-secret.yaml', 'kubectl apply -f k8s/review-deployment.yaml', 'kubectl apply -f k8s/review-service.yaml']),
      'A container tag may be republished. This Lab records the immutable seeded artifact ID, so an equivalent rebuild cannot prove reuse.'),
    task('review-answer', 'review-evidence', 'Verify the review answer, source, environment, and mounted display name.',
      'Send the fixed request to the review Service. Its source and response must come from the supplied review fixture, not from the primary workload.',
      configurationIndependentSharedArtifactReady,
      ['Run the named review request only after two ready review Pods have captured the review configuration.', 'Inspect the response trace: it reports the supplied dependency fixture and selected review source.'],
      { steps: [{ kind: 'scenario', scenarioId: 'independent-config-review', instruction: 'Verify the review instance.' }] },
      'Request evidence is pinned to its declared cluster, namespace, Service, Deployment, Pod snapshots and immutable artifact.',
      { scenarioId: 'independent-config-review', scenarioVersion: 1 }, reviewDependencies),
    task('primary-intact', 'primary-evidence', 'Verify that the primary production assistant remains unchanged.',
      'Confirm the seeded canonical primary configuration and send a fresh primary request. Review changes must never prove the primary response.',
      configurationIndependentPrimaryReady,
      ['Inspect the primary ConfigMap, Secret, Deployment, and Service before asking the fixed primary request.', 'If you changed any primary source or YAML, restore the canonical files and run this request again.'],
      { steps: [{ kind: 'scenario', scenarioId: 'independent-config-primary', instruction: 'Verify the unchanged primary instance.' }] },
      'Primary and review evidence use separate dependency sets, so review-only configuration edits do not invalidate a valid primary proof.',
      { scenarioId: 'independent-config-primary', scenarioVersion: 1 }, primaryDependencies),
  ],
}

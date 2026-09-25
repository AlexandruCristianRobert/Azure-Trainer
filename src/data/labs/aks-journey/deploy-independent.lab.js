import { INDEPENDENT_FOUNDATION_FILES, INDEPENDENT_FOUNDATION_MANIFEST, INDEPENDENT_FOUNDATION_SOLUTION_FILES } from '../../templates/aks-python/foundation.js'
import { kubernetesDependencies } from '../../../lib/kubernetes/evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { INDEPENDENT_CLUSTER, INDEPENDENT_GROUP, INDEPENDENT_IMAGE_V1, INDEPENDENT_IMAGE_V2,
  seedDeploymentIndependent } from './deployment-seeds.js'

const clusterId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${INDEPENDENT_CLUSTER}`
const primaryDependencies = kubernetesDependencies(clusterId, 'primary', 'assistant', 'assistant')
const reviewDependencies = kubernetesDependencies(clusterId, 'review', 'review-assistant', 'review-assistant', { sourceSensitive: true })
const command = (...lines) => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const file = path => ({ kind: 'file', path, content: INDEPENDENT_FOUNDATION_SOLUTION_FILES[path] })

function parsed(context, path) {
  const result = parseKubernetesYaml(context.project.savedFiles[path] ?? '', path)
  return result.diagnostics.length ? null : result.documents[0]
}

function reviewSourceReady(context) {
  const parsedProject = parsePythonProject(context.project.savedFiles, INDEPENDENT_FOUNDATION_MANIFEST)
  if (parsedProject.diagnostics.length || parsedProject.appSpec?.service !== 'knowledge-assistant'
    || parsedProject.appSpec?.version !== '2.0') return false
  const environment = parsedProject.appSpec.routes?.find(route => route.method === 'GET' && route.path === '/api/info')?.response?.environment
  if (environment?.kind !== 'config' || environment.key !== 'APP_ENV' || environment.defaultValue !== 'development') return false
  const sourceHash = projectSourceHash(selectBuildFiles(context.project.savedFiles, INDEPENDENT_FOUNDATION_MANIFEST))
  const id = context.artifacts.publishedTags?.[INDEPENDENT_IMAGE_V2.toLowerCase()]
  const artifact = id && context.artifacts.buildsById?.[id]
  return !!artifact && artifact.sourceHash === sourceHash && artifact.appSpec?.version === '2.0'
    && artifact.appSpec.routes?.find(route => route.method === 'GET' && route.path === '/api/info')?.response?.environment?.kind === 'config'
    && artifact.appSpec.routes.find(route => route.method === 'GET' && route.path === '/api/info').response.environment.key === 'APP_ENV'
}

function reviewManifestObjects(context) {
  const namespace = parsed(context, 'k8s/review-namespace.yaml')
  const deployment = parsed(context, 'k8s/review-deployment.yaml')
  const service = parsed(context, 'k8s/review-service.yaml')
  return namespace?.kind === 'Namespace' && namespace.metadata?.name === 'review'
    && deployment?.kind === 'Deployment' && deployment.metadata?.name === 'review-assistant'
    && deployment.metadata?.namespace === 'review'
    && service?.kind === 'Service' && service.metadata?.name === 'review-assistant'
    && service.metadata?.namespace === 'review' ? { namespace, deployment, service } : null
}

function reviewConfigurationReady(context) {
  const objects = reviewManifestObjects(context)
  if (!objects) return false
  const { deployment, service } = objects
  const spec = deployment.spec
  const selector = spec?.selector?.matchLabels
  const labels = spec?.template?.metadata?.labels
  const container = spec?.template?.spec?.containers?.[0]
  const port = container?.ports?.[0]
  const env = container?.env?.find(item => item.name === 'APP_ENV')
  const servicePort = service.spec?.ports?.[0]
  const resolvedTarget = typeof servicePort?.targetPort === 'number' ? servicePort.targetPort
    : port?.name === servicePort?.targetPort ? port.containerPort : null
  return spec?.replicas === 2 && Object.keys(selector ?? {}).length > 0
    && selector['app'] === 'review-assistant'
    && Object.entries(selector).every(([key, value]) => labels?.[key] === value)
    && container?.image?.toLowerCase() === INDEPENDENT_IMAGE_V2.toLowerCase()
    && env?.value === 'review' && port?.containerPort === 8080
    && ['ClusterIP', 'LoadBalancer'].includes(service.spec?.type) && Object.keys(service.spec?.selector ?? {}).length > 0
    && Object.entries(service.spec.selector).every(([key, value]) => labels?.[key] === value)
    && servicePort?.port === 80 && resolvedTarget === 8080
}

function appliedReviewReady(context) {
  if (!reviewConfigurationReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const resources = state?.resources ?? {}
  const namespace = resources['Namespace//review']
  const deployment = resources['Deployment/review/review-assistant']
  const service = resources['Service/review/review-assistant']
  const expected = reviewManifestObjects(context)
  if (!namespace || !deployment || !service || !expected
    || canonicalize(deployment.spec) !== canonicalize(expected.deployment.spec)
    || canonicalize(service.spec) !== canonicalize(expected.service.spec)) return false
  const pods = getDeploymentPods({ runtime: context.runtime }, clusterId, 'review', 'review-assistant')
  return pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running'
    && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
    && state.podSnapshots[pod.metadata.uid]?.artifactId === context.artifacts.publishedTags[INDEPENDENT_IMAGE_V2.toLowerCase()]
    && state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'review')
}

function primaryIntact(context) {
  if (!appliedReviewReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const deployment = state?.resources['Deployment/primary/assistant']
  const service = state?.resources['Service/primary/assistant']
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image?.toLowerCase()
  if (!deployment || !service || deployment.spec.replicas !== 2 || image !== INDEPENDENT_IMAGE_V1.toLowerCase()
    || deployment.spec.template.spec.containers[0].env?.find(item => item.name === 'APP_ENV')?.value !== 'production') return false
  const recordId = context.evidence?.currentEvidenceByTask?.['primary-intact']
  const record = recordId && context.evidence?.experimentsById?.[recordId]
  return record?.outcome === 'passed' && record?.scenarioId === 'independent-primary'
    && record.measurements?.namespace === 'primary' && record.measurements?.body?.version === '1.0'
    && record.measurements?.body?.environment === 'production'
}

function deleteReviewPod(run) {
  const pod = getDeploymentPods(run, clusterId, 'review', 'review-assistant')[0]
  if (!pod) throw new Error('No review-assistant Pod is available for the replacement exercise.')
  return { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n review` }
}

const namespaceScenario = { kind: 'aks-request', version: 1,
  target: { clusterId, namespace: 'review', serviceName: 'review-assistant', deploymentName: 'review-assistant' },
  request: { method: 'GET', path: '/api/info' },
  expected: { status: 200, body: { service: 'knowledge-assistant', version: '2.0', environment: 'review' } },
  requireTwoReplicas: true, requireReplacement: false }

export const aksDeployIndependentLab = {
  id: 'aks-deploy-independent', title: 'Deploy an isolated AKS review instance', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 30,
  brief: 'Use the existing AKS cluster to deploy a second assistant in its own namespace. Review the primary manifests as read-only references, then apply and verify an independent two-replica review instance.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 3, labMode: 'independent',
  manifestId: INDEPENDENT_FOUNDATION_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true },
  initialProjectFiles: INDEPENDENT_FOUNDATION_FILES, solutionFiles: INDEPENDENT_FOUNDATION_SOLUTION_FILES,
  initializeSimulation: seedDeploymentIndependent, solutionActionResolvers: { 'delete-review-pod': deleteReviewPod },
  stages: [{ id: 'independent-review', title: 'Deploy the review instance', taskIds: ['namespace', 'manifests', 'deployed', 'review-request'] },
    { id: 'independent-replacement', title: 'Verify replacement', taskIds: ['replacement'] },
    { id: 'independent-primary', title: 'Protect the primary instance', taskIds: ['primary-intact'] }],
  scenarios: {
    'independent-review': namespaceScenario,
    'independent-replacement': { ...namespaceScenario, requireReplacement: true },
    'independent-primary': { kind: 'aks-request', version: 1,
      target: { clusterId, namespace: 'primary', serviceName: 'assistant', deploymentName: 'assistant' },
      request: { method: 'GET', path: '/api/info' },
      expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'production' } },
      requireTwoReplicas: true, requireReplacement: false },
  },
  tasks: [
    { id: 'namespace', stageId: 'independent-review', text: 'Create the `review` namespace in the existing AKS cluster.',
      explanation: 'A Kubernetes namespace separates names and workloads inside one cluster. The read-only primary manifests show the existing `primary` workload for comparison.',
      check: context => !!context.runtime.kubernetes?.clusters?.[clusterId]?.resources['Namespace//review'],
      hints: ['Inspect the current context and the primary namespace manifests before creating anything.', 'Apply the saved `k8s/review-namespace.yaml`; the cluster and primary namespace already exist.'],
      solution: { steps: [file('k8s/review-namespace.yaml'), { kind: 'command', line: 'kubectl apply -f k8s/review-namespace.yaml' }] },
      examNote: 'Namespaces isolate namespaced resources within a cluster; they do not create another AKS cluster.' },
    { id: 'manifests', stageId: 'independent-review', text: 'Save complete Deployment and Service manifests for `review-assistant` in `review`.',
      explanation: 'The Deployment should run the already published v2 image with two replicas and APP_ENV=review. The Service routes port 80 to the application listener on 8080.',
      check: reviewConfigurationReady,
      hints: ['Use the read-only primary manifests as a pattern, changing the namespace, workload identity, image tag, replica count and environment.', 'The published image is `acraksindependent.azurecr.io/assistant:v2`; the Service selector must match the Pod template labels.'],
      solution: { steps: [file('k8s/review-deployment.yaml'), file('k8s/review-service.yaml')] },
      examNote: 'A Service selects Pods by labels, and targetPort must reach the application listener. YAML key order and equivalent named or numeric target ports do not change behavior.' },
    { id: 'deployed', stageId: 'independent-review', text: 'Apply the review Deployment and Service and confirm two ready Pods use the v2 image with the review environment.',
      explanation: 'Applying saved YAML records desired state in the cluster. The simulator immediately reconciles the Deployment and its Pods.',
      check: context => appliedReviewReady(context),
      hints: ['Apply the saved review Deployment and Service after the namespace exists, then inspect Pods and the Service.', 'Check image-pull events if Pods are not ready; the cluster kubelet already has AcrPull access to this registry.'],
      solution: command('kubectl apply -f k8s/review-deployment.yaml', 'kubectl apply -f k8s/review-service.yaml'),
      examNote: 'A successful apply records desired Kubernetes state; Pod snapshots retain the artifact and environment captured at creation.' },
    { id: 'review-request', stageId: 'independent-review', text: 'Send the declared request to the review instance and confirm its version 2.0 review response.',
      explanation: 'The request is pinned to the review namespace, Service and Deployment. A response from the primary assistant cannot satisfy this check.',
      check: context => appliedReviewReady(context) && reviewSourceReady(context), dependencies: reviewDependencies,
      verification: { scenarioId: 'independent-review', scenarioVersion: 1 },
      hints: ['Confirm the review Service has two ready matching Pods before sending the request.', 'Run the `independent-review` request and inspect its response and selected Pod evidence.'],
      solution: { steps: [{ kind: 'scenario', scenarioId: 'independent-review', instruction: 'Send the fixed request to the review Service and inspect the response.' }] },
      examNote: 'Verification evidence belongs to its declared cluster, namespace, Service, Deployment and captured Pods.' },
    { id: 'replacement', stageId: 'independent-replacement', text: 'Delete one review Pod, confirm its replacement, and verify the review response again.',
      explanation: 'A Deployment recreates a deleted managed Pod. The replacement has a new identity while preserving the current template, image and environment.',
      check: context => appliedReviewReady(context), dependencies: reviewDependencies,
      verification: { scenarioId: 'independent-replacement', scenarioVersion: 1 },
      hints: ['Delete one Pod owned by the review Deployment, then inspect the new Pod identity.', 'Send the replacement scenario only after two review Pods are ready again.'],
      solution: { steps: [{ kind: 'command', resolver: 'delete-review-pod' },
        { kind: 'scenario', scenarioId: 'independent-replacement', instruction: 'Verify the replacement Pod serves the review response.' },
        { kind: 'scenario', scenarioId: 'independent-review', instruction: 'Refresh the review request evidence for the current Pod set.' }] },
      examNote: 'A successful response alone does not prove replacement; the request evidence must include the current Deployment template and replacement receipt.' },
    { id: 'primary-intact', stageId: 'independent-primary', text: 'Confirm the original primary Deployment is unchanged and send a fresh primary response check.',
      explanation: 'The independent review workload shares the cluster but uses another namespace. Confirm the original production workload remains intact and responds independently.',
      check: primaryIntact, dependencies: primaryDependencies,
      verification: { scenarioId: 'independent-primary', scenarioVersion: 1 },
      hints: ['Compare the running primary Deployment with its read-only manifest references.', 'Send the declared primary request and confirm version 1.0 with environment production.'],
      solution: { steps: [{ kind: 'scenario', scenarioId: 'independent-primary', instruction: 'Verify the original primary assistant still responds with its production configuration.' }] },
      examNote: 'A separate namespace should not alter the primary configuration or allow its response to prove the review workload.' },
  ],
}

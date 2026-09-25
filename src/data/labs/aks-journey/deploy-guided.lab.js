import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../../templates/aks-python/foundation.js'
import { kubernetesDependencies } from '../../../lib/kubernetes/evidence.js'
import {
  GUIDED_CLUSTER_ID, GUIDED_GROUP, GUIDED_IMAGE, GUIDED_REGISTRY,
  guidedClusterReady, guidedDeploymentReady, guidedDockerReady, guidedPythonReady,
  guidedRegistryAccessReady, guidedSolutionFiles, guidedPublishedArtifact, solutionAction,
} from './deployment-helpers.js'

const command = (...lines) => ({ steps: lines.map(line => ({ kind: 'command', line })) })
const file = path => ({ steps: [{ kind: 'file', path, content: guidedSolutionFiles[path] }] })
const namespace = 'assistant'
const deploymentName = 'assistant'
const serviceName = 'assistant'
const dependencies = kubernetesDependencies(GUIDED_CLUSTER_ID, namespace, deploymentName, serviceName, { sourceSensitive: true })

const requestScenario = requireReplacement => ({
  kind: 'aks-request', version: 1,
  target: { clusterId: GUIDED_CLUSTER_ID, namespace, serviceName, deploymentName },
  request: { method: 'GET', path: '/api/info' },
  expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } },
  requireTwoReplicas: true,
  requireReplacement,
})

export const aksDeployGuidedLab = {
  id: 'aks-deploy-guided', title: 'Deploy a Python service to AKS', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 35,
  brief: 'Build and publish a small Python service, connect AKS to its private registry, deploy it with Kubernetes manifests, and verify how a Deployment replaces a failed Pod.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 1, labMode: 'guided',
  manifestId: FOUNDATION_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true },
  initialProjectFiles: FOUNDATION_FILES,
  solutionFiles: guidedSolutionFiles,
  solutionActionResolvers: { 'delete-first-owned-pod': solutionAction },
  stages: [
    { id: 'prepare', title: 'Prepare', taskIds: ['python-source', 'dockerfile'] },
    { id: 'publish', title: 'Publish and connect', taskIds: ['publish', 'cluster', 'registry-access'] },
    { id: 'deploy', title: 'Deploy', taskIds: ['deployment', 'info'] },
    { id: 'recover', title: 'Verify recovery', taskIds: ['replacement'] },
  ],
  scenarios: {
    'guided-info': requestScenario(false),
    'guided-replacement': requestScenario(true),
  },
  tasks: [
    {
      id: 'python-source', stageId: 'prepare',
      text: 'Save `app.py` so `GET /api/info` reports service `knowledge-assistant`, version `1.0`, and reads `APP_ENV` with a development default.',
      explanation: 'The application defines the response contract. Reading APP_ENV at request time lets the same image report the environment supplied by Kubernetes.',
      check: guidedPythonReady,
      hints: ['Open `app.py` in Files and save the source; a draft alone is not part of a build.', 'Keep the `os.environ.get("APP_ENV", "development")` expression so the running container can supply the environment value.'],
      solution: file('app.py'),
      examNote: 'A configuration lookup keeps environment-specific values outside the application image.',
    },
    {
      id: 'dockerfile', stageId: 'prepare',
      text: 'Save a supported Python 3.12 Dockerfile that copies the service files and exposes its 8080 listener.',
      explanation: 'The Dockerfile records the base image, working directory, source files, listener port, and server command used by the simulated build.',
      check: guidedDockerReady,
      hints: ['Edit and save `Dockerfile`; Kubernetes does not build this file when it applies a manifest.', 'Use the taught sequence: `FROM`, `WORKDIR`, `COPY app.py server.py ./`, `EXPOSE 8080`, then `CMD ["python", "server.py"]`.'],
      solution: file('Dockerfile'),
      examNote: 'The container listener and Kubernetes Service targetPort must refer to the same application port.',
    },
    {
      id: 'publish', stageId: 'publish',
      text: 'Create `rg-aks-guided` and the private Basic registry `acraksguided`, then build and publish `assistant:v1` from the saved project.',
      explanation: 'The resource group owns the registry. ACR build captures the saved Python and Dockerfile inputs in an immutable simulated artifact; unsaved edits do not change that artifact.',
      check: context => !!guidedPublishedArtifact(context),
      hints: ['A registry stores tagged images; the build reads saved project files and requires a valid Dockerfile and Python source.', 'Create the group and registry, then run `az acr build -r acraksguided -t assistant:v1 .`.'],
      solution: command(
        `az group create -n ${GUIDED_GROUP} -l eastus`,
        `az acr create -g ${GUIDED_GROUP} -n ${GUIDED_REGISTRY} --sku Basic`,
        `az acr build -r ${GUIDED_REGISTRY} -t assistant:v1 .`,
      ),
      examNote: 'A tag points to a particular build artifact. Rebuilding a tag changes future pulls, while already running Pods keep their captured image.',
    },
    {
      id: 'cluster', stageId: 'publish',
      text: 'Create `aks-guided` in East US with two `Standard_D2s_v5` nodes and connect kubectl to that cluster.',
      explanation: 'AKS manages the Kubernetes control plane and node pool. `get-credentials` writes a simulated context for kubectl; it does not create an application Deployment.',
      check: guidedClusterReady,
      hints: ['The cluster belongs to `rg-aks-guided`; choose two nodes and the supported VM size.', 'Use managed identity and simulated SSH-key generation, then run `az aks get-credentials` and inspect the current context and nodes.'],
      solution: command(
        `az aks create -g ${GUIDED_GROUP} -n aks-guided --location eastus --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys`,
        `az aks get-credentials -g ${GUIDED_GROUP} -n aks-guided`,
        'kubectl config current-context',
        'kubectl get nodes',
      ),
      examNote: 'The kube context identifies the cluster receiving kubectl commands. A node is a VM in the cluster that can host Pods.',
    },
    {
      id: 'registry-access', stageId: 'publish',
      text: 'Give the cluster kubelet identity exact `AcrPull` access to `acraksguided` so new Pods can pull the private image.',
      explanation: 'The kubelet pulls images for Pods. AKS attaches a registry-scoped AcrPull grant to its kubelet identity, avoiding an admin password in the Deployment.',
      check: guidedRegistryAccessReady,
      hints: ['The cluster has a kubelet identity distinct from its control-plane identity.', 'Attach this registry with `az aks update -g rg-aks-guided -n aks-guided --attach-acr acraksguided`.'],
      solution: command(`az aks update -g ${GUIDED_GROUP} -n aks-guided --attach-acr ${GUIDED_REGISTRY}`),
      examNote: 'Grant AcrPull to the kubelet identity at the intended registry scope. Do not put registry admin credentials in a Pod manifest.',
    },
    {
      id: 'deployment', stageId: 'deploy',
      text: 'Save and apply the Namespace, two-replica Deployment, and Service manifests for `assistant`; run the Pods with `assistant:v1` and `APP_ENV=training`.',
      explanation: 'A Namespace separates names. A Deployment declares desired replicas and creates/reconciles ReplicaSets and Pods. A Pod is the scheduling unit containing a container; a Service selects Pods by labels and maps port 80 to the named HTTP listener on 8080.',
      check: guidedDeploymentReady,
      hints: ['Apply the Namespace before namespaced resources. Apply uses saved YAML; drafts are not applied.', 'The Deployment needs two replicas, matching selector and Pod labels, the published image, and `APP_ENV=training`. The Service selector and targetPort must reach those Pods.'],
      solution: { steps: [
        ...['k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'].map(path => ({ kind: 'file', path, content: guidedSolutionFiles[path] })),
        ...['kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/service.yaml',
          'kubectl get deployments -n assistant', 'kubectl get replicasets -n assistant', 'kubectl get pods -n assistant',
          'kubectl rollout status deployment/assistant -n assistant'].map(line => ({ kind: 'command', line })),
      ] },
      examNote: 'The Deployment owns ReplicaSets, which own Pods. The Service is a stable route to matching ready Pods; it does not own or start them.',
    },
    {
      id: 'info', stageId: 'deploy',
      text: 'Send the guided `GET /api/info` request and confirm HTTP 200 with service `knowledge-assistant`, version `1.0`, and environment `training`.',
      explanation: 'The response comes from the captured image and environment in a running Pod, routed through the Service. It provides evidence that saved source, build, image pull, Deployment, labels, and ports work together.',
      check: guidedDeploymentReady,
      dependencies,
      verification: { scenarioId: 'guided-info', scenarioVersion: 1 },
      hints: ['Use Experiments to choose the declared `guided-info` request after the Pods are Ready.', 'Check that the Service selects the assistant Pods and targets their named port; the expected response is derived from the running image and APP_ENV.'],
      solution: { steps: [{ kind: 'scenario', scenarioId: 'guided-info', instruction: 'Send the guided GET /api/info request and inspect its response.' }] },
      examNote: 'A successful request tests the current captured application and route, rather than only the desired YAML.',
    },
    {
      id: 'replacement', stageId: 'recover',
      text: 'Delete one managed assistant Pod, observe its replacement, then verify both the service response and replacement evidence.',
      explanation: 'A Pod is replaceable. The Deployment keeps its desired replica count, and its ReplicaSet creates a new Pod when one it owns is deleted. The replacement gets a new Pod UID while preserving the current template.',
      check: guidedDeploymentReady,
      dependencies,
      verification: { scenarioId: 'guided-replacement', scenarioVersion: 1 },
      hints: ['Inspect `kubectl get pods -n assistant` and identify a Pod owned by the assistant ReplicaSet before deleting it.', 'Delete exactly one managed assistant Pod with `kubectl delete pod POD_NAME -n assistant`, then request `guided-info` again followed by `guided-replacement`.'],
      solution: { steps: [
        { kind: 'inspect', resource: 'pods', command: 'kubectl get pods -n assistant', instruction: 'Inspect the assistant Pods and identify one owned by the Deployment.', explanation: 'Identify one Pod owned by the assistant Deployment.' },
        { kind: 'command', resolver: 'delete-first-owned-pod', line: 'kubectl delete pod POD_NAME -n assistant', instruction: 'Replace POD_NAME with one assistant Pod you inspected.' },
        { kind: 'scenario', scenarioId: 'guided-info', instruction: 'Recheck GET /api/info on the replacement Pod.' },
        { kind: 'scenario', scenarioId: 'guided-replacement', instruction: 'Verify the replacement outcome in Experiments.' },
      ] },
      examNote: 'A Deployment replaces Pods to maintain desired state. Verify a fresh Pod under the current template; an old successful request cannot prove recovery.',
    },
  ],
}

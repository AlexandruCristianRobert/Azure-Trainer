import { FOUNDATION_MANIFEST, FOUNDATION_SOLUTION_FILES } from '../../templates/aks-python/foundation.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { parsePythonDockerfile } from '../../../lib/project/python-dockerfile.js'
import { selectBuildFiles, projectSourceHash } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { ACR_PULL_ROLE_ID } from '../../../lib/sandbox/roleAssignments.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { TROUBLESHOOTING_CLUSTER, TROUBLESHOOTING_GROUP, TROUBLESHOOTING_IMAGE, TROUBLESHOOTING_REGISTRY, troubleshootingSolutionFiles } from './deployment-seeds.js'

export const GUIDED_GROUP = 'rg-aks-guided'
export const GUIDED_REGISTRY = 'acraksguided'
export const GUIDED_CLUSTER = 'aks-guided'
export const GUIDED_IMAGE = `${GUIDED_REGISTRY}.azurecr.io/assistant:v1`
export const GUIDED_CLUSTER_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${GUIDED_GROUP}/providers/Microsoft.ContainerService/managedClusters/${GUIDED_CLUSTER}`

const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
const hasLabels = (actual, expected) => Object.entries(expected ?? {}).every(([key, value]) => actual?.[key] === value)

export function guidedRegistry(context) {
  return context.sandbox.containerRegistries?.find(item => same(item.name, GUIDED_REGISTRY) && same(item.resourceGroup, GUIDED_GROUP)) ?? null
}

export function guidedCluster(context) {
  return context.sandbox.aksClusters?.find(item => same(item.name, GUIDED_CLUSTER) && same(item.resourceGroup, GUIDED_GROUP)) ?? null
}

export function guidedPublishedArtifact(context) {
  const registry = guidedRegistry(context)
  if (!registry) return null
  const image = `${registry.loginServer}/assistant:v1`.toLowerCase()
  const id = context.artifacts.publishedTags?.[image]
  const artifact = id ? context.artifacts.buildsById?.[id] : null
  const currentFiles = selectBuildFiles(context.project.savedFiles, FOUNDATION_MANIFEST)
  return artifact?.id === id && artifact.image.registryId === registry.id
    && same(artifact.image.loginServer, registry.loginServer)
    && artifact.image.repository === 'assistant' && artifact.image.tag === 'v1'
    && artifact.sourceHash === projectSourceHash(currentFiles) ? artifact : null
}

export function guidedPythonReady(context) {
  const { appSpec, diagnostics } = parsePythonProject(context.project.savedFiles, FOUNDATION_MANIFEST)
  return !diagnostics.length && appSpec?.service === 'knowledge-assistant' && appSpec.version === '1.0'
    && appSpec.routes.some(route => route.method === 'GET' && route.path === '/api/info'
      && route.response.environment?.kind === 'config' && route.response.environment.key === 'APP_ENV'
      && route.response.environment.defaultValue === 'development')
}

export function guidedDockerReady(context) {
  const result = parsePythonDockerfile(context.project.savedFiles.Dockerfile, { buildFiles: FOUNDATION_MANIFEST.buildFiles })
  return !result.diagnostics.length && result.dockerSpec?.listeningPort === 8080
}

export function guidedClusterReady(context) {
  const cluster = guidedCluster(context)
  if (!cluster || cluster.location !== 'eastus' || cluster.nodeCount !== 2 || cluster.nodeVmSize !== 'Standard_D2s_v5') return false
  if (cluster.identity?.type !== 'SystemAssigned' || !cluster.identity.principalId
    || !cluster.identityProfile?.kubeletidentity?.resourceId
    || !cluster.identityProfile.kubeletidentity.clientId || !cluster.identityProfile.kubeletidentity.objectId) return false
  const current = context.runtime.kubernetes?.currentContext
  return !!current && context.runtime.kubernetes.contexts?.[current]?.clusterId === cluster.id
}

export function guidedRegistryAccessReady(context) {
  const registry = guidedRegistry(context), cluster = guidedCluster(context)
  if (!registry || !cluster) return false
  return context.sandbox.roleAssignments?.some(assignment => assignment.roleName === 'AcrPull'
    && same(assignment.roleDefinitionId, ACR_PULL_ROLE_ID)
    && same(assignment.scope, registry.id)
    && same(assignment.principalId, cluster.identityProfile?.kubeletidentity?.objectId)) === true
}

export function guidedDeploymentReady(context) {
  const cluster = guidedCluster(context), artifact = guidedPublishedArtifact(context)
  if (!cluster || !artifact) return false
  const state = context.runtime.kubernetes?.clusters?.[cluster.id]
  const resources = state?.resources ?? {}
  const namespace = resources['Namespace//assistant']
  const deployment = resources['Deployment/assistant/assistant']
  const service = resources['Service/assistant/assistant']
  if (!namespace || !deployment || !service || deployment.spec.replicas !== 2) return false
  const selector = deployment.spec.selector?.matchLabels
  const templateLabels = deployment.spec.template?.metadata?.labels
  const serviceSelector = service.spec?.selector
  if (!selector || !Object.keys(selector).length || !hasLabels(templateLabels, selector)
    || !serviceSelector || !Object.keys(serviceSelector).length) return false
  const container = deployment.spec.template.spec?.containers?.[0]
  if (container?.image?.toLowerCase() !== GUIDED_IMAGE.toLowerCase()
    || container.env?.find(item => item.name === 'APP_ENV')?.value !== 'training') return false
  const targetPort = service.spec.ports?.[0]?.targetPort
  const servicePort = service.spec.ports?.[0]?.port
  const listener = typeof targetPort === 'number' ? targetPort
    : container.ports?.find(port => port.name === targetPort)?.containerPort
  if (servicePort !== 80 || listener !== 8080) return false
  const pods = getDeploymentPods({ runtime: context.runtime }, cluster.id, 'assistant', 'assistant')
  return pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running'
    && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
    && pod.metadata.namespace === 'assistant' && hasLabels(pod.metadata.labels, selector)
    && hasLabels(pod.metadata.labels, serviceSelector)
    && state.podSnapshots[pod.metadata.uid]?.artifactId === artifact.id
    && state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'training')
}

export function solutionAction(run, lab, task, resolver) {
  if (resolver !== 'delete-first-owned-pod' || task.id !== 'replacement'
    || lab.id !== 'aks-deploy-guided') throw new Error('The guided solution action is not available.')
  const cluster = run.sandbox.aksClusters?.find(item => item.name === 'aks-guided' && item.resourceGroup === 'rg-aks-guided')
  const pod = cluster && getDeploymentPods(run, cluster.id, 'assistant', 'assistant')
    .filter(item => item.metadata.namespace === 'assistant')[0]
  if (!pod) throw new Error('No Pod owned by the guided assistant Deployment is available to replace.')
  return { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }
}

export const guidedSolutionFiles = FOUNDATION_SOLUTION_FILES

const troubleshootingSame = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
const troubleshootingClusterId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${TROUBLESHOOTING_CLUSTER}`

function troubleshootingCluster(context) {
  return context.sandbox.aksClusters?.find(item => troubleshootingSame(item.name, TROUBLESHOOTING_CLUSTER) && troubleshootingSame(item.resourceGroup, TROUBLESHOOTING_GROUP)) ?? null
}

function troubleshootingSavedFilesReady(context) {
  return Object.entries(troubleshootingSolutionFiles).filter(([path]) => path.startsWith('k8s/')).every(([path, expected]) => {
    const parsed = parseKubernetesYaml(context.project.savedFiles[path] ?? '', path)
    const expectedParsed = parseKubernetesYaml(expected, path)
    return !parsed.diagnostics.length && !expectedParsed.diagnostics.length
      && canonicalize(parsed.documents) === canonicalize(expectedParsed.documents)
  })
}

function expectedObject(path) {
  return parseKubernetesYaml(troubleshootingSolutionFiles[path], path).documents[0]
}

function comparableObject(object) {
  return object && { apiVersion: object.apiVersion, kind: object.kind,
    metadata: { name: object.metadata?.name, ...(object.metadata?.namespace ? { namespace: object.metadata.namespace } : {}) },
    ...(object.spec ? { spec: object.spec } : {}) }
}

export function troubleshootingContextReady(context) {
  const cluster = troubleshootingCluster(context)
  const current = context.runtime.kubernetes?.currentContext
  return !!cluster && context.runtime.kubernetes?.contexts?.[current]?.clusterId === cluster.id
    && context.runtime.kubernetes.contexts[current]?.namespace === 'assistant'
}

export function troubleshootingPublishedImageReady(context) {
  const cluster = troubleshootingCluster(context)
  const registry = context.sandbox.containerRegistries?.find(item => troubleshootingSame(item.name, TROUBLESHOOTING_REGISTRY)
    && troubleshootingSame(item.resourceGroup, TROUBLESHOOTING_GROUP))
  const artifactId = context.artifacts.publishedTags?.[TROUBLESHOOTING_IMAGE.toLowerCase()]
  const deployment = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]?.resources['Deployment/assistant/assistant']
  return !!registry && !!artifactId && context.artifacts.buildsById?.[artifactId]?.image?.registryId === registry.id
    && deployment?.spec?.template?.spec?.containers?.[0]?.image?.toLowerCase() === TROUBLESHOOTING_IMAGE.toLowerCase()
}

export function troubleshootingRegistryAccessReady(context) {
  const registry = context.sandbox.containerRegistries?.find(item => troubleshootingSame(item.name, TROUBLESHOOTING_REGISTRY)
    && troubleshootingSame(item.resourceGroup, TROUBLESHOOTING_GROUP))
  const cluster = troubleshootingCluster(context)
  return !!registry && !!cluster && context.sandbox.roleAssignments?.some(assignment => assignment.roleName === 'AcrPull'
    && troubleshootingSame(assignment.roleDefinitionId, ACR_PULL_ROLE_ID) && troubleshootingSame(assignment.scope, registry.id)
    && troubleshootingSame(assignment.principalId, cluster.identityProfile?.kubeletidentity?.objectId)) === true
}

export function troubleshootingRepairedManifestsReady(context) {
  const cluster = troubleshootingCluster(context)
  if (!cluster || !troubleshootingSavedFilesReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[cluster.id]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const service = state?.resources['Service/assistant/assistant']
  const namespace = state?.resources['Namespace//assistant']
  return !!namespace && !!deployment && !!service && deployment.spec?.replicas === 2
    && canonicalize(comparableObject(namespace)) === canonicalize(expectedObject('k8s/namespace.yaml'))
    && canonicalize(comparableObject(deployment)) === canonicalize(expectedObject('k8s/deployment.yaml'))
    && canonicalize(comparableObject(service)) === canonicalize(expectedObject('k8s/service.yaml'))
    && deployment.spec.template.spec?.containers?.[0]?.image?.toLowerCase() === TROUBLESHOOTING_IMAGE.toLowerCase()
    && deployment.spec.template.spec?.containers?.[0]?.env?.some(item => item.name === 'APP_ENV' && item.value === 'training')
}

export function troubleshootingRecoveryReady(context) {
  const cluster = troubleshootingCluster(context)
  if (!cluster || !troubleshootingContextReady(context) || !troubleshootingRepairedManifestsReady(context)
    || !troubleshootingPublishedImageReady(context) || !troubleshootingRegistryAccessReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[cluster.id]
  if (state?.resources['Deployment/staging/assistant'] || state?.resources['Service/staging/assistant']) return false
  const pods = getDeploymentPods({ runtime: context.runtime }, troubleshootingClusterId, 'assistant', 'assistant')
  return pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running'
    && state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'training')
}

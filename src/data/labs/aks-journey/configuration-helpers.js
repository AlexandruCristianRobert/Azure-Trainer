import { CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../../templates/aks-python/configuration.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parseKubernetesYaml } from '../../../lib/kubernetes/yaml.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { CONFIG_INDEPENDENT_FILES } from '../../templates/aks-python/configuration-independent.js'

export const CONFIG_GROUP = 'rg-aks-config-guided'
export const CONFIG_REGISTRY = 'acraksconfigguided'
export const CONFIG_CLUSTER = 'aks-config-guided'
export const CONFIG_IMAGE = `${CONFIG_REGISTRY}.azurecr.io/assistant:configured`
export const CONFIG_INDEPENDENT_GROUP = 'rg-aks-config-independent'
export const CONFIG_INDEPENDENT_REGISTRY = 'acraksconfigindependent'
export const CONFIG_INDEPENDENT_CLUSTER = 'aks-config-independent'
export const CONFIG_INDEPENDENT_IMAGE = `${CONFIG_INDEPENDENT_REGISTRY}.azurecr.io/assistant:shared`

export function configurationSourceReady(context) {
  const parsed = parsePythonProject(context.project.savedFiles, CONFIG_MANIFEST)
  return !parsed.diagnostics.length && parsed.appSpec?.routes?.some(route => route.method === 'POST' && route.path === '/api/ask'
    && route.response?.settings?.pg_host?.key === 'PGHOST')
}

export function configurationDeploymentReady(context) {
  const cluster = context.sandbox.aksClusters?.find(item => item.name === CONFIG_CLUSTER)
  const state = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const service = state?.resources['Service/assistant/assistant']
  const config = state?.resources['ConfigMap/assistant/assistant-config']
  const secret = state?.resources['Secret/assistant/assistant-credentials']
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = context.artifacts.publishedTags?.[CONFIG_IMAGE]
  const pods = cluster ? getDeploymentPods({ runtime: context.runtime }, cluster.id, 'assistant', 'assistant') : []
  return !!deployment && !!service && !!config && !!secret && image === CONFIG_IMAGE && !!artifactId && pods.length === 2
    && pods.every(pod => pod.status?.phase === 'Running' && !!state.podSnapshots[pod.metadata.uid])
}

export function configurationEnvironmentRefreshed(context) {
  const cluster = context.sandbox.aksClusters?.find(item => item.name === CONFIG_CLUSTER)
  const state = cluster && context.runtime.kubernetes?.clusters?.[cluster.id]
  const pods = cluster ? getDeploymentPods({ runtime: context.runtime }, cluster.id, 'assistant', 'assistant') : []
  return configurationDeploymentReady(context) && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.environment?.APP_ENV === 'training-updated')
    && state.receipts?.some(receipt => receipt.replacementPodUid)
}

export const configurationSolutionFiles = CONFIG_SOLUTION_FILES

const independentId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONFIG_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONFIG_INDEPENDENT_CLUSTER}`
const doc = (context, path) => {
  const parsed = parseKubernetesYaml(context.project.savedFiles[path] ?? '', path)
  return parsed.diagnostics.length || parsed.documents.length !== 1 ? null : parsed.documents[0]
}
const same = (a, b) => canonicalize(a) === canonicalize(b)
const keyRef = (env, name, kind, object, key) => env?.find(item => item.name === name)?.valueFrom?.[kind]?.name === object
  && env.find(item => item.name === name).valueFrom[kind].key === key
const expectedReview = { APP_ENV: 'review', AI_ENDPOINT: 'https://ai-review.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1', PGHOST: 'pg-review.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_review', COLLECTION: 'review' }

export function configurationIndependentReviewConfigReady(context) {
  const namespace = doc(context, 'k8s/review-namespace.yaml')
  const config = doc(context, 'k8s/review-configmap.yaml')
  const secret = doc(context, 'k8s/review-secret.yaml')
  if (namespace?.kind !== 'Namespace' || namespace.metadata?.name !== 'review' || config?.kind !== 'ConfigMap'
    || config.metadata?.name !== 'review-config' || config.metadata?.namespace !== 'review' || secret?.kind !== 'Secret'
    || secret.metadata?.name !== 'review-credentials' || secret.metadata?.namespace !== 'review'
    || !Object.entries(expectedReview).every(([key, value]) => config.data?.[key] === value)) return false
  try {
    const settings = JSON.parse(config.data?.['settings.json'] ?? '')
    return settings.display_name === 'Review assistant' && settings.response_prefix === '[Review] '
      && (secret.stringData?.PGPASSWORD === 'review-only-password' || secret.data?.PGPASSWORD === 'cmV2aWV3LW9ubHktcGFzc3dvcmQ=')
  } catch { return false }
}

export function configurationIndependentReviewManifestsReady(context) {
  if (!configurationIndependentReviewConfigReady(context)) return false
  const deployment = doc(context, 'k8s/review-deployment.yaml'); const service = doc(context, 'k8s/review-service.yaml')
  const container = deployment?.spec?.template?.spec?.containers?.[0]; const env = container?.env
  const labels = deployment?.spec?.template?.metadata?.labels; const selector = deployment?.spec?.selector?.matchLabels
  const settings = container?.volumeMounts?.find(item => item.mountPath === '/etc/assistant' && item.readOnly === true)
  const volume = deployment?.spec?.template?.spec?.volumes?.find(item => item.name === settings?.name)?.configMap
  return deployment?.kind === 'Deployment' && deployment.metadata?.name === 'review-assistant' && deployment.metadata?.namespace === 'review'
    && deployment.spec?.replicas === 2 && container?.image === CONFIG_INDEPENDENT_IMAGE && labels?.app === 'review-assistant'
    && selector?.app === 'review-assistant' && ['APP_ENV', 'AI_ENDPOINT', 'ANSWER_DEPLOYMENT', 'EMBEDDING_DEPLOYMENT', 'PGHOST', 'PGDATABASE', 'PGUSER', 'COLLECTION'].every(key => keyRef(env, key, 'configMapKeyRef', 'review-config', key))
    && keyRef(env, 'PGPASSWORD', 'secretKeyRef', 'review-credentials', 'PGPASSWORD') && volume?.name === 'review-config'
    && volume.items?.some(item => item.key === 'settings.json' && item.path === 'settings.json')
    && service?.kind === 'Service' && service.metadata?.name === 'review-assistant' && service.metadata?.namespace === 'review'
    && service.spec?.selector?.app === 'review-assistant' && service.spec?.ports?.[0]?.port === 80 && service.spec.ports[0].targetPort === 'http'
}

export function configurationIndependentSharedArtifactReady(context) {
  if (!configurationIndependentReviewManifestsReady(context)) return false
  const state = context.runtime.kubernetes?.clusters?.[independentId]; const fixture = context.runtime.kubernetes?.configurationIndependent
  const deployment = state?.resources['Deployment/review/review-assistant']; const service = state?.resources['Service/review/review-assistant']
  const expectedDeployment = doc(context, 'k8s/review-deployment.yaml'); const expectedService = doc(context, 'k8s/review-service.yaml')
  const pods = getDeploymentPods({ runtime: context.runtime }, independentId, 'review', 'review-assistant')
  return !!fixture?.artifactId && same(deployment?.spec, expectedDeployment?.spec) && same(service?.spec, expectedService?.spec)
    && ['Namespace//review', 'ConfigMap/review/review-config', 'Secret/review/review-credentials'].every(key => !!state?.resources[key])
    && pods.length === 2 && pods.every(pod => pod.status?.phase === 'Running' && state.podSnapshots[pod.metadata.uid]?.artifactId === fixture.artifactId)
}

export function configurationIndependentPrimaryReady(context) {
  const state = context.runtime.kubernetes?.clusters?.[independentId]; const fixture = context.runtime.kubernetes?.configurationIndependent
  if (!fixture?.artifactId || !['app.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml']
    .every(path => context.project.savedFiles[path] === CONFIG_INDEPENDENT_FILES[path])) return false
  const expected = Object.fromEntries(['primary-configmap', 'primary-secret', 'primary-deployment', 'primary-service'].map(name => [name, doc({ project: { savedFiles: CONFIG_INDEPENDENT_FILES } }, `k8s/${name}.yaml`)]))
  const pods = getDeploymentPods({ runtime: context.runtime }, independentId, 'primary', 'assistant')
  return !!state?.resources['Namespace//primary'] && same(state.resources['ConfigMap/primary/assistant-config']?.data, expected['primary-configmap']?.data)
    && state.resources['Secret/primary/assistant-credentials']?.data?.PGPASSWORD === 'dHJhaW5pbmctb25seS1wYXNzd29yZA=='
    && same(state.resources['Deployment/primary/assistant']?.spec, expected['primary-deployment']?.spec)
    && same(state.resources['Service/primary/assistant']?.spec, expected['primary-service']?.spec)
    && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.artifactId === fixture.artifactId)
}

export function configurationIndependentPrimaryDependencies(clusterId = independentId) {
  return { [`aks-independent-primary:${clusterId}`]: context => ({
    saved: Object.fromEntries(['app.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml'].map(path => [path, context.project.savedFiles[path]])),
    resources: Object.fromEntries(['Namespace//primary', 'ConfigMap/primary/assistant-config', 'Secret/primary/assistant-credentials', 'Deployment/primary/assistant', 'Service/primary/assistant'].map(key => [key, context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.[key] ?? null])),
    pods: getDeploymentPods({ runtime: context.runtime }, clusterId, 'primary', 'assistant').map(pod => ({ uid: pod.metadata.uid, artifactId: context.runtime.kubernetes?.clusters?.[clusterId]?.podSnapshots?.[pod.metadata.uid]?.artifactId ?? null })),
  }) }
}

export function configurationIndependentReviewDependencies(clusterId = independentId) {
  return { [`aks-independent-review:${clusterId}`]: context => ({
    saved: Object.fromEntries(['k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml', 'k8s/review-deployment.yaml', 'k8s/review-service.yaml'].map(path => [path, context.project.savedFiles[path]])),
    resources: Object.fromEntries(['Namespace//review', 'ConfigMap/review/review-config', 'Secret/review/review-credentials', 'Deployment/review/review-assistant', 'Service/review/review-assistant'].map(key => [key, context.runtime.kubernetes?.clusters?.[clusterId]?.resources?.[key] ?? null])),
    pods: getDeploymentPods({ runtime: context.runtime }, clusterId, 'review', 'review-assistant').map(pod => ({ uid: pod.metadata.uid, artifactId: context.runtime.kubernetes?.clusters?.[clusterId]?.podSnapshots?.[pod.metadata.uid]?.artifactId ?? null })),
  }) }
}

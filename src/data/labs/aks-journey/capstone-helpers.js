import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { ACR_PULL_ROLE_ID } from '../../../lib/sandbox/roleAssignments.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../../templates/aks-python/capstone.js'
import { INTEGRATION_FIXTURES } from '../../fixtures/aks/integration.js'

export const CAPSTONE_GROUP = 'rg-aks-capstone'
export const CAPSTONE_REGISTRY = 'acrakscapstone'
export const CAPSTONE_CLUSTER = 'aks-capstone'
export const CAPSTONE_CLUSTER_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${CAPSTONE_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CAPSTONE_CLUSTER}`
export const CAPSTONE_IMAGE = `${CAPSTONE_REGISTRY}.azurecr.io/assistant:capstone-v1`
export const CAPSTONE_HPA_DISABLED = '# HPA exercise complete; final deployment uses two fixed replicas.\n'
export const CAPSTONE_TARGET = Object.freeze({ clusterId: CAPSTONE_CLUSTER_ID, namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' })
export const CAPSTONE_EXTERNAL = Object.freeze({ ...CAPSTONE_TARGET, serviceName: 'assistant-external' })

export const capstoneCommand = line => ({ kind: 'command', line })
export const capstoneFile = (path, variant = 'v1') => ({ kind: 'file', path, content: CAPSTONE_SOLUTION_FILES[variant][path] })
export const capstoneVerify = id => ({ kind: 'scenario', action: { type: 'aks-request', scenarioId: `capstone-${id}` } })
export const capstoneAdvance = seconds => ({ kind: 'scenario', action: { type: 'aks-advance', seconds } })
export const capstoneSolution = (...steps) => ({ steps })

export function capstoneArtifactMatches(build, version) {
  return !!build && build.image?.loginServer === `${CAPSTONE_REGISTRY}.azurecr.io`
    && build.image.repository === 'assistant' && typeof build.image.tag === 'string'
    && build.appSpec?.version === version
}
export function capstonePublication(run, version, { deployed = false } = {}) {
  const desired = run.runtime.kubernetes.clusters[CAPSTONE_CLUSTER_ID]?.resources['Deployment/assistant/assistant-api']?.spec.template.spec.containers[0].image
  const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, CAPSTONE_MANIFEST))
  const references = deployed ? [desired] : [desired, ...Object.keys(run.artifacts.publishedTags).reverse()]
  const v1EvidenceId = version === '2.0' && run.stages.sealedStages.find(stage => stage.stageId === 'provision')?.evidenceIds
    .find(id => run.evidence.experimentsById[id]?.taskId === 'image-v1')
  const v1Tuple = v1EvidenceId && run.evidence.aksCapstoneReceipts[`aks-proof-${v1EvidenceId}`]?.artifacts[0]
  const v1 = v1Tuple && run.artifacts.buildsById[v1Tuple.buildId]
  for (const image of references) {
    const buildId = run.artifacts.publishedTags[image], build = run.artifacts.buildsById[buildId]
    if (version === '2.0' && (!v1 || v1.sourceHash !== v1Tuple.sourceHash || v1.digest !== v1Tuple.digest
      || build?.id === v1.id || build?.image?.tag === v1.image.tag || build?.digest === v1.digest || build?.sourceHash === v1.sourceHash)) continue
    if (capstoneArtifactMatches(build, version) && build.sourceHash === sourceHash
      && image === `${build.image.loginServer}/${build.image.repository}:${build.image.tag}`)
      return { image, buildId, build, sourceHash }
  }
  return null
}

/** Current source and the image captured by each desired Pod must agree. */
export function capstoneLive(run, { replicas = 2 } = {}) {
  const cluster = run.sandbox.aksClusters.find(item => item.id === CAPSTONE_CLUSTER_ID)
  const registry = run.sandbox.containerRegistries.find(item => item.name === CAPSTONE_REGISTRY && item.resourceGroup === CAPSTONE_GROUP)
  const context = run.runtime.kubernetes.contexts[run.runtime.kubernetes.currentContext]
  const state = run.runtime.kubernetes.clusters[CAPSTONE_CLUSTER_ID]
  const resources = state?.resources ?? {}
  const deployment = resources['Deployment/assistant/assistant-api']
  const container = deployment?.spec?.template?.spec?.containers?.[0]
  const image = container?.image
  const publication = capstonePublication(run, '1.0')
  const buildId = publication?.buildId, build = publication?.build
  const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, CAPSTONE_MANIFEST))
  const pods = state && getDeploymentPods(run, CAPSTONE_CLUSTER_ID, 'assistant', 'assistant-api') || []
  const grant = cluster && registry && run.sandbox.roleAssignments.some(item => item.scope?.toLowerCase() === registry.id.toLowerCase()
    && item.principalId?.toLowerCase() === cluster.identityProfile?.kubeletidentity?.objectId?.toLowerCase()
    && item.roleDefinitionId === ACR_PULL_ROLE_ID)
  const namespace = resources['Namespace//assistant']
  const clusterReady = cluster?.nodeCount === 2 && cluster.nodeVmSize === 'Standard_D2s_v5'
    && cluster.location === 'westeurope' && cluster.provisioningState === 'Succeeded'
    && cluster.identity?.type === 'SystemAssigned'
  const config = resources['ConfigMap/assistant/assistant-config']
  const secret = resources['Secret/assistant/assistant-credentials']
  const internal = resources['Service/assistant/assistant-internal']
  const external = resources['Service/assistant/assistant-external']
  const profile = { ...INTEGRATION_FIXTURES.profiles.training, APP_ENV: 'training' }
  const expectedRefs = Object.keys(profile)
  const probes = ['startup', 'readiness', 'liveness'].every(type =>
    container?.[`${type}Probe`]?.httpGet?.path === `/health/${type === 'readiness' ? 'ready' : type === 'liveness' ? 'live' : type}`
    && container[`${type}Probe`].httpGet.port === 'http')
  const sized = container?.ports?.some(port => port.name === 'http' && port.containerPort === 8080)
    && container.resources?.requests?.cpu === '250m' && container.resources.requests.memory === '128Mi'
    && container.resources?.limits?.cpu === '500m' && container.resources.limits.memory === '256Mi'
  const releasePolicy = deployment?.spec?.strategy?.type === 'RollingUpdate'
    && deployment.spec.strategy.rollingUpdate?.maxSurge === 1
    && deployment.spec.strategy.rollingUpdate?.maxUnavailable === 0
    && deployment.spec.minReadySeconds === 5 && deployment.spec.progressDeadlineSeconds === 60
    && deployment.spec.revisionHistoryLimit === 3
  const expectedReplicas = replicas ?? deployment?.spec?.replicas
  const currentPods = !!deployment && pods.length === expectedReplicas && deployment.spec.replicas === expectedReplicas && pods.every(pod => {
    const snapshot = state.podSnapshots[pod.metadata.uid]
    return pod.status?.phase === 'Running' && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
      && snapshot?.artifactId === buildId && expectedRefs.every(key => snapshot.environment?.[key] === profile[key])
      && expectedRefs.every(key => snapshot.configRefs?.some(ref => ref.target === key
        && ref.kind === (key === 'PGPASSWORD' ? 'Secret' : 'ConfigMap')
        && ref.name === (key === 'PGPASSWORD' ? 'assistant-credentials' : 'assistant-config')
        && resources[`${ref.kind}/${ref.namespace}/${ref.name}`]?.metadata?.resourceVersion === ref.resourceVersion
        && (ref.kind === 'Secret' || snapshot.environment[key] === resources[`ConfigMap/${ref.namespace}/${ref.name}`]?.data?.[ref.key])))
  })
  const serviceReady = service => service?.spec?.ports?.[0]?.port === 80 && ['http', 8080].includes(service.spec.ports[0].targetPort)
    && service.spec.selector?.app === 'assistant'
  return { cluster, registry, context, state, deployment, buildId, build, sourceHash, pods,
    group: run.sandbox.resourceGroups.find(item => item.name === CAPSTONE_GROUP), grant, clusterReady, namespace, config, secret,
    internal, external, image, container, currentPods,
    sourceBuilt: !!build && build.sourceHash === sourceHash && image === publication.image,
    configured: !!config && !!secret && !!deployment && probes && sized && releasePolicy && currentPods,
    routed: currentPods && serviceReady(internal) && serviceReady(external) && external?.spec?.type === 'LoadBalancer'
      && !!external.status?.loadBalancer?.ingress?.[0]?.ip }
}

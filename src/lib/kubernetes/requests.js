import { getDeploymentPods } from './reconcile.js'
import { canonicalize } from '../labEngine/evidence.js'
import { tokenize } from '../az/tokenize.js'
import { simulateAssistant } from './assistant.js'
import { simulateIntegration } from './integration.js'
import { KNOWLEDGE_FIXTURES } from '../../data/fixtures/aks/knowledge.js'
import { INTEGRATION_FIXTURES } from '../../data/fixtures/aks/integration.js'
import { routeServiceRequest } from './connectivity.js'

const diagnostic = (code, message) => ({ code, message })
function hasPodDeleteCommand(history, name) {
  return history.some(line => {
    if (typeof line !== 'string') return false
    const tokens = tokenize(line).tokens ?? []
    if (tokens[0] !== 'kubectl' || tokens[1] !== 'delete') return false
    const positional = []
    for (let index = 2; index < tokens.length; index++) {
      const token = tokens[index]
      if (['-n', '--namespace', '--context'].includes(token)) { index++; continue }
      if (token.startsWith('--namespace=') || token.startsWith('--context=')) continue
      if (!token.startsWith('-')) positional.push(token)
    }
    return ['pod', 'pods'].includes(positional[0]) && positional[1] === name && positional.length === 2
  })
}

export function simulateKubernetesRequest(run, scenario) {
  const connectivity = scenario.connectivity
  if (run.runtime.kubernetes.clusters?.[scenario.target?.clusterId]?.connectivity && connectivity?.origin?.kind === 'diagnostic') {
    const clusterId = scenario.target.clusterId
    const state = run.runtime.kubernetes.clusters[clusterId]
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.namespace === connectivity.origin.namespace
      && item.metadata.name === connectivity.origin.name && state.connectivity.diagnosticPodUids.includes(item.metadata.uid))
    if (!pod) return { run, outcome: false, status: null, body: null, measurements: { transport: { ok: false, reason: 'INVALID_ORIGIN' } }, diagnostic: diagnostic('INVALID_ORIGIN', 'The supplied diagnostic Pod is unavailable.') }
    return simulateConnectivityScenario(run, scenario, { kind: 'pod', clusterId, podUid: pod.metadata.uid }, connectivity.hostname, connectivity.port)
  }
  if (run.runtime.kubernetes.clusters?.[scenario.target?.clusterId]?.connectivity && connectivity?.origin?.kind === 'external') {
    const clusterId = scenario.target.clusterId
    const service = run.runtime.kubernetes.clusters[clusterId].resources[`Service/${connectivity.service.namespace}/${connectivity.service.name}`]
    if (!service || service.spec.type !== 'LoadBalancer' || !service.status?.loadBalancer?.ingress?.[0]?.ip) return { run, outcome: false, status: null, body: null, measurements: { transport: { ok: false, reason: 'UNKNOWN_ADDRESS' } }, diagnostic: diagnostic('UNKNOWN_ADDRESS', 'The declared external Service has no allocated LoadBalancer address.') }
    return simulateConnectivityScenario(run, scenario, { kind: 'external', clusterId }, service.status.loadBalancer.ingress[0].ip, connectivity.port)
  }
  const route = scenario.route ?? scenario.connectivity
  if (run.runtime.kubernetes.clusters?.[scenario.target?.clusterId]?.connectivity
    && route && typeof route === 'object' && route.origin && (typeof route.hostname === 'string' || typeof route.externalService === 'string')) {
    const clusterId = scenario.target.clusterId
    const externalService = route.externalService && run.runtime.kubernetes.clusters[clusterId].resources[`Service/${scenario.target.namespace}/${route.externalService}`]
    const hostname = route.hostname ?? externalService?.status?.loadBalancer?.ingress?.[0]?.ip
    const routed = routeServiceRequest(run, { origin: route.origin, hostname, port: route.port ?? 80,
      method: scenario.request.method, path: scenario.request.path, body: scenario.request.body ?? null }, null)
    const latest = routed.run.runtime.kubernetes.requests.at(-1)
    if (latest?.id === routed.outcome.requestId) latest.scenarioId = scenario.id
    const outcome = routed.outcome
    const matches = outcome.status === scenario.expected.status && canonicalize(outcome.body) === canonicalize(scenario.expected.body)
      && outcome.transport.ok && !!outcome.route.podUid
    const measurements = { status: outcome.status, body: outcome.body, requestSequence: run.nextSequence, clusterId,
      namespace: scenario.target.namespace, serviceName: externalService?.metadata.name ?? route.serviceName ?? null,
      serviceVersion: externalService?.metadata.resourceVersion ?? null, deploymentName: scenario.target.deploymentName,
      deploymentGeneration: run.runtime.kubernetes.clusters[clusterId].resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]?.metadata.generation ?? null,
      selectedPodUid: outcome.route.podUid ?? null, podUid: outcome.route.podUid ?? null, artifactId: outcome.route.artifactId ?? null,
      selectedPods: outcome.route.podUid ? [{ uid: outcome.route.podUid, matchesExpected: matches }] : [],
      runningReplicaCount: outcome.route.readyEndpointUids?.length ?? 0, requiredReplicas: 1,
      diagnosticCode: outcome.transport.ok ? outcome.diagnostic?.code ?? null : outcome.transport.reason,
      request: scenario.request, dependencyTrace: outcome.dependencyTrace, transport: outcome.transport, route: outcome.route, simulated: true }
    return { run: routed.run, outcome: matches, status: outcome.status, body: outcome.body, measurements, diagnostic: outcome.diagnostic }
  }
  const { clusterId, namespace, serviceName, deploymentName } = scenario.target
  const cluster = run.runtime.kubernetes.clusters?.[clusterId]
  const resources = cluster?.resources ?? {}
  const service = resources[`Service/${namespace}/${serviceName}`]
  const deployment = resources[`Deployment/${namespace}/${deploymentName}`]
  let status = 503; let body = { error: 'ServiceUnavailable' }; let selected = []; let dependencyTrace = []; let integrationTrace = null
  let issue = diagnostic('SERVICE_NOT_FOUND', `Service '${serviceName}' was not found in namespace '${namespace}'.`)
  if (service) {
    const pods = getDeploymentPods(run, clusterId, namespace, deploymentName)
    const targets = pods.filter(pod => pod.status?.phase === 'Running' && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
      && Object.entries(service.spec.selector ?? {}).every(([key, value]) => pod.metadata.labels?.[key] === value))
      .sort((a, b) => {
        if (scenario.requireReplacement) {
          const replaced = new Set((cluster.receipts ?? []).filter(item => item.cause === 'pod-delete' && item.replacementPodUid)
            .map(item => item.replacementPodUid))
          if (replaced.has(a.metadata.uid) !== replaced.has(b.metadata.uid)) return replaced.has(a.metadata.uid) ? -1 : 1
        }
        return a.metadata.uid.localeCompare(b.metadata.uid)
      })
    selected = targets
    issue = diagnostic('NO_RUNNING_BACKENDS', 'The Service has no running, ready Pods selected in its namespace.')
    if (targets.length) {
      const pod = targets[0]; const container = pod.spec.containers[0]
      const port = service.spec.ports[0]; const resolved = typeof port.targetPort === 'number' ? port.targetPort
        : container.ports?.find(item => item.name === port.targetPort)?.containerPort
      const snapshot = cluster.podSnapshots[pod.metadata.uid]
      const artifact = snapshot && run.artifacts.buildsById[snapshot.artifactId]
      const source = artifact && run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
      const route = artifact?.appSpec?.routes?.find(item => item.method === scenario.request.method && item.path === scenario.request.path)
      if (resolved !== artifact?.appSpec?.listeningPort) issue = diagnostic('TARGET_PORT_MISMATCH', 'The Service targetPort does not reach the captured application listener.')
      else if (!snapshot || !artifact || !source || !route) issue = diagnostic('CAPTURED_APPLICATION_UNAVAILABLE', 'The selected Pod has no matching captured application route.')
      else {
        if (scenario.request.method === 'POST') {
          const answer = artifact.appSpec?.integration?.graph?.version === 1
            ? simulateIntegration(artifact.appSpec, snapshot, scenario.request, INTEGRATION_FIXTURES, scenario.integrationProfile ?? 'healthy')
            : simulateAssistant(artifact.appSpec, snapshot, scenario.request, KNOWLEDGE_FIXTURES)
          status = answer.status; body = answer.body; issue = answer.diagnostic
          dependencyTrace = answer.dependencyTrace
          integrationTrace = answer.integrationTrace ?? null
        } else {
          const response = {}
          for (const [key, expression] of Object.entries(route.response)) response[key] = expression.kind === 'config'
            ? (snapshot.environment[expression.key] ?? expression.defaultValue) : expression.value
          status = 200; body = response; issue = null
        }
      }
    }
  }
  const selectedPods = selected.map(pod => {
    const snapshot = cluster.podSnapshots[pod.metadata.uid]
    const artifact = snapshot && run.artifacts.buildsById[snapshot.artifactId]
    const route = artifact?.appSpec?.routes?.find(item => item.method === scenario.request.method && item.path === scenario.request.path)
    const podBody = route && (scenario.request.method === 'POST'
      ? (artifact.appSpec?.integration?.graph?.version === 1
          ? simulateIntegration(artifact.appSpec, snapshot, scenario.request, INTEGRATION_FIXTURES, scenario.integrationProfile ?? 'healthy')
          : simulateAssistant(artifact.appSpec, snapshot, scenario.request, KNOWLEDGE_FIXTURES)).body
      : Object.fromEntries(Object.entries(route.response).map(([key, expression]) => [key,
        expression.kind === 'config' ? (snapshot.environment[expression.key] ?? expression.defaultValue) : expression.value])))
    const c = pod?.spec?.containers?.[0]
    const targetPort = service?.spec?.ports?.[0]?.targetPort
    const port = typeof targetPort === 'number' ? targetPort : c?.ports?.find(item => item.name === targetPort)?.containerPort
    return { uid: pod.metadata.uid, artifactId: snapshot?.artifactId ?? null, sourceHash: artifact?.sourceHash ?? null,
      templateHash: snapshot?.templateHash ?? null, version: artifact?.appSpec?.version ?? null, body: podBody ?? null,
      listenerPort: artifact?.appSpec?.listeningPort ?? null, routedPort: port ?? null,
      matchesExpected: port === artifact?.appSpec?.listeningPort && podBody !== undefined
        && canonicalize(podBody) === canonicalize(scenario.expected.body) }
  })
  const replacementReceipts = cluster?.receipts?.filter(receipt => receipt.cause === 'pod-delete' && receipt.replacementPodUid
    && selected.some(pod => pod.metadata.uid === receipt.replacementPodUid)
    && receipt.sequence < run.nextSequence
    && hasPodDeleteCommand(run.history, receipt.deletedPodName)
    && receipt.deletedReplicaSetUid === selected[0]?.metadata.ownerReferences?.[0]?.uid
    && receipt.replacementReplicaSetUid === selected[0]?.metadata.ownerReferences?.[0]?.uid
    && receipt.replacementTemplateHash === cluster.podSnapshots[selected[0]?.metadata.uid]?.templateHash) ?? []
  const replacementProven = !scenario.requireReplacement || replacementReceipts.length > 0
  if (status === 200 && scenario.requireReplacement && !replacementProven) {
    status = 409; body = { error: 'ReplacementNotProven' }; issue = diagnostic('REPLACEMENT_NOT_PROVEN', 'No current-template Pod replacement receipt supports this request.')
  }
  const deploymentGeneration = deployment?.metadata.generation ?? null
  const requestSequence = run.nextSequence
  const measurement = { status, body, requestSequence, clusterId, namespace, serviceName, serviceVersion: service?.metadata.resourceVersion ?? null,
    deploymentName, deploymentGeneration, selectedPodUid: selected[0]?.metadata.uid ?? null, podUid: selected[0]?.metadata.uid ?? null,
    artifactId: selectedPods[0]?.artifactId ?? null, sourceHash: selectedPods[0]?.sourceHash ?? null,
    selectedPods: selectedPods.slice(0, 3), runningReplicaCount: selected.length,
    requiredReplicas: scenario.requireTwoReplicas ? 2 : 1, replacementProven, replacementReceipts,
    diagnosticCode: issue?.code ?? null, request: { ...scenario.request }, dependencyTrace: scenario.dependencyTrace ?? [], simulated: true }
  const snapshot = selected[0] && cluster.podSnapshots[selected[0].metadata.uid]
  const mountedConfigMismatch = !!snapshot?.configRefs?.some(item => item.mode === 'file' && item.kind === 'ConfigMap'
    && resources[`ConfigMap/${item.namespace}/${item.name}`]?.data?.[item.key] !== snapshot.files?.[item.target])
  measurement.projectionPending = !!selected[0] && Number.isFinite(cluster.projectionDue?.[selected[0].metadata.uid])
    && cluster.projectionDue[selected[0].metadata.uid] > run.runtime.simTimeMs
  measurement.mountedConfigMismatch = mountedConfigMismatch
  const currentConfig = Object.fromEntries((snapshot?.configRefs ?? []).filter(item => item.mode === 'env').flatMap(item => {
    const resource = resources[`${item.kind}/${item.namespace}/${item.name}`]
    const raw = resource?.data?.[item.key]
    if (raw === undefined) return []
    return item.kind === 'Secret' ? [] : [[item.target, raw]]
  }))
  const matches = (actual, expected) => expected === undefined || Object.entries(expected).every(([key, value]) => actual[key] === value)
  const currentConfigMatches = matches(currentConfig, scenario.expectedCurrentConfig)
  const capturedConfigMatches = matches(snapshot?.environment ?? {}, scenario.expectedCapturedConfig)
  measurement.currentConfig = currentConfig; measurement.currentConfigMatches = currentConfigMatches; measurement.capturedConfigMatches = capturedConfigMatches
  measurement.dependencyTrace = dependencyTrace
  if (integrationTrace) measurement.integrationTrace = integrationTrace
  const expectedReplicas = scenario.requireTwoReplicas ? 2 : 1
  const outcome = status === scenario.expected.status && canonicalize(body) === canonicalize(scenario.expected.body)
    && selectedPods.filter(pod => pod.matchesExpected).length >= expectedReplicas && replacementProven && currentConfigMatches && capturedConfigMatches
  const runtime = run.runtime.kubernetes
  const requests = [...runtime.requests, { id: `aks-request-${requestSequence}`, sequence: requestSequence,
    scenarioId: scenario.id, ...measurement }].slice(-100)
  const nextRun = { ...run, nextSequence: requestSequence + 1,
    runtime: { ...run.runtime, kubernetes: { ...runtime, requests } } }
  return { run: nextRun, outcome, status, body, measurements: measurement, diagnostic: issue }
}

function simulateConnectivityScenario(run, scenario, origin, hostname, port) {
  const routed = routeServiceRequest(run, { origin, hostname, port, method: scenario.request.method, path: scenario.request.path, body: scenario.request.body ?? null }, null)
  const latest = routed.run.runtime.kubernetes.requests.at(-1)
  const state = routed.run.runtime.kubernetes.clusters[scenario.target.clusterId]
  const service = Object.values(state.resources).find(item => item.kind === 'Service' && item.metadata.uid === routed.outcome.route.serviceUid) ?? null
  const selectedPod = routed.outcome.route.podUid && state.resources && Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === routed.outcome.route.podUid)
  const snapshot = selectedPod && state.podSnapshots[selectedPod.metadata.uid]
  const artifact = snapshot && routed.run.artifacts.buildsById[snapshot.artifactId]
  if (latest?.id === routed.outcome.requestId) {
    latest.scenarioId = scenario.id
    latest.route = { ...latest.route, originKind: origin.kind, originPodUid: origin.podUid ?? null, hostname,
      canonicalName: service ? `${service.metadata.name}.${service.metadata.namespace}.svc.cluster.local` : null,
      address: origin.kind === 'external' ? service?.status?.loadBalancer?.ingress?.[0]?.ip ?? null : service?.spec?.clusterIP ?? null,
      servicePort: service?.spec?.ports?.[0]?.port ?? null, targetPort: routed.outcome.route.backendPort ?? null,
      listenerPort: artifact?.appSpec?.listeningPort ?? null }
  }
  const outcome = routed.outcome
  const expectedTransport = scenario.expected.transport ?? { ok: true, reason: null }
  const intended = state.resources[`Service/${scenario.target.namespace}/${scenario.target.serviceName}`]
  const declaredRoute = !!intended && outcome.route.serviceUid === intended.metadata.uid
    && outcome.route.serviceName === scenario.target.serviceName && outcome.route.namespace === scenario.target.namespace
  const failurePattern = expectedTransport.ok ? true
    : expectedTransport.reason === 'NO_READY_ENDPOINTS' ? outcome.route.selectedCount === 0
      : expectedTransport.reason === 'CONNECTION_REFUSED' ? (outcome.route.readyEndpointUids?.length ?? 0) > 0
        : true
  const dependencyPattern = outcome.status !== 503 ? true : !!outcome.route.podUid
    && outcome.dependencyTrace[0]?.operation === 'embedding' && outcome.dependencyTrace[0]?.status === 'succeeded'
    && outcome.dependencyTrace.some(item => item.operation === 'postgres-query' && item.status === 'failed')
  const matches = outcome.status === scenario.expected.status && canonicalize(outcome.body) === canonicalize(scenario.expected.body)
    && canonicalize(outcome.transport) === canonicalize(expectedTransport) && declaredRoute && failurePattern && dependencyPattern
    && (!scenario.expected.route || Object.entries(scenario.expected.route).every(([key, value]) => canonicalize(outcome.route[key]) === canonicalize(value)))
  const clusterId = scenario.target.clusterId
  const measurements = { status: outcome.status, body: outcome.body, requestSequence: run.nextSequence, clusterId,
    namespace: outcome.route.namespace ?? scenario.target.namespace, serviceName: outcome.route.serviceName ?? scenario.target.serviceName,
    serviceUid: outcome.route.serviceUid ?? null, servicePort: service?.spec?.ports?.[0]?.port ?? null, targetPort: outcome.route.backendPort ?? null,
    canonicalName: service ? `${service.metadata.name}.${service.metadata.namespace}.svc.cluster.local` : null,
    address: origin.kind === 'external' ? service?.status?.loadBalancer?.ingress?.[0]?.ip ?? null : service?.spec?.clusterIP ?? null,
    listenerPort: artifact?.appSpec?.listeningPort ?? null, deploymentName: scenario.target.deploymentName,
    selectedPodUid: outcome.route.podUid ?? null, podUid: outcome.route.podUid ?? null, artifactId: outcome.route.artifactId ?? null,
    selectedPods: (outcome.route.readyEndpointUids ?? []).map(uid => ({ uid, matchesExpected: matches })),
    origin, hostname, dependencyTrace: outcome.dependencyTrace, transport: outcome.transport, route: outcome.route, simulated: true }
  return { run: routed.run, outcome: matches, status: outcome.status, body: outcome.body, measurements, diagnostic: outcome.diagnostic }
}

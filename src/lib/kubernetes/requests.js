import { getDeploymentPods } from './reconcile.js'
import { canonicalize } from '../labEngine/evidence.js'
import { tokenize } from '../az/tokenize.js'
import { simulateAssistant } from './assistant.js'
import { KNOWLEDGE_FIXTURES } from '../../data/fixtures/aks/knowledge.js'

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
  const { clusterId, namespace, serviceName, deploymentName } = scenario.target
  const cluster = run.runtime.kubernetes.clusters?.[clusterId]
  const resources = cluster?.resources ?? {}
  const service = resources[`Service/${namespace}/${serviceName}`]
  const deployment = resources[`Deployment/${namespace}/${deploymentName}`]
  let status = 503; let body = { error: 'ServiceUnavailable' }; let selected = []; let dependencyTrace = []
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
          const answer = simulateAssistant(artifact.appSpec, snapshot, scenario.request, KNOWLEDGE_FIXTURES)
          status = answer.status; body = answer.body; issue = answer.diagnostic
          dependencyTrace = answer.dependencyTrace
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
      ? simulateAssistant(artifact.appSpec, snapshot, scenario.request, KNOWLEDGE_FIXTURES).body
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

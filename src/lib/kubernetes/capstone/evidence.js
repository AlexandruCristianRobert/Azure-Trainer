import { verifyCapstoneSource } from './scenarios.js'
import { verifyAksFinal } from './cleanup.js'
import { simulateKubernetesRequest } from '../requests.js'
import { resolveServiceDns } from '../connectivity.js'
import { inspectRequestRecords } from '../request-records.js'
import { INTEGRATION_FIXTURES } from '../../../data/fixtures/aks/integration.js'
import { CAPSTONE_MANIFEST } from '../../../data/templates/aks-python/capstone.js'
import { CAPSTONE_IMAGE, CAPSTONE_TARGET, CAPSTONE_EXTERNAL, capstoneLive, capstonePublication } from '../../../data/labs/aks-journey/capstone-helpers.js'
import { RESILIENCE_MILESTONES, measuredMilestone, releaseBaselineReady } from './resilience.js'
import { publishedAksCapstoneV2, capstoneReleaseProof, verifyAksCapstoneIncident } from './incident.js'

const checks = {
  'registry-created': live => !!live.group && !!live.registry,
  'image-v1': live => !!live.build && live.build.sourceHash === live.sourceHash
    && live.build.image?.loginServer === `${CAPSTONE_IMAGE.split('/')[0]}`
    && live.build.image?.repository === 'assistant'
    && live.build.appSpec?.version === '1.0',
  'cluster-connected': live => live.clusterReady && !!live.grant && live.context?.clusterId === CAPSTONE_TARGET.clusterId,
  'config-applied': live => !!live.namespace && !!live.config && !!live.secret && live.config.data?.APP_ENV === 'training'
    && !!live.secret.data?.PGPASSWORD,
  'deployment-ready': live => live.sourceBuilt && live.configured && !!live.grant
    && live.context?.clusterId === CAPSTONE_TARGET.clusterId,
  'routing-ready': live => live.sourceBuilt && live.configured && live.routed,
}
const requestIds = new Set(['answer-backups', 'answer-support', 'invalid-input', 'no-match'])

export function verifyAksCapstone(run, lab, scenarioId) {
  const atMs = run.runtime.simTimeMs
  const task = lab.tasks.find(item => item.verification?.scenarioId === scenarioId)
  const result = (passed, measurements) => ({ scenarioId, scenarioVersion: 1,
    outcome: passed ? 'passed' : 'failed', completed: passed,
    startedAtMs: atMs, endedAtMs: atMs, measurements })
  if (lab.id !== run.labId || !task || lab.stages.find(stage => stage.id === run.stages.activeStageId)?.taskIds.includes(task.id) !== true)
    return { run, result: result(false, { reason: 'stage-locked' }) }
  const id = scenarioId.slice('capstone-'.length)
  if (task.stageId === 'final-cleanup') return verifyAksFinal(run, lab, scenarioId)
  if (task.stageId === 'incident') return verifyAksCapstoneIncident(run, lab, scenarioId)
  if (id === 'published-v2') return { run, result: result(publishedAksCapstoneV2(run), { kind: 'capstone-publication',
    artifactId: capstonePublication(run, '2.0')?.buildId ?? null, reason: 'Publish a distinct v2 artifact from the complete saved source.' }) }
  if (['release-v2', 'rollback-recovered'].includes(id)) {
    const measured = capstoneReleaseProof(run, id)
    return { run, result: result(!!measured, { kind: 'capstone-measured-release', receiptId: measured?.proof.id ?? null,
      reason: measured ? 'Observed native release receipt retained.' : 'Complete the declared native release measurement first.' }) }
  }
  if (RESILIENCE_MILESTONES.includes(id)) {
    const measured = measuredMilestone(run, id)
    return { run, result: result(!!measured, { kind: 'capstone-measured-milestone',
      receiptId: measured?.proof.id ?? null, reason: measured ? 'observed-native-experiment' : 'completed-measurement-required' }) }
  }
  if (id === 'release-baseline') return { run, result: result(releaseBaselineReady(run), { kind: 'capstone-release-baseline',
    clusterId: CAPSTONE_TARGET.clusterId, fixedReplicas: 2, noHpa: true }) }
  if (id === 'source-contract') {
    const preview = verifyCapstoneSource(run.project.savedFiles, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
    return { run, result: result(preview.passed, { kind: 'source-preview', artifactId: null, deploymentId: null,
      fixtureVersion: preview.measurements.fixtureVersion,
      cases: Object.fromEntries(Object.entries(preview.measurements.cases).map(([name, item]) =>
        [name, { status: item.status, sources: item.body?.sources ?? [], dependencyTrace: item.dependencyTrace }])),
      health: Object.fromEntries(Object.entries(preview.measurements.health).filter(([, item]) => Number.isInteger(item.status)).map(([name, item]) => [name, item.status])),
      workload: preview.measurements.workload, diagnostics: preview.diagnostics }) }
  }
  const live = capstoneLive(run)
  if (id === 'routing-ready' && live.sourceBuilt && live.configured && live.routed) {
    const dns = resolveServiceDns(run, { clusterId: CAPSTONE_TARGET.clusterId, clientNamespace: 'assistant',
      hostname: 'assistant-internal.assistant.svc.cluster.local' })
    const dnsMatches = dns.ok === true && dns.serviceKey === 'Service/assistant/assistant-internal'
      && dns.canonicalName === 'assistant-internal.assistant.svc.cluster.local'
      && dns.address === live.internal.spec.clusterIP
    const expected = { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } }
    const request = { method: 'GET', path: '/api/info' }
    const internal = simulateKubernetesRequest(run, { id: `${scenarioId}-internal`, target: CAPSTONE_TARGET, request, expected })
    const external = simulateKubernetesRequest(internal.run, { id: `${scenarioId}-external`, target: CAPSTONE_EXTERNAL, request, expected,
      connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 } })
    const passed = dnsMatches && internal.outcome && external.outcome && internal.measurements.artifactId === live.buildId
      && external.measurements.artifactId === live.buildId
    return { run: external.run, result: result(!!passed, { reason: passed ? 'observed-internal-and-external' : 'routing-failed',
      clusterId: CAPSTONE_TARGET.clusterId, deploymentUid: live.deployment.metadata.uid,
      internalDns: dns, internalStatus: internal.status, externalStatus: external.status,
      internalPodUid: internal.measurements.podUid ?? null, externalPodUid: external.measurements.podUid ?? null,
      artifactId: live.buildId, internalServiceUid: live.internal.metadata.uid, externalServiceUid: live.external.metadata.uid }) }
  }
  if (checks[id]) {
    const passed = checks[id](live)
    return { run, result: result(passed, { reason: passed ? 'observed-current-state' : 'required-state-missing',
      groupId: live.group?.id ?? null, registryId: live.registry?.id ?? null, clusterId: live.cluster?.id ?? null,
      context: run.runtime.kubernetes.currentContext, buildId: live.buildId ?? null,
      deploymentUid: live.deployment?.metadata?.uid ?? null, podUids: live.pods.map(pod => pod.metadata.uid) }) }
  }
  if (requestIds.has(id)) {
    if (!live.sourceBuilt || !live.configured || !live.routed || !live.grant || live.context?.clusterId !== CAPSTONE_TARGET.clusterId)
      return { run, result: result(false, { reason: 'deployment-not-current' }) }
    const scenario = lab.scenarios[scenarioId]
    const response = simulateKubernetesRequest(run, { ...scenario, id: scenarioId })
    const measured = response.measurements
    const operations = measured.dependencyTrace ?? []
    const trace = measured.integrationTrace
    const requestId = `request-${measured.requestSequence}`
    const logs = inspectRequestRecords(response.run, { clusterId: CAPSTONE_TARGET.clusterId, requestId }).application
    const started = logs.some(log => log.requestId === requestId && log.podUid === measured.podUid
      && log.artifactId === measured.artifactId && log.sourceFields?.event === 'request.started'
      && log.sourceFields.request_id === requestId && log.sourceBindings?.request_id === 'request-id')
    const completed = logs.some(log => log.requestId === requestId && log.podUid === measured.podUid
      && log.artifactId === measured.artifactId && log.sourceFields?.event === 'request.completed'
      && log.sourceFields.request_id === requestId && log.sourceFields.status === response.status
      && log.sourceBindings?.request_id === 'request-id' && log.sourceBindings.status === 'result-status')
    const passed = response.outcome && measured.transport?.ok === true && measured.podUid && measured.artifactId === live.buildId
      && started && completed && trace?.fixtureVersion === INTEGRATION_FIXTURES.version
      && (id === 'invalid-input' ? operations.length === 0 && trace.inputDisposition === 'rejected'
        : id === 'no-match' ? operations.map(item => item.operation).join() === 'embedding,postgres-query' && trace.selectedIds.length === 0
          : operations.map(item => item.operation).join() === 'embedding,postgres-query,answer'
            && trace.vectorProvenance === 'embedding' && trace.sourceProvenance === 'rows'
            && trace.queryBindings?.published === true && trace.selectedIds.join() === scenario.expected.body.sources.join())
    return { run: response.run, result: result(!!passed, { ...measured, applicationLogProof: { started, completed },
      reason: passed ? 'observed-request' : 'request-or-provenance-mismatch' }) }
  }
  return { run, result: result(false, { reason: 'stage-not-implemented' }) }
}

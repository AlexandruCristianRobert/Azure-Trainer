import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { aksConnectivityTroubleshootingLab } from '../src/data/labs/aks-journey/connectivity-troubleshooting.lab.js'
import { executeAksSolution } from './helpers/aks.js'
import { act } from './helpers/aks.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { inspectConnectivity } from '../src/lib/kubernetes/connectivity-inspection.js'
import { LABS } from '../src/data/labs/index.js'
import { readFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'

const createRun = (attemptId = 'incident-case') => createBehavioralRun(aksConnectivityTroubleshootingLab, { attemptId })
const task = id => aksConnectivityTroubleshootingLab.tasks.find(item => item.id === id)
const solve = (run, ...ids) => ids.reduce((value, id) => executeAksSolution(value, aksConnectivityTroubleshootingLab, task(id)), run)
const advance = run => applyRunAction(run, { type: 'aks-connectivity-next-incident' }, aksConnectivityTroubleshootingLab)
const stateFor = run => run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id]

describe('AKS connectivity troubleshooting Lab', () => {
  it('blocks premature incident advancement without changing Kubernetes state', () => {
    const run = createBehavioralRun(aksConnectivityTroubleshootingLab, { attemptId: 'incident-gate' })
    const result = applyRunAction(run, { type: 'aks-connectivity-next-incident' }, aksConnectivityTroubleshootingLab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('seeds two configured Pods with a failing internal selector and healthy external Service', () => {
    const run = createBehavioralRun(aksConnectivityTroubleshootingLab, { attemptId: 'incident-seed' })
    const clusterId = run.sandbox.aksClusters[0].id
    const state = run.runtime.kubernetes.clusters[clusterId]
    expect(state.connectivity.incident).toMatchObject({ id: 'network-hops-v1', phase: 'selector', sequence: 1,
      observations: { selector: null, port: null, dependency: null }, recoveries: { selector: null, port: null, dependency: null } })
    expect(state.resources['Service/assistant/assistant-internal'].spec.selector).toEqual({ app: 'assistnat' })
    expect(state.resources['Service/assistant/assistant-public'].spec.selector).toEqual({ app: 'assistant' })
    expect(Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')).toHaveLength(2)
  })

  it('keeps Lab 8 registered and exposes its guarded control in the experiment panel', async () => {
    expect(LABS.some(item => item.id === aksConnectivityTroubleshootingLab.id)).toBe(true)
    expect(aksConnectivityTroubleshootingLab.tasks).toHaveLength(8)
    expect(aksConnectivityTroubleshootingLab.tasks.every(item => item.hints?.length === 2 && item.solution?.steps?.length
      && typeof item.examNote === 'string' && item.examNote.length > 0)).toBe(true)
    const panel = await readFile(new URL('../src/components/lab/AksExperimentPanel.vue', import.meta.url), 'utf8')
    expect(panel).toContain('Introduce next connectivity fault')
    expect(panel).toContain('canIntroduceConnectivityIncident')
  })

  it('completes all three observed and recovered incidents from the authored Solutions', () => {
    let run = createRun('incident-solutions')
    for (const task of aksConnectivityTroubleshootingLab.tasks) {
      try { run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task) }
      catch (error) { throw new Error(`${task.id}: ${error.message}`) }
    }
    const evaluation = evaluateLab(aksConnectivityTroubleshootingLab, run)
    expect(evaluation.isComplete).toBe(true)
    expect(evaluation.tasks.find(item => item.id === 'observe-selector').done).toBe(true)
    expect(evaluation.tasks.find(item => item.id === 'observe-port').done).toBe(true)
    for (const id of ['final-internal', 'final-external']) {
      const evidence = run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]
      expect(evidence.measurements.body).toEqual(aksConnectivityTroubleshootingLab.scenarios[evidence.scenarioId].expected.body)
      expect(evidence.measurements.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    }
    expect(stateFor(run).connectivity.incident.recoveries.dependency).toBe(run.evidence.currentEvidenceByTask['final-internal'])
  })

  it('does not let a healthy external route substitute for the selector observation', () => {
    let run = createRun('external-decoy')
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-network-external-final' }).run
    const blocked = advance(run)
    expect(blocked.diagnostics[0].code).toBe('AKS_INCIDENT_NOT_READY')
    expect(blocked.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('requires the selector failure observation before accepting its repaired route', () => {
    let run = executeAksSolution(createRun('skip-selector'), aksConnectivityTroubleshootingLab, task('repair-selector'))
    const blocked = advance(run)
    expect(blocked.diagnostics[0].code).toBe('AKS_INCIDENT_NOT_READY')
    expect(blocked.run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].connectivity.incident.phase).toBe('selector')
  })

  it('keeps the wrong-selector and wrong-port symptoms distinct', () => {
    let run = solve(createRun('hop-semantics'), 'observe-selector', 'repair-selector')
    expect(stateFor(run).connectivity.incident.observations.selector).toBeTruthy()
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    const noEndpoint = run.runtime.kubernetes.requests.find(item => item.scenarioId === 'trouble-selector-failure')
    const refused = run.runtime.kubernetes.requests.find(item => item.scenarioId === 'trouble-port-failure')
    expect(noEndpoint).toMatchObject({ status: null, transport: { ok: false, reason: 'NO_READY_ENDPOINTS' }, route: { selectedCount: 0, endpointUids: [] } })
    expect(refused).toMatchObject({ status: null, transport: { ok: false, reason: 'CONNECTION_REFUSED' }, route: { selectedCount: 2, readyEndpointUids: expect.any(Array), backendPort: 8081 } })
    expect(refused.route.readyEndpointUids).toHaveLength(2)
  })

  it('blocks advancement when the recovered saved Service has an unsaved draft', () => {
    let run = solve(createRun('draft-guard'), 'observe-selector', 'repair-selector')
    const path = 'k8s/service-internal.yaml'
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'draft', path, text: `${run.project.savedFiles[path]}# local draft\n` }).run
    const before = run.runtime.kubernetes
    const result = advance(run)
    expect(result.diagnostics[0]).toMatchObject({ code: 'AKS_UNSAVED_INCIDENT_SOURCE' })
    expect(result.diagnostics[0].message).toContain(path)
    expect(result.run.runtime.kubernetes).toEqual(before)
  })

  it('checks the ConfigMap draft before the port-to-dependency transition', () => {
    let run = solve(createRun('config-draft-guard'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    const path = 'k8s/configmap.yaml'
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'draft', path, text: `${run.project.savedFiles[path]}# edit not saved\n` }).run
    const blocked = applyRunAction(run, { type: 'aks-connectivity-next-incident' }, aksConnectivityTroubleshootingLab)
    expect(blocked.diagnostics[0]).toMatchObject({ code: 'AKS_UNSAVED_INCIDENT_SOURCE' })
    expect(blocked.diagnostics[0].message).toContain(path)
    expect(blocked.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('accepts numeric 8080 as the repaired targetPort', () => {
    let run = executeAksSolution(createRun('numeric-target-port'), aksConnectivityTroubleshootingLab, task('observe-selector'))
    const path = 'k8s/service-internal.yaml'
    const numeric = aksConnectivityTroubleshootingLab.solutionFiles[path].replace('targetPort: http', 'targetPort: 8080')
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path, text: numeric }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-selector-recovered' }).run
    const next = applyRunAction(run, { type: 'aks-connectivity-next-incident' }, aksConnectivityTroubleshootingLab)
    expect(next.diagnostics).toEqual([])
    expect(next.run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Service/assistant/assistant-internal'].spec.ports[0].targetPort).toBe(8081)
  })

  it('blocks stale recovery evidence when the repaired file no longer matches the applied Service', () => {
    let run = solve(createRun('stale-recovery'), 'observe-selector', 'repair-selector')
    const path = 'k8s/service-internal.yaml'
    const changed = run.project.savedFiles[path].replace('app: assistant\n', 'app: unrelated\n')
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path, text: changed }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    expect(advance(run).diagnostics[0].code).toBe('AKS_INCIDENT_RECOVERY_STALE')
  })

  it('restores incident phase from a serialized run in the middle of the port and dependency phases', () => {
    let run = solve(createRun('reload-phases'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = JSON.parse(JSON.stringify(run))
    expect(stateFor(run).connectivity.incident).toMatchObject({ phase: 'port', sequence: 2 })
    run = solve(run, 'repair-port')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-dependency'))
    run = JSON.parse(JSON.stringify(run))
    expect(stateFor(run).connectivity.incident).toMatchObject({ phase: 'dependency', sequence: 3 })
    run = solve(run, 'repair-dependency')
    run = JSON.parse(JSON.stringify(run))
    expect(stateFor(run).connectivity.incident.observations.dependency).toBeTruthy()
    expect(evaluateLab(aksConnectivityTroubleshootingLab, run).tasks.find(item => item.id === 'observe-selector').done).toBe(true)
  })

  it('parses and compares saved and applied ConfigMap data independent of YAML formatting', () => {
    let run = solve(createRun('config-formatting'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-dependency'))
    const path = 'k8s/configmap.yaml'
    const resource = parse(aksConnectivityTroubleshootingLab.solutionFiles[path])
    resource.data = Object.fromEntries(Object.entries(resource.data).reverse())
    const variant = stringify(resource, { indent: 4 })
    expect(variant).not.toBe(aksConnectivityTroubleshootingLab.solutionFiles[path])
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path, text: variant }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    expect(task('repair-dependency').check({ runtime: run.runtime, project: run.project, artifacts: run.artifacts })).toBe(true)
  })

  it('binds historical port observations to the captured assistant artifact', () => {
    let run = solve(createRun('artifact-bound'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    const evidenceId = stateFor(run).connectivity.incident.observations.port
    run.evidence.experimentsById[evidenceId].measurements.artifactId = 'forged-image-artifact'
    expect(() => validateBehavioralRun(run, aksConnectivityTroubleshootingLab)).toThrow(/Kubernetes runtime state is missing or malformed/)
  })

  it('rejects a saved phase that skips any earlier observation or recovery receipt', () => {
    const run = createRun('forged-phase')
    const incident = stateFor(run).connectivity.incident
    incident.phase = 'port'
    incident.sequence = 2
    expect(() => validateBehavioralRun(run, aksConnectivityTroubleshootingLab)).toThrow(/Kubernetes runtime state is missing or malformed/)
  })

  it('retains a historical port observation after the Service is recreated', () => {
    let run = solve(createRun('service-recreated'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    const oldServiceUid = stateFor(run).resources['Service/assistant/assistant-internal'].metadata.uid
    const replacementUid = `${oldServiceUid}-replacement`
    const current = stateFor(run)
    current.resources['Service/assistant/assistant-internal'].metadata.uid = replacementUid
    for (const [key, resource] of Object.entries(current.resources)) if (resource.kind === 'EndpointSlice'
      && resource.metadata.ownerReferences?.[0]?.uid === oldServiceUid) {
      delete current.resources[key]
      resource.metadata.ownerReferences[0].uid = replacementUid
      const suffix = resource.ports[0]?.port ?? 'empty'
      const name = `assistant-internal-${replacementUid.replace(/[^a-z0-9]/g, '').slice(-12)}-${suffix}`.slice(0, 63)
      resource.metadata.name = name
      current.resources[`EndpointSlice/assistant/${name}`] = resource
    }
    expect(current.resources['Service/assistant/assistant-internal'].metadata.uid).not.toBe(oldServiceUid)
    expect(() => validateBehavioralRun(run, aksConnectivityTroubleshootingLab)).not.toThrow()
    expect(evaluateLab(aksConnectivityTroubleshootingLab, run).tasks.find(item => item.id === 'observe-port').done).toBe(true)
  })

  it('renders the captured 8081 target port in historical trace after repair', () => {
    let run = solve(createRun('historical-trace'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    const trace = inspectConnectivity(run, { clusterId: run.sandbox.aksClusters[0].id, namespace: 'assistant', serviceName: 'assistant-internal' })
      .requests.find(item => item.scenarioId === 'trouble-port-failure').trace
    expect(trace.find(item => item.name === 'Service').detail).toContain('targetPort 8081')
    expect(trace.find(item => item.name === 'Pod/listener').detail).toContain('backend port 8081')
  })

  it('rejects a historical application log whose correlated request is missing', () => {
    let run = solve(createRun('missing-log-request'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-dependency'))
    const requestIds = new Set(stateFor(run).connectivity.applicationLogs.map(item => item.requestId))
    run.runtime.kubernetes.requests = run.runtime.kubernetes.requests.filter(item => !requestIds.has(item.id))
    expect(() => validateBehavioralRun(run, aksConnectivityTroubleshootingLab)).toThrow(/Kubernetes runtime state is missing or malformed/)
  })

  it('reaches the dependency failure over both Services and retains only redacted application evidence', () => {
    let run = solve(createRun('both-services'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-dependency'))
    const externalIP = stateFor(run).resources['Service/assistant/assistant-public'].status.loadBalancer.ingress[0].ip
    for (const [origin, hostname] of [
      [{ kind: 'pod', clusterId: run.sandbox.aksClusters[0].id, podUid: stateFor(run).connectivity.diagnosticPodUids[0] }, 'assistant-internal.assistant'],
      [{ kind: 'external', clusterId: run.sandbox.aksClusters[0].id }, externalIP],
    ]) {
      const routed = routeServiceRequest(run, { origin, hostname, port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, null)
      run = routed.run
      expect(routed.outcome).toMatchObject({ transport: { ok: true, reason: null }, status: 503 })
      expect(routed.outcome.dependencyTrace).toContainEqual({ operation: 'postgres-query', status: 'failed', reason: 'DNS_NOT_FOUND' })
      expect(routed.outcome.route.podUid).toBeTruthy()
    }
    expect(JSON.stringify(stateFor(run).connectivity.applicationLogs)).not.toContain('training-only-password')
  })

  it('does not complete after every fault is manually repaired if the learner skips the phase observations', () => {
    let run = createRun('skip-observations')
    const servicePath = 'k8s/service-internal.yaml'
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path: servicePath, text: aksConnectivityTroubleshootingLab.solutionFiles[servicePath] }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${servicePath}` }).run
    const portFault = run.project.savedFiles[servicePath].replace('targetPort: http', 'targetPort: 8081')
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path: servicePath, text: portFault }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${servicePath}` }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path: servicePath, text: aksConnectivityTroubleshootingLab.solutionFiles[servicePath] }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${servicePath}` }).run
    const configPath = 'k8s/configmap.yaml'
    const brokenConfig = run.project.savedFiles[configPath].replace('PGHOST: pg-training.example', 'PGHOST: pg-typo.example')
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path: configPath, text: brokenConfig }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${configPath}` }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path: configPath, text: aksConnectivityTroubleshootingLab.solutionFiles[configPath] }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${configPath}` }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-selector-recovered' }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-network-internal-final' }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-network-external-final' }).run
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['final-internal']].outcome).toBe('passed')
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['final-external']].outcome).toBe('passed')
    expect(evaluateLab(aksConnectivityTroubleshootingLab, run).isComplete).toBe(false)
    expect(advance(run).diagnostics).toHaveLength(1)
  })

  it('keeps the dependency failure until replacement Pods capture the repaired PGHOST', () => {
    let run = solve(createRun('restart-required'), 'observe-selector', 'repair-selector')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-port'))
    run = solve(run, 'repair-port')
    run = executeAksSolution(run, aksConnectivityTroubleshootingLab, task('observe-dependency'))
    const path = 'k8s/configmap.yaml'
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'save-file', path, text: aksConnectivityTroubleshootingLab.solutionFiles[path] }).run
    run = act(run, aksConnectivityTroubleshootingLab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    const beforeRestart = applyRunAction(run, { type: 'aks-request', scenarioId: 'trouble-network-internal-final' }, aksConnectivityTroubleshootingLab)
    expect(beforeRestart.run.evidence.experimentsById[beforeRestart.run.evidence.currentEvidenceByTask['final-internal']].outcome).toBe('failed')
    const restarted = act(beforeRestart.run, aksConnectivityTroubleshootingLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' })
    const afterRestart = act(restarted.run, aksConnectivityTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-network-internal-final' })
    expect(afterRestart.run.evidence.experimentsById[afterRestart.run.evidence.currentEvidenceByTask['final-internal']].outcome).toBe('passed')
  })
})

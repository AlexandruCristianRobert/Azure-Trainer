import { beforeAll, describe, expect, it } from 'vitest'
import { seedAksProductionAt, executeCapstoneCleanup } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { aksCleanupReady, inspectAksCleanup, aksCleanupEligibility, aksFinalContractMatches } from '../src/lib/kubernetes/capstone/cleanup.js'
import { CAPSTONE_TARGET } from '../src/data/labs/aks-journey/capstone-helpers.js'
import { publishedAksCapstoneV2 } from '../src/lib/kubernetes/capstone/incident.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { createRegistry } from '../src/lib/sandbox/registry.js'

const command = line => ({ type: 'command', line })
const verify = id => ({ type: 'aks-request', scenarioId: `capstone-${id}` })
const finalIds = ['final-internal', 'final-external', 'final-invalid', 'final-no-match', 'final-timeout']
describe('AKS capstone final proof and cleanup', () => {
  let lab, baseline, verified, frozen
  const act = (run, action) => {
    const result = applyRunAction(run, action, lab)
    expect(result.diagnostics, JSON.stringify(action)).toEqual([])
    expect(result.lines.filter(item => item.kind === 'err'), JSON.stringify(action)).toEqual([])
    return result.run
  }
  const reload = run => validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)
  beforeAll(() => {
    ;({ lab, run: baseline } = seedAksProductionAt('final-cleanup'))
    verified = executeCapstoneCleanup(structuredClone(baseline), lab, { mode: 'verify-only' })
    frozen = act(structuredClone(verified), { type: 'aks-freeze-cleanup' })
  }, 600000)
  it('requires all five current requests and a fresh six-object restart witness', () => {
    expect(aksCleanupEligibility(baseline, lab)).not.toEqual([])
    expect(aksCleanupEligibility(verified, lab)).toEqual([])
    expect(lab.aksCapstone.cleanupEligibility(verified)).toEqual([])
    for (const id of finalIds) {
      const record = verified.evidence.experimentsById[verified.evidence.currentEvidenceByTask[id]]
      expect(record).toMatchObject({ taskId: id, outcome: 'passed', completed: true })
      expect(record.measurements.applicationLogProof).toEqual({ started: true, completed: true })
    }
    const timeout = verified.evidence.experimentsById[verified.evidence.currentEvidenceByTask['final-timeout']]
    expect(timeout.measurements.status).toBe(504)
    expect(timeout.measurements.dependencyTrace.map(item => item.operation)).toEqual(['embedding'])
    expect(timeout.measurements.dependencyTrace[0].attempts).toHaveLength(3)
    expect(timeout.startedAtMs).toBe(timeout.endedAtMs)
    const missing = structuredClone(verified)
    delete missing.evidence.currentEvidenceByTask['final-invalid']
    expect(aksCleanupEligibility(missing, lab)).not.toEqual([])
    const drafts = act(structuredClone(verified), { type: 'draft', path: 'app.py', text: verified.project.savedFiles['app.py'] + '\n# unsaved' })
    expect(aksCleanupEligibility(drafts, lab)).not.toEqual([])
    const restarted = act(structuredClone(verified), command('kubectl rollout restart deployment/assistant-api -n assistant'))
    expect(aksCleanupEligibility(restarted, lab)).not.toEqual([])
  }, 60000)
  it('rejects pre-freeze cloud deletions atomically', () => {
    for (const line of ['az aks delete -g rg-aks-capstone -n aks-capstone --yes', 'az acr delete -n acrakscapstone --yes', 'az group delete -n rg-aks-capstone --yes']) {
      const result = applyRunAction(baseline, command(line), lab)
      expect(result.diagnostics[0]?.code).toBe('AKS_CLEANUP_CHECKPOINT_REQUIRED')
      expect(result.run).toEqual(baseline)
    }
  })
  it('rejects broken rebuilt v2 health, workload and logging contracts', () => {
    expect(aksFinalContractMatches(verified)).toBe(true)
    for (const alter of [source => source.replace('200 if initialized() and accepting_requests() else 503', '200'),
      source => source.replace('WORK_UNITS = 20', 'WORK_UNITS = 1'),
      source => source.replace('    log_event("request.completed", response["status"])\n', '')]) {
      const text = alter(baseline.project.savedFiles['app.py'])
      expect(text).not.toBe(baseline.project.savedFiles['app.py'])
      let run = act(structuredClone(baseline), { type: 'save-file', path: 'app.py', text })
      run = act(run, command('az acr build --registry acrakscapstone --image assistant:capstone-v2 .'))
      expect(publishedAksCapstoneV2(run)).toBe(false)
      expect(aksCleanupEligibility(run, lab)).not.toEqual([])
    }
    // This still passes the basic healthy fixture preview, but adds a readiness
    // dependency absent from the demonstrated cached-health projection.
    let coupled = act(structuredClone(baseline), { type: 'save-file', path: 'app.py',
      text: baseline.project.savedFiles['app.py'].replace('initialized() and accepting_requests()', 'initialized() and accepting_requests() and postgres_available()') })
    coupled = act(coupled, command('az acr build --registry acrakscapstone --image assistant:capstone-v2 .'))
    expect(aksFinalContractMatches(coupled)).toBe(false)
  }, 60000)
  it('requires all six current-stage apply observations and rejects failed reapply', () => {
    let run = structuredClone(baseline)
    for (const path of ['configmap', 'secret', 'deployment', 'service-internal', 'service-external'])
      run = act(run, command(`kubectl apply -f k8s/${path}.yaml`))
    run = act(run, command('kubectl rollout restart deployment/assistant-api -n assistant'))
    run = act(run, { type: 'aks-advance', seconds: 90 })
    const proof = run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId].rollouts.proofs
    expect(Object.values(proof)[0].appliedKeys).not.toContain('Namespace//assistant')
    expect(aksCleanupEligibility(run, lab)).not.toEqual([])
    const invalid = act(structuredClone(verified), { type: 'save-file', path: 'k8s/configmap.yaml', text: 'not valid yaml: [' })
    const failed = applyRunAction(invalid, command('kubectl apply -f k8s/configmap.yaml'), lab)
    expect(failed.lines.some(line => line.kind === 'err')).toBe(true)
    expect(aksCleanupEligibility(failed.run, lab)).not.toEqual([])
  }, 60000)
  it('authenticates the explicit internal service origin and its recorded identity', () => {
    const native = verified.runtime.kubernetes.requests.find(item => item.scenarioId === 'capstone-final-internal')
    expect(native.origin).toMatchObject({ kind: 'service', namespace: 'assistant', serviceName: 'assistant-internal', serviceUid: native.route.serviceUid })
    expect(native.hostname).toBe('assistant-internal.assistant.svc.cluster.local')
    expect(native.dependencyRecords.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    const request = { origin: native.origin, hostname: native.hostname, port: 80, method: 'POST', path: '/api/ask',
      body: { question: 'How long are backups kept?' }, scenarioId: 'capstone-final-internal' }
    for (const origin of [{ ...native.origin, serviceName: 'assistant-external' }, { ...native.origin, serviceUid: 'kube-999999' }]) {
      const result = routeServiceRequest(verified, { ...request, origin }, lab)
      expect(result.outcome.transport.reason).toBe('INVALID_ORIGIN')
      expect(result.run).toBe(verified)
    }
    expect(routeServiceRequest(verified, request, { ...lab, id: 'another-lab' }).outcome.transport.reason).toBe('INVALID_ORIGIN')
    expect(routeServiceRequest(verified, { ...request, scenarioId: 'capstone-final-external' }, lab).outcome.transport.reason).toBe('INVALID_ORIGIN')
    const forged = structuredClone(verified)
    forged.runtime.kubernetes.requests.find(item => item.scenarioId === 'capstone-final-internal').origin.serviceUid = 'kube-999999'
    expect(() => reload(forged)).toThrow()
  })
  it('permits help, elapsed bookkeeping and reads but rejects writes after freeze', () => {
    for (const action of [{ type: 'save-file', path: 'app.py', text: frozen.project.savedFiles['app.py'] },
      { type: 'draft', path: 'app.py', text: '' }, command('kubectl apply -f k8s/deployment.yaml'),
      command('az acr build --registry acrakscapstone --image assistant:new .'), command('az group create -n extra -l westeurope'),
      command('kubectl rollout restart deployment/assistant-api -n assistant'), { type: 'aks-advance', seconds: 1 },
      { type: 'aks-capstone-incident' }, verify('final-internal')]) {
      const rejected = applyRunAction(frozen, action, lab)
      expect(rejected.diagnostics[0]?.code).toBe('AKS_CLEANUP_FROZEN')
      expect(rejected.run).toEqual(frozen)
    }
    act(frozen, command('kubectl get pods -n assistant'))
    act(frozen, { type: 'hint', taskId: 'cleanup-app' })
    act(frozen, { type: 'elapsed', milliseconds: 100 })
  }, 60000)
  it.each(['explicit-deletes', 'group-cascade'])('retains protected fixtures and historical proof after %s', mode => {
    const completed = executeCapstoneCleanup(structuredClone(frozen), lab, { mode })
    expect(aksCleanupReady(completed, lab)).toBe(true)
    expect(inspectAksCleanup(completed, lab)).toMatchObject({ protectedIntact: true, remaining: [] })
    expect(completed.stages.sealedStages).toHaveLength(8)
    expect(evaluateLab(lab, completed)).toMatchObject({ isComplete: true, doneCount: 31 })
    expect(completed.artifacts.buildsById).toEqual(frozen.artifacts.buildsById)
    expect(completed.artifacts.sourceSnapshotsByHash).toEqual(frozen.artifacts.sourceSnapshotsByHash)
    expect(completed.artifacts.publishedTags).toEqual({})
    expect(completed.runtime.kubernetes.clusters).toEqual({})
    expect(completed.runtime.kubernetes.contexts).toEqual({})
    expect(completed.sandbox.resourceGroups.map(item => item.name)).toEqual(['rg-aks-prerequisites'])
    expect(completed.runtime.aksCapstonePrerequisites).toEqual(frozen.runtime.aksCapstonePrerequisites)
    for (const id of frozen.stages.cleanupCheckpoint.evidenceIds) expect(completed.evidence.experimentsById[id]).toEqual(frozen.evidence.experimentsById[id])
    expect(reload(completed)).toEqual(completed)
  }, 60000)
  it('resumes partial cleanup after reload and accepts cluster-first application removal', () => {
    let run = act(structuredClone(frozen), command('az aks delete -g rg-aks-capstone -n aks-capstone --yes'))
    expect(run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId]).toBeUndefined()
    run = act(reload(run), verify('cleanup-app'))
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['cleanup-app']].outcome).toBe('passed')
    expect(aksCleanupReady(run, lab)).toBe(false)
    const failed = applyRunAction(run, verify('cleanup-cloud'), lab).run
    expect(failed.evidence.experimentsById[failed.evidence.currentEvidenceByTask['cleanup-cloud']].outcome).toBe('failed')
    run = executeCapstoneCleanup(reload(failed), lab, { mode: 'group-cascade' })
    expect(evaluateLab(lab, reload(run)).isComplete).toBe(true)
  }, 60000)
  it('rejects forged checkpoint snapshots and protected deletion', () => {
    for (const mutate of [run => { run.stages.cleanupCheckpoint.attemptId = 'another' },
      run => { run.stages.cleanupCheckpoint.evidenceIds.pop() },
      run => { run.stages.cleanupCheckpoint.inventory = [] },
      run => { run.stages.cleanupCheckpoint.fingerprint.sourceHash = '0'.repeat(64) }]) {
      const bad = structuredClone(frozen); mutate(bad)
      expect(() => reload(bad)).toThrow()
    }
    const result = applyRunAction(frozen, command('az group delete -n rg-aks-prerequisites --yes'), lab)
    expect(result.diagnostics[0]?.code).toBe('AKS_PROTECTED_RESOURCE')
    expect(result.run).toEqual(frozen)
  })
  it('rejects foreign children, cross-attempt ownership and dangling cleanup timers', () => {
    const foreign = structuredClone(frozen)
    foreign.sandbox = createRegistry(foreign.sandbox, { resourceGroup: 'rg-aks-capstone', name: 'foreignregistry', sku: 'Basic' }).sandbox
    const rejected = applyRunAction(foreign, command('az group delete -n rg-aks-capstone --yes'), lab)
    expect(rejected.diagnostics[0]?.code).toBe('AKS_RESOURCE_NOT_OWNED')
    expect(rejected.run).toEqual(foreign)
    const otherAttempt = structuredClone(frozen)
    otherAttempt.stages.aks.ownership[0].attemptId = 'foreign'
    expect(() => reload(otherAttempt)).toThrow()
    let cleaned = act(structuredClone(frozen), command('az group delete -n rg-aks-capstone --yes'))
    cleaned.runtime.scheduledEvents.push({ clusterId: CAPSTONE_TARGET.clusterId, namespace: 'assistant', atMs: cleaned.runtime.simTimeMs + 1000 })
    expect(aksCleanupReady(cleaned, lab)).toBe(false)
    expect(inspectAksCleanup(cleaned, lab).remaining.some(item => item.type === 'scheduled-event')).toBe(true)
    cleaned = applyRunAction(cleaned, verify('cleanup-app'), lab).run
    expect(cleaned.evidence.experimentsById[cleaned.evidence.currentEvidenceByTask['cleanup-app']].outcome).toBe('failed')
  }, 60000)
})

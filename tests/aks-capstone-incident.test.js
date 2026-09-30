import { beforeAll, describe, expect, it } from 'vitest'
import { seedAksProductionAt, executeCapstoneStage } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { CAPSTONE_TARGET } from '../src/data/labs/aks-journey/capstone-helpers.js'
import { CAPSTONE_SOLUTION_FILES } from '../src/data/templates/aks-python/capstone.js'
import { startAksCapstoneIncident, stableAksCapstoneV2 } from '../src/lib/kubernetes/capstone/incident.js'

const state = run => run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId]
const command = line => ({ type: 'command', line })
const save = (path, text) => ({ type: 'save-file', path, text })
const verify = id => ({ type: 'aks-request', scenarioId: `capstone-${id}` })

describe('AKS capstone release and incident', () => {
  let lab, baseline, incident, injected, recovered, published, stalled, beforeInjection
  const act = (run, action) => {
    const result = applyRunAction(run, action, lab)
    expect(result.diagnostics, JSON.stringify(action)).toEqual([])
    if (action.type !== 'aks-request') expect(result.lines.filter(item => item.kind === 'err'), JSON.stringify(action)).toEqual([])
    return result.run
  }
  const reload = run => validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)
  beforeAll(() => {
    ;({ lab, run: baseline } = seedAksProductionAt('release'))
    incident = executeCapstoneStage(structuredClone(baseline), lab, 'release', { onTask(run, id) {
      if (id === 'published-v2') published = structuredClone(run)
    }, onAction(run, action, id) {
      if (id === 'rollback-recovered' && action.type === 'aks-advance' && action.seconds === 75) stalled = structuredClone(run)
    } })
    beforeInjection = structuredClone(incident)
    injected = act(incident, { type: 'aks-capstone-incident' })
    injected = act(injected, { type: 'aks-advance', seconds: 90 })
    injected = act(injected, verify('fault-route'))
    recovered = executeCapstoneStage(structuredClone(injected), lab, 'incident', { skipTasks: ['fault-route'] })
  }, 360000)
  it('executes six real Tasks and seals release/incident with current v2', () => {
    expect(recovered.stages.activeStageId).toBe('final-cleanup')
    expect(recovered.stages.sealedStages).toHaveLength(7)
    expect(stableAksCapstoneV2(recovered, lab)).toBe(true)
    expect(reload(recovered)).toEqual(recovered)
    expect(evaluateLab(lab, recovered).isComplete).toBe(false)
    expect(recovered.stages.sealedStages[5]).toEqual(incident.stages.sealedStages[5])
  })
  it('injects both declared faults atomically, captures the endpoint and repeats idempotently', () => {
    expect(state(injected).resources['Service/assistant/assistant-internal'].spec.ports[0].targetPort).toBe(8081)
    expect(state(injected).resources['Service/assistant/assistant-external'].spec.ports[0].targetPort).toBe(8081)
    expect(Object.values(state(injected).podSnapshots).filter(item => item.environment?.AI_ENDPOINT === 'https://ai-missing.example')).toHaveLength(2)
    expect(startAksCapstoneIncident(injected, lab).run).toEqual(injected)
    expect(reload(injected)).toEqual(injected)
    const observation = state(injected).diagnosis.incident.observations[0]
    expect(observation.records.request).toMatchObject({ status: null, transport: { reason: 'CONNECTION_REFUSED' }, dependencyTrace: [] })
    expect(observation.records.application).toEqual([])
    expect(observation.capsule.environment.AI_ENDPOINT).toBe('https://ai-missing.example')
  })
  it('rejects built-but-undeployed v2, old-Pod masking, missing handoff and stale source', () => {
    expect(stableAksCapstoneV2(published, lab)).toBe(false)
    const observed = act(structuredClone(published), verify('release-v2'))
    expect(observed.evidence.experimentsById[observed.evidence.currentEvidenceByTask['release-v2']].outcome).toBe('failed')
    expect(state(stalled).rollouts.experiment).toMatchObject({ incidentSeen: true, deadlineSeen: true })
    expect(state(stalled).rollouts.experiment.samples.at(-1).status).toBe(200)
    const premature = act(structuredClone(stalled), { type: 'aks-release-finish', scenarioId: 'capstone-rollback-recovered' })
    expect(state(premature).rollouts.receipts.at(-1).outcome).toBe('failed')
    const missingHandoff = act(structuredClone(published), save('k8s/hpa.yaml', '# not the completed HPA handoff\n'))
    expect(applyRunAction(missingHandoff, { type: 'aks-release-start', scenarioId: 'capstone-release-v2' }, lab).diagnostics).not.toEqual([])
    const sourceDrift = act(structuredClone(incident), save('app.py', incident.project.savedFiles['app.py'] + '\n# newer saved source\n'))
    expect(stableAksCapstoneV2(sourceDrift, lab)).toBe(false)
  })
  it('requires saved alignment after undo and accepts the forward-fix recovery path', () => {
    let undo = act(structuredClone(stalled), command('kubectl rollout undo deployment/assistant-api -n assistant'))
    expect(stableAksCapstoneV2(undo, lab)).toBe(false)
    undo = act(undo, { type: 'aks-release-finish', scenarioId: 'capstone-rollback-recovered' })
    expect(state(undo).rollouts.receipts.at(-1).outcome).toBe('failed')
    let forward = act(structuredClone(stalled), save('k8s/deployment.yaml', CAPSTONE_SOLUTION_FILES.v2['k8s/deployment.yaml']))
    forward = act(forward, command('kubectl apply -f k8s/deployment.yaml'))
    forward = act(forward, { type: 'aks-advance', seconds: 90 })
    forward = act(forward, { type: 'aks-release-finish', scenarioId: 'capstone-rollback-recovered' })
    expect(state(forward).rollouts.receipts.at(-1).outcome).toBe('passed')
    expect(reload(forward)).toEqual(forward)
  }, 60000)
  it('rejects unsafe injection baselines without partial saved/live edits', () => {
    const drafts = structuredClone(beforeInjection)
    drafts.project.draftFiles['app.py'] += '\n# unsaved draft'
    expect(startAksCapstoneIncident(drafts, lab).run).toEqual(drafts)
    expect(startAksCapstoneIncident(drafts, lab).diagnostics).not.toEqual([])
    const precondition = act(structuredClone(beforeInjection), save('k8s/service-internal.yaml', beforeInjection.project.savedFiles['k8s/service-internal.yaml'] + '\n'))
    const rejected = startAksCapstoneIncident(precondition, lab)
    expect(rejected.diagnostics).not.toEqual([])
    expect(rejected.run).toEqual(precondition)
    const fresh = act(structuredClone(beforeInjection), { type: 'aks-capstone-incident' })
    const tooEarly = act(fresh, verify('fault-route'))
    expect(tooEarly.evidence.experimentsById[tooEarly.evidence.currentEvidenceByTask['fault-route']].outcome).toBe('failed')
    expect(state(tooEarly).diagnosis.incident.observations).toEqual([])
  })
  it('accepts endpoint-first repair through labeled isolated history and requires refreshed environments', () => {
    let run = structuredClone(injected)
    for (const path of ['k8s/service-internal.yaml', 'k8s/service-external.yaml']) {
      run = act(run, save(path, CAPSTONE_SOLUTION_FILES.v2[path])); run = act(run, command(`kubectl apply -f ${path}`))
    }
    run = act(run, verify('fault-dependency'))
    run = act(run, save('k8s/configmap.yaml', CAPSTONE_SOLUTION_FILES.v2['k8s/configmap.yaml']))
    run = act(run, command('kubectl apply -f k8s/configmap.yaml'))
    run = act(run, verify('incident-recovered'))
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['incident-recovered']].outcome).toBe('failed')
    expect(reload(run)).toEqual(run)
    let reverse = act(structuredClone(injected), save('k8s/configmap.yaml', CAPSTONE_SOLUTION_FILES.v2['k8s/configmap.yaml']))
    reverse = act(reverse, command('kubectl apply -f k8s/configmap.yaml'))
    reverse = act(reverse, command('kubectl rollout restart deployment/assistant-api -n assistant'))
    reverse = act(reverse, { type: 'aks-advance', seconds: 90 })
    expect(reload(reverse)).toEqual(reverse)
    const historical = applyRunAction(reverse, verify('fault-dependency'), lab)
    expect(historical.diagnostics).toEqual([])
    expect(historical.lines[0].text).toMatch(/^Historical incident-snapshot probe:/)
    reverse = historical.run
    expect(reverse.evidence.experimentsById[reverse.evidence.currentEvidenceByTask['fault-dependency']].measurements).toMatchObject({ origin: 'incident-snapshot', historical: true, status: 502 })
    for (const path of ['k8s/service-internal.yaml', 'k8s/service-external.yaml']) {
      reverse = act(reverse, save(path, CAPSTONE_SOLUTION_FILES.v2[path])); reverse = act(reverse, command(`kubectl apply -f ${path}`))
    }
    const retainedRoute = applyRunAction(reverse, verify('fault-route'), lab)
    expect(retainedRoute.diagnostics).toEqual([])
    expect(retainedRoute.lines[0].text).toMatch(/^Historical observed-live request:/)
    expect(retainedRoute.lines[0].measurements.observationOrigin).toBe('observed-live-history')
    reverse = retainedRoute.run
    reverse = act(reverse, verify('incident-recovered'))
    expect(reverse.evidence.experimentsById[reverse.evidence.currentEvidenceByTask['incident-recovered']].outcome).toBe('passed')
    expect(reload(reverse)).toEqual(reverse)
    reverse = act(reverse, { type: 'aks-advance-stage' })
    expect(reverse.stages.activeStageId).toBe('final-cleanup')
  }, 60000)
  it('preserves superseded unsealed anchors through pruning, failures and seals', () => {
    let run = structuredClone(injected)
    const original = structuredClone(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['fault-route']])
    for (let index = 0; index < 12; index++) {
      run = act(run, verify('fault-route'))
      if (index % 4 === 0) run = act(run, verify('incident-recovered'))
    }
    expect(state(run).diagnosis.incident.observations).toHaveLength(10)
    expect(run.evidence.experimentsById[original.id]).toEqual(original)
    expect(reload(run)).toEqual(run)
    run = executeCapstoneStage(run, lab, 'incident', { skipTasks: ['fault-route'] })
    expect(reload(run)).toEqual(run)
    // Actual cluster deletion/reload is exercised after a genuine final-proof
    // freeze by aks-capstone-cleanup.test.js. Cloud deletion is gated here.
    expect(applyRunAction(run, command('az group delete -n rg-aks-capstone --yes'), lab).diagnostics[0]?.code).toBe('AKS_CLEANUP_CHECKPOINT_REQUIRED')
    expect(run.evidence.experimentsById[original.id]).toEqual(original)
    const corrupted = structuredClone(run)
    corrupted.evidence.experimentsById[original.id].measurements.diagnosisProvenance.capturedEndpoint = 'https://ai-training.example'
    expect(() => reload(corrupted)).toThrow()
  }, 90000)
})

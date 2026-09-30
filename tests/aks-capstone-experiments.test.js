import { beforeAll, describe, expect, it } from 'vitest'
import { seedAksProductionAt, executeCapstoneResilience } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { getAksCapstonePolicy } from '../src/lib/kubernetes/capstone/policy.js'
import { CAPSTONE_TARGET } from '../src/data/labs/aks-journey/capstone-helpers.js'
import { CAPSTONE_SOLUTION_FILES } from '../src/data/templates/aks-python/capstone.js'
import { measuredMilestone, releaseBaselineReady } from '../src/lib/kubernetes/capstone/resilience.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { verifyAksCapstone } from '../src/lib/kubernetes/capstone/evidence.js'
import { parse, stringify } from 'yaml'

const state = run => run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId]
const pods = run => getDeploymentPods(run, CAPSTONE_TARGET.clusterId, 'assistant', 'assistant-api')
const command = line => ({ type: 'command', line })
const save = (path, text) => ({ type: 'save-file', path, text })
const errors = result => [...result.diagnostics.map(item => item.message), ...result.lines.filter(line => line.kind === 'err').map(line => line.text)]

describe('AKS capstone resilience', () => {
  let baseline, lab, complete, coldStart, hpaStart, hpaDone
  const prefixes = {}
  const act = (run, action) => { const result = applyRunAction(run, action, lab); expect(errors(result)).toEqual([]); return result.run }
  beforeAll(() => { ({ run: baseline, lab } = seedAksProductionAt('resilience')) })
  it('executes seven real measured Tasks, keeps milestones historical and seals stage five', () => {
    complete = executeCapstoneResilience(structuredClone(baseline), lab, {
      onAction(run, action) {
        if (action.type === 'aks-probe-start' && action.scenarioId === 'capstone-startup-proof') coldStart = structuredClone(run)
        if (action.type === 'aks-resource-start' && action.scenarioId === 'capstone-hpa-cycle') hpaStart = structuredClone(run)
        if (action.type === 'aks-advance' && action.seconds === 300) hpaDone = structuredClone(run)
      }, onTask(run, id) { prefixes[id] = structuredClone(run) },
    })
    const tasks = evaluateLab(lab, complete).tasks.filter(task => lab.stages[4].taskIds.includes(task.id))
    expect(tasks.map(task => [task.id, task.status])).toEqual(lab.stages[4].taskIds.map(id => [id, 'done']))
    const next = applyRunAction(complete, { type: 'aks-advance-stage' }, lab)
    expect(next.diagnostics).toEqual([])
    expect(next.run.stages.activeStageId).toBe('release')
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(next.run)), lab)).toEqual(next.run)
    expect(getAksCapstonePolicy(next.run, lab).allowHpa).toBe(false)
  })
  it('recreates exactly two age-zero Pods under the same ReplicaSet and measures all three probe criteria', () => {
    const before = pods(baseline), after = pods(coldStart)
    expect(after).toHaveLength(2)
    expect(after.every(pod => !before.some(old => old.metadata.uid === pod.metadata.uid))).toBe(true)
    expect(after.map(pod => pod.metadata.ownerReferences[0].uid)).toEqual(before.map(pod => pod.metadata.ownerReferences[0].uid))
    for (const pod of after) {
      const container = state(coldStart).health.containers[pod.metadata.uid]
      expect(container.startedAtMs).toBe(coldStart.runtime.simTimeMs)
      expect(container.initializedAtMs).toBe(container.startedAtMs + 6000)
      expect(container.restartCount).toBe(0)
    }
    const cold = measuredMilestone(complete, 'startup-proof').record.measurements.probeReceipt
    expect(cold.summary.facts.firstStartupSuccessAt - cold.startedAtMs).toBeGreaterThanOrEqual(6000)
    expect(cold.summary.facts.earlyGatedCheck).toBe(false)
    const ready = measuredMilestone(complete, 'readiness-proof').record.measurements.probeReceipt
    const transitions = ready.summary.facts.readiness[ready.podUids[0]]
    expect(transitions.withdrawnAt - ready.baselineReadyAtMs).toBeLessThanOrEqual(9000)
    expect(transitions.reenteredAt - ready.baselineReadyAtMs).toBeLessThanOrEqual(25000)
    expect(ready.summary.restartReceipts).toEqual([])
    const hang = measuredMilestone(complete, 'liveness-proof').record.measurements.probeReceipt
    expect(hang.summary.restartReceipts.some(receipt => receipt.podUid === hang.podUids[0] && receipt.oldContainerId !== receipt.newContainerId)).toBe(true)
    expect(state(prefixes['liveness-proof']).health.receipts.find(receipt => receipt.scenarioId === 'capstone-liveness-proof').samples.at(-1).response.body.sources).toContain('training-backups')
    expect(state(coldStart).health.experiment.fingerprint.externalServiceName).toBe('assistant-external')
  })
  it('retains genuine workload conservation, HPA decisions and AI wait measurements after handoff', () => {
    const manual = measuredMilestone(complete, 'manual-capacity').record.measurements
    expect(manual.totals).toMatchObject({ arrivals: 300, completed: 300, remaining: 0 })
    const cycle = measuredMilestone(complete, 'hpa-cycle').record.measurements
    expect(cycle.totals).toMatchObject({ arrivals: 2580, completed: 2580, remaining: 0 })
    expect(cycle.scaleReceipts.some(item => item.cause === 'hpa' && item.from === 2 && item.to === 4)).toBe(true)
    expect(cycle.scaleReceipts.some(item => item.cause === 'hpa' && item.to === 2 && item.from > 2)).toBe(true)
    const ai = measuredMilestone(complete, 'ai-wait').record.measurements
    expect(ai.totals).toMatchObject({ arrivals: 1680, completed: 1680, remaining: 0 })
    expect(ai.scaleReceipts.some(item => item.to > item.from)).toBe(false)
    expect(ai.samples.every(item => item.profileId === 'answer-wait-150ms')).toBe(true)
    expect(Object.values(complete.evidence.aksCapstoneReceipts).every(proof => JSON.stringify(proof).length <= 16384)).toBe(true)
  })
  it('fails handoff with live HPA, stale saved HPA definition or omitted explicit replicas', () => {
    expect(releaseBaselineReady(prefixes['ai-wait'])).toBe(false)
    expect(applyRunAction(prefixes['ai-wait'], { type: 'aks-advance-stage' }, lab).diagnostics[0].code).toBe('AKS_STAGE_INCOMPLETE')
    let changed = act(complete, save('k8s/hpa.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/hpa.yaml']))
    expect(releaseBaselineReady(changed)).toBe(false)
    changed = act(complete, save('k8s/deployment.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/deployment.yaml']))
    expect(releaseBaselineReady(changed)).toBe(false)
    changed = act(prefixes['ai-wait'], command('kubectl delete hpa assistant-cpu -n assistant'))
    expect(releaseBaselineReady(changed)).toBe(false)
  })
  it('rejects concurrent experiments, stale source and manually fabricated capacity proof', () => {
    expect(applyRunAction(coldStart, { type: 'aks-resource-start', scenarioId: 'capstone-manual-capacity' }, lab).diagnostics.length).toBeGreaterThan(0)
    const changed = act(baseline, save('app.py', baseline.project.savedFiles['app.py'] + '\n# unpublished edit\n'))
    expect(applyRunAction(changed, { type: 'aks-probe-start', scenarioId: 'capstone-startup-proof' }, lab).diagnostics.length).toBeGreaterThan(0)
    const scaled = act(baseline, command('kubectl scale deployment/assistant-api --replicas=4 -n assistant'))
    expect(verifyAksCapstone(scaled, lab, 'capstone-hpa-cycle').result.outcome).toBe('failed')
  })
  it('rejects HPA outside resilience and template apply/restart/undo while HPA exists, with dry-run parity', () => {
    const released = act(complete, { type: 'aks-advance-stage' })
    const changed = act(released, save('k8s/hpa.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/hpa.yaml']))
    for (const suffix of ['', ' --dry-run=client -o yaml']) expect(errors(applyRunAction(changed, command(`kubectl apply -f k8s/hpa.yaml${suffix}`), lab)).length).toBeGreaterThan(0)
    const template = act(prefixes['hpa-cycle'], save('k8s/deployment.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/deployment.yaml'].replace('/health/ready', '/health/live')))
    for (const line of ['kubectl apply -f k8s/deployment.yaml', 'kubectl apply -f k8s/deployment.yaml --dry-run=client -o yaml', 'kubectl rollout restart deployment/assistant-api -n assistant', 'kubectl rollout undo deployment/assistant-api -n assistant']) {
      const result = applyRunAction(template, command(line), lab)
      expect(errors(result).join(' ')).toContain('Pod-template')
      expect(state(result.run).resources).toEqual(state(template).resources)
    }
  })
  it('rejects a resource measurement when current Pods have stale configuration', () => {
    let changed = act(prefixes['manual-capacity'], save('k8s/configmap.yaml', prefixes['manual-capacity'].project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: changed')))
    changed = act(changed, command('kubectl apply -f k8s/configmap.yaml'))
    expect(applyRunAction(changed, { type: 'aks-resource-start', scenarioId: 'capstone-manual-capacity' }, lab).diagnostics.length).toBeGreaterThan(0)
  })
  it('resumes through scale-in on the same shared clock with equivalent measured outcomes', () => {
    let chunked = act(hpaStart, { type: 'aks-advance', seconds: 180 })
    chunked = validateBehavioralRun(JSON.parse(JSON.stringify(chunked)), lab)
    chunked = act(chunked, { type: 'aks-advance', seconds: 120 })
    expect(chunked.runtime.simTimeMs).toBe(hpaDone.runtime.simTimeMs)
    expect(state(chunked).resourcesRuntime.experiment.totals).toEqual(state(hpaDone).resourcesRuntime.experiment.totals)
    expect(state(chunked).resourcesRuntime.experiment.scaleReceipts).toEqual(state(hpaDone).resourcesRuntime.experiment.scaleReceipts)
    expect(state(chunked).resourcesRuntime.experiment.outcome).toBe('passed')
  })
  it('preserves an omitted server restart annotation but rejects an explicit change under HPA', () => {
    let changed = act(baseline, command('kubectl rollout restart deployment/assistant-api -n assistant'))
    changed = act(changed, { type: 'aks-advance', seconds: 90 })
    changed = act(changed, save('k8s/deployment.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/deployment.yaml']))
    changed = act(changed, command('kubectl apply -f k8s/deployment.yaml'))
    changed = act(changed, { type: 'aks-advance', seconds: 30 })
    changed = act(changed, save('k8s/hpa.yaml', CAPSTONE_SOLUTION_FILES.scale['k8s/hpa.yaml']))
    changed = act(changed, command('kubectl apply -f k8s/hpa.yaml'))
    changed = act(changed, command('kubectl apply -f k8s/deployment.yaml'))
    const document = parse(changed.project.savedFiles['k8s/deployment.yaml'])
    document.spec.template.metadata.annotations = { 'kubectl.kubernetes.io/restarted-at': 'learner-change' }
    changed = act(changed, save('k8s/deployment.yaml', stringify(document)))
    const result = applyRunAction(changed, command('kubectl apply -f k8s/deployment.yaml'), lab)
    expect(errors(result).join(' ')).toContain('Pod-template')
    expect(state(result.run).resources).toEqual(state(changed).resources)
  })
})

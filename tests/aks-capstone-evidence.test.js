import { describe, it, expect, beforeAll } from 'vitest'
import { aksCapstoneLab } from '../src/data/labs/aks-journey/capstone.lab.js'
import { verifyAksCapstone } from '../src/lib/kubernetes/capstone/evidence.js'
import { CAPSTONE_SOLUTION_FILES } from '../src/data/templates/aks-python/capstone.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { seedAksProductionAt } from './helpers/aks.js'
import { resolveServiceDns } from '../src/lib/kubernetes/connectivity.js'

const act = (run, action) => {
  const result = applyRunAction(run, action, aksCapstoneLab)
  expect(result.diagnostics).toEqual([])
  return result.run
}

describe('AKS capstone first four stages', () => {
  it('declares all 31 uniquely verified Tasks and fails future stages closed', () => {
    const lab = aksCapstoneLab
    expect(lab.stages.map(stage => stage.taskIds.length)).toEqual([1, 3, 3, 4, 7, 3, 3, 7])
    expect(new Set(lab.tasks.map(task => task.id)).size).toBe(31)
    expect(lab.tasks.every(task => task.hints.length === 2 && task.solution.steps.length > 0 && task.examNote)).toBe(true)
    const run = createBehavioralRun(lab, { attemptId: 'capstone-evidence-test' })
    expect(verifyAksCapstone(run, lab, 'capstone-answer-backups').result.measurements.reason).toBe('stage-locked')
  })

  it('keeps source preview distinct from built and deployed proof', () => {
    let run = createBehavioralRun(aksCapstoneLab, { attemptId: 'capstone-source-test' })
    expect(verifyAksCapstone(run, aksCapstoneLab, 'capstone-source-contract').result.outcome).toBe('failed')
    for (const [path, text] of Object.entries(CAPSTONE_SOLUTION_FILES.v1))
      if (run.project.savedFiles[path] !== text) run = act(run, { type: 'save-file', path, text })
    const preview = verifyAksCapstone(run, aksCapstoneLab, 'capstone-source-contract')
    expect(preview.result.outcome).toBe('passed')
    expect(preview.result.measurements.artifactId).toBeNull()
    expect(run.sandbox.aksClusters).toEqual([])
    run = act(run, { type: 'aks-request', scenarioId: 'capstone-source-contract' })
    run = act(run, { type: 'aks-advance-stage' })
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksCapstoneLab)).toEqual(run)
    expect(verifyAksCapstone(run, aksCapstoneLab, 'capstone-image-v1').result.outcome).toBe('failed')
  })

  it('seals the first four stages through ordinary saved files, commands and Verify actions', () => {
    const { run } = seedAksProductionAt('resilience')
    expect(run.stages.sealedStages.map(seal => seal.stageId)).toEqual(['source', 'provision', 'deploy', 'behavior'])
    expect(run.stages.sealedStages.flatMap(seal => seal.taskIds)).toHaveLength(11)
    const routeEvidence = run.evidence.experimentsById[run.evidence.currentEvidenceByTask['routing-ready']]
    expect(routeEvidence.measurements.internalStatus).toBe(200)
    expect(routeEvidence.measurements.externalStatus).toBe(200)
    expect(routeEvidence.measurements.internalDns).toMatchObject({ ok: true,
      serviceKey: 'Service/assistant/assistant-internal', canonicalName: 'assistant-internal.assistant.svc.cluster.local' })
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksCapstoneLab)).toEqual(run)
  })

  it('requires an actual deployed source artifact for assistant behavior', () => {
    const { lab, run } = seedAksProductionAt('deploy')
    const result = verifyAksCapstone(run, lab, 'capstone-answer-backups')
    expect(result.result.outcome).toBe('failed')
    expect(result.result.measurements.reason).toBe('stage-locked')
  })

  it('does not count an ACR build as an attached cluster or running deployment', () => {
    let { lab, run } = seedAksProductionAt('provision')
    run = act(run, { type: 'command', line: 'az group create -n rg-aks-capstone -l westeurope' })
    run = act(run, { type: 'command', line: 'az acr create -g rg-aks-capstone -n acrakscapstone --sku Basic' })
    run = act(run, { type: 'command', line: 'az acr build --registry acrakscapstone --image assistant:capstone-v1 .' })
    expect(verifyAksCapstone(run, lab, 'capstone-image-v1').result.outcome).toBe('passed')
    expect(verifyAksCapstone(run, lab, 'capstone-cluster-connected').result.outcome).toBe('failed')
    run = act(run, { type: 'command', line: 'az aks create -g rg-aks-capstone -n aks-capstone --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys' })
    expect(verifyAksCapstone(run, lab, 'capstone-cluster-connected').result.outcome).toBe('failed')
    run = act(run, { type: 'command', line: 'az aks update -g rg-aks-capstone -n aks-capstone --attach-acr acrakscapstone' })
    expect(verifyAksCapstone(run, lab, 'capstone-cluster-connected').result.outcome).toBe('failed')
    run = act(run, { type: 'command', line: 'az aks get-credentials -g rg-aks-capstone -n aks-capstone' })
    expect(verifyAksCapstone(run, lab, 'capstone-cluster-connected').result.outcome).toBe('passed')
  })

  it('requires the assistant namespace before config evidence', () => {
    const { lab, run } = seedAksProductionAt('deploy')
    expect(verifyAksCapstone(run, lab, 'capstone-config-applied').result.outcome).toBe('failed')
    expect(run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Namespace//assistant']).toBeUndefined()
  })

  describe('deployed regressions', () => {
    let baseline
    beforeAll(() => { baseline = seedAksProductionAt('behavior') })

    it('rejects a saved source edit until a matching image reaches every Pod', () => {
      let run = structuredClone(baseline.run)
      run = act(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# changed after publication\n' })
      expect(verifyAksCapstone(run, baseline.lab, 'capstone-answer-backups').result.outcome).toBe('failed')
    })

    it('captures correlated start and completion logs from the routed application request', () => {
      const verified = verifyAksCapstone(baseline.run, baseline.lab, 'capstone-answer-backups')
      expect(verified.result.outcome).toBe('passed')
      expect(verified.result.measurements.applicationLogProof).toEqual({ started: true, completed: true })
    })

    it('rejects changed current configuration still absent from Pod snapshots', () => {
      let run = structuredClone(baseline.run)
      const path = 'k8s/configmap.yaml'
      run = act(run, { type: 'save-file', path, text: run.project.savedFiles[path].replace('APP_ENV: training', 'APP_ENV: review') })
      run = act(run, { type: 'command', line: `kubectl apply -f ${path}` })
      expect(verifyAksCapstone(run, baseline.lab, 'capstone-answer-backups').result.outcome).toBe('failed')
    })

    it('requires the fixed two-Pod deployment rather than one successful backend', () => {
      let run = structuredClone(baseline.run)
      run = act(run, { type: 'command', line: 'kubectl scale deployment/assistant-api --replicas 3 -n assistant' })
      expect(verifyAksCapstone(run, baseline.lab, 'capstone-answer-backups').result.outcome).toBe('failed')
    })

    it('rejects release settings that weaken deployment readiness', () => {
      let run = structuredClone(baseline.run)
      const path = 'k8s/deployment.yaml'
      run = act(run, { type: 'save-file', path, text: run.project.savedFiles[path].replace('minReadySeconds: 5', 'minReadySeconds: 0') })
      run = act(run, { type: 'command', line: `kubectl apply -f ${path}` })
      expect(verifyAksCapstone(run, baseline.lab, 'capstone-answer-backups').result.outcome).toBe('failed')
    })

    it('does not resolve the internal Service from a different namespace name', () => {
      const dns = resolveServiceDns(baseline.run, { clusterId: baseline.run.sandbox.aksClusters[0].id,
        clientNamespace: 'default', hostname: 'assistant-internal.default.svc.cluster.local' })
      expect(dns).toMatchObject({ ok: false, reason: 'DNS_NOT_FOUND', serviceKey: null })
    })
  })
})

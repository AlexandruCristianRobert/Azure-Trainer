import { describe, expect, it } from 'vitest'
import { aksDeployTroubleshootingLab } from '../src/data/labs/aks-journey/deploy-troubleshooting.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { act, executeAksSolution } from './helpers/aks.js'

function executeAll(run, { skip = [] } = {}) {
  for (const task of aksDeployTroubleshootingLab.tasks) {
    if (!skip.includes(task.id)) run = executeAksSolution(run, aksDeployTroubleshootingLab, task)
  }
  return run
}

describe('AKS deployment troubleshooting Lab', () => {
  it('describes observable symptoms without giving away the diagnosis and labels its recovery request', () => {
    expect(aksDeployTroubleshootingLab.brief).not.toMatch(/staging|missing tag|pull failure/i)
    const recovery = aksDeployTroubleshootingLab.tasks.find(task => task.id === 'recovery')
    expect(recovery.solution.steps.at(-1)).toMatchObject({ kind: 'scenario', scenarioId: 'troubleshooting-recovery' })
    expect(recovery.solution.steps.at(-1).instruction).toMatch(/recovery|request|response/i)
  })

  it('seeds the staging-context incident without learner credit', () => {
    const run = createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'incident' })
    const cluster = run.sandbox.aksClusters.find(item => item.name === 'aks-troubleshooting')
    expect(run.runtime.kubernetes.contexts[run.runtime.kubernetes.currentContext]).toMatchObject({ clusterId: cluster.id, namespace: 'staging' })
    expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('namespace: staging')
    expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('assistant:missing')
    expect(Object.values(run.runtime.kubernetes.clusters[cluster.id].resources)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Deployment', metadata: expect.objectContaining({ namespace: 'staging' }) }),
      expect.objectContaining({ kind: 'Service', metadata: expect.objectContaining({ namespace: 'staging' }) }),
    ]))
    expect(evaluateLab(aksDeployTroubleshootingLab, run).tasks.every(task => !task.done)).toBe(true)
  })

  it('cannot pass by fixing only the visible namespace mistake', () => {
    let run = createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'partial' })
    const task = aksDeployTroubleshootingLab.tasks.find(item => item.id === 'target-namespace')
    run = executeAksSolution(run, aksDeployTroubleshootingLab, task)
    expect(evaluateLab(aksDeployTroubleshootingLab, run).isComplete).toBe(false)
    expect(Object.values(run.runtime.kubernetes.clusters).flatMap(cluster => cluster.events)
      .some(event => ['RegistryAccessDenied', 'ImageNotFound'].includes(event.reason))).toBe(true)
  })

  it('records the selected published image in saved YAML before the target Deployment is applied', () => {
    let run = createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'published-image' })
    const task = aksDeployTroubleshootingLab.tasks.find(item => item.id === 'published-image')
    run = executeAksSolution(run, aksDeployTroubleshootingLab, task)
    expect(evaluateLab(aksDeployTroubleshootingLab, run).tasks.find(item => item.id === 'published-image').done).toBe(true)
    const cluster = run.sandbox.aksClusters.find(item => item.name === 'aks-troubleshooting')
    expect(run.runtime.kubernetes.clusters[cluster.id].resources['Deployment/assistant/assistant']).toBeUndefined()
  })

  it('completes the authored recovery after all independent repairs and an observed request', () => {
    const run = executeAll(createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'full' }))
    expect(evaluateLab(aksDeployTroubleshootingLab, run).isComplete).toBe(true)
    expect(Object.values(run.evidence.experimentsById).at(-1)).toMatchObject({ outcome: 'passed', measurements: { body: {
      service: 'knowledge-assistant', version: '1.0', environment: 'training',
    } } })
  })

  it('recovers when registry access is repaired before the corrected manifests are applied', () => {
    let run = createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'reversed' })
    for (const id of ['registry-access', 'target-namespace', 'repaired-manifests', 'recovery']) {
      run = executeAksSolution(run, aksDeployTroubleshootingLab, aksDeployTroubleshootingLab.tasks.find(task => task.id === id))
    }
    expect(evaluateLab(aksDeployTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('does not accept a request against a different cluster as recovery evidence', () => {
    let run = executeAll(createBehavioralRun(aksDeployTroubleshootingLab, { attemptId: 'decoy' }), { skip: ['recovery'] })
    run = act(run, aksDeployTroubleshootingLab, { type: 'command', line: 'az group create -n rg-decoy -l eastus' }).run
    run = act(run, aksDeployTroubleshootingLab, { type: 'command', line: 'az aks create -g rg-decoy -n aks-decoy --enable-managed-identity --generate-ssh-keys' }).run
    run = act(run, aksDeployTroubleshootingLab, { type: 'command', line: 'az aks get-credentials -g rg-decoy -n aks-decoy' }).run
    run = act(run, aksDeployTroubleshootingLab, { type: 'aks-request', scenarioId: 'troubleshooting-recovery' }).run
    expect(evaluateLab(aksDeployTroubleshootingLab, run).isComplete).toBe(false)
  })

  it('restores an incomplete incident without fabricating recovery evidence', async () => {
    const { fakeLocalStorage } = await import('./helpers/fakeLocalStorage.js')
    const { behavioralRepository } = await import('./helpers/behavioralRepository.js')
    const { createPinia, setActivePinia } = await import('pinia')
    const { useLabRunStore } = await import('../src/stores/labRun.js')
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(aksDeployTroubleshootingLab.id, { repository, lab: aksDeployTroubleshootingLab })
    await store.dispatchBehavioral({ type: 'command', line: 'kubectl config set-context --current --namespace assistant' })
    const attemptId = store.behavioralRun.attemptId
    await store.load(aksDeployTroubleshootingLab.id, { repository, lab: aksDeployTroubleshootingLab })
    expect(store.behavioralRun.attemptId).toBe(attemptId)
    expect(store.isComplete).toBe(false)
    expect(Object.keys(store.behavioralRun.evidence.experimentsById)).toHaveLength(0)
  })
})

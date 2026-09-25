import { describe, expect, it } from 'vitest'
import { aksDeployGuidedLab } from '../src/data/labs/aks-journey/deploy-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'

function executeAll(run, { skip = [] } = {}) {
  for (const task of aksDeployGuidedLab.tasks) {
    if (!skip.includes(task.id)) run = executeAksSolution(run, aksDeployGuidedLab, task)
  }
  return run
}

describe('guided AKS deployment Lab', () => {
  it('declares the guided stages and complete, actionable support for every Task', () => {
    expect(aksDeployGuidedLab).toMatchObject({
      id: 'aks-deploy-guided', engineVersion: 2, contentVersion: 1,
      journeyId: 'aks-knowledge-assistant', journeyOrder: 1, labMode: 'guided',
      skillAreaId: 'containers', service: 'aks', status: 'available',
    })
    expect(aksDeployGuidedLab.stages.map(stage => stage.title)).toEqual([
      'Prepare', 'Publish and connect', 'Deploy', 'Verify recovery',
    ])
    for (const task of aksDeployGuidedLab.tasks) {
      expect(task.hints, task.id).toHaveLength(2)
      expect(task.hints[0], task.id).not.toEqual(task.hints[1])
      expect(task.examNote, task.id).toBeTruthy()
      expect(task.explanation, task.id).toBeTruthy()
      expect(task.solution.steps.length, task.id).toBeGreaterThan(0)
      expect(task.solution.steps.every(step => ['file', 'command', 'scenario', 'inspect'].includes(step.kind)), task.id).toBe(true)
    }
    expect(aksDeployGuidedLab.tasks.map(task => task.id)).toEqual([
      'python-source', 'dockerfile', 'publish', 'cluster', 'registry-access', 'deployment', 'info', 'replacement',
    ])
  })

  it('completes only after a current request and observed Pod replacement', () => {
    let run = createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-test' })
    run = executeAll(run, { skip: ['replacement'] })
    expect(evaluateLab(aksDeployGuidedLab, run).isComplete).toBe(false)
    const clusterId = run.sandbox.aksClusters[0].id
    const pod = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
    run = act(run, aksDeployGuidedLab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }).run
    run = act(run, aksDeployGuidedLab, { type: 'aks-request', scenarioId: 'guided-info' }).run
    run = act(run, aksDeployGuidedLab, { type: 'aks-request', scenarioId: 'guided-replacement' }).run
    expect(evaluateLab(aksDeployGuidedLab, run).isComplete).toBe(true)
  })

  it('executes the declared worked Solutions, including their owned-Pod resolver', () => {
    const run = executeAll(createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-worked-solution' }))
    expect(evaluateLab(aksDeployGuidedLab, run).isComplete).toBe(true)
    expect(run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].receipts.some(receipt => receipt.cause === 'pod-delete')).toBe(true)
  })

  it('does not count a failed desired Deployment, then requires a fresh request after recovery', () => {
    let run = createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-recovery' })
    run = executeAll(run, { skip: ['deployment', 'info', 'replacement'] })
    const brokenDeployment = aksDeployGuidedLab.solutionFiles['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:missing')
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/namespace.yaml', text: aksDeployGuidedLab.solutionFiles['k8s/namespace.yaml'] }).run
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: brokenDeployment }).run
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/service.yaml', text: aksDeployGuidedLab.solutionFiles['k8s/service.yaml'] }).run
    for (const path of ['k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml']) {
      run = act(run, aksDeployGuidedLab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    }
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'deployment').done).toBe(false)
    const clusterId = run.sandbox.aksClusters[0].id
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').every(pod => pod.status.phase !== 'Running')).toBe(true)
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: aksDeployGuidedLab.solutionFiles['k8s/deployment.yaml'] }).run
    run = act(run, aksDeployGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'deployment').done).toBe(true)
    run = act(run, aksDeployGuidedLab, { type: 'aks-request', scenarioId: 'guided-info' }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'info').done).toBe(true)
  })

  it('keeps captured running Pods deployed after the kubelet pull grant is revoked', () => {
    let run = executeAll(createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-revoked-pull' }), { skip: ['info', 'replacement'] })
    const clusterId = run.sandbox.aksClusters[0].id
    const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(pod => pod.metadata.uid)
    run = act(run, aksDeployGuidedLab, { type: 'command', line: 'az aks update -g rg-aks-guided -n aks-guided --detach-acr acraksguided' }).run
    const state = evaluateLab(aksDeployGuidedLab, run)
    expect(state.tasks.find(task => task.id === 'registry-access').done).toBe(false)
    expect(state.tasks.find(task => task.id === 'deployment').done).toBe(true)
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(pod => pod.metadata.uid)).toEqual(before)
  })

  it('does not count a Service whose selector matches no ready assistant Pods', () => {
    let run = executeAll(createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-service-selector' }), { skip: ['info', 'replacement'] })
    const brokenService = aksDeployGuidedLab.solutionFiles['k8s/service.yaml']
      .replace('selector:\n    app: assistant', 'selector:\n    app: assistant\n    tier: nonexistent')
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/service.yaml', text: brokenService }).run
    run = act(run, aksDeployGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'deployment').done).toBe(false)
  })

  it('accepts equivalent Python and YAML formatting while requiring environment lookup and equivalent objects', () => {
    let run = createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-format' })
    const source = aksDeployGuidedLab.solutionFiles['app.py']
      .replace('SERVICE_VERSION = "1.0"', "SERVICE_VERSION='1.0'")
      .replace('os.environ.get("APP_ENV", "development")', "os.environ.get('APP_ENV', 'development')")
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'app.py', text: source }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'python-source').done).toBe(true)
    run = executeAll(run, { skip: ['python-source', 'info', 'replacement'] })
    const service = aksDeployGuidedLab.solutionFiles['k8s/service.yaml']
      .replace('apiVersion: v1\nkind: Service', 'kind: Service\napiVersion: v1')
      .replace('targetPort: http', 'targetPort: 8080')
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'k8s/service.yaml', text: service }).run
    run = act(run, aksDeployGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'deployment').done).toBe(true)
    run = act(run, aksDeployGuidedLab, { type: 'aks-request', scenarioId: 'guided-info' }).run
    expect(Object.values(run.evidence.experimentsById).at(-1)).toMatchObject({ outcome: 'passed', measurements: { body: { environment: 'training' } } })
  })

  it('requires the APP_ENV lookup to default to development', () => {
    let run = createBehavioralRun(aksDeployGuidedLab, { attemptId: 'guided-source-default' })
    const source = aksDeployGuidedLab.solutionFiles['app.py'].replace('os.environ.get("APP_ENV", "development")', 'os.environ.get("APP_ENV", "production")')
    run = act(run, aksDeployGuidedLab, { type: 'save-file', path: 'app.py', text: source }).run
    expect(evaluateLab(aksDeployGuidedLab, run).tasks.find(task => task.id === 'python-source').done).toBe(false)
  })

  it('resumes saved Task state and assistance without marking work complete', async () => {
    const { fakeLocalStorage } = await import('./helpers/fakeLocalStorage.js')
    const { behavioralRepository } = await import('./helpers/behavioralRepository.js')
    const { createPinia, setActivePinia } = await import('pinia')
    const { useLabRunStore } = await import('../src/stores/labRun.js')
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repo = behavioralRepository(), store = useLabRunStore()
    await store.load(aksDeployGuidedLab.id, { repository: repo, lab: aksDeployGuidedLab })
    await store.dispatchBehavioral({ type: 'draft', path: 'app.py', text: aksDeployGuidedLab.solutionFiles['app.py'] })
    await store.dispatchBehavioral({ type: 'save-file', path: 'app.py' })
    await store.revealHint('python-source')
    const attempt = store.behavioralRun.attemptId
    await store.load(aksDeployGuidedLab.id, { repository: repo, lab: aksDeployGuidedLab })
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.hintsUsed).toBe(1)
    expect(store.doneCount).toBe(2)
    expect(store.taskStates.find(task => task.id === 'dockerfile').done).toBe(true)
    expect(store.taskStates.find(task => task.id === 'python-source').done).toBe(true)
    expect(store.isComplete).toBe(false)
  })

  it('shows valid Tasks after Kubernetes state enters reactive Pinia', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { useLabRunStore } = await import('../src/stores/labRun.js')
    const { behavioralRepository } = await import('./helpers/behavioralRepository.js')
    const { fakeLocalStorage } = await import('./helpers/fakeLocalStorage.js')
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const store = useLabRunStore()
    await store.load(aksDeployGuidedLab.id, { repository: behavioralRepository(), lab: aksDeployGuidedLab })
    const run = executeAll(createBehavioralRun(aksDeployGuidedLab, { attemptId: 'reactive-pods' }), { skip: ['info', 'replacement'] })
    store.behavioralRun = run
    expect(store.taskStates.map(task => [task.id, task.done])).toEqual(
      evaluateLab(aksDeployGuidedLab, run).tasks.map(task => [task.id, task.done]),
    )
    expect(store.doneCount).toBe(6)
  })
})

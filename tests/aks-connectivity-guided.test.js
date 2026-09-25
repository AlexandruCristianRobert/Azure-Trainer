import { describe, expect, it } from 'vitest'
import { aksConnectivityGuidedLab } from '../src/data/labs/aks-journey/connectivity-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'

const taskDone = (run, id) => evaluateLab(aksConnectivityGuidedLab, run).tasks.find(task => task.id === id).done

describe('guided AKS connectivity Lab', () => {
  it('completes from a fresh standalone run using the authored Solutions', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network' })
    for (const task of aksConnectivityGuidedLab.tasks) run = executeAksSolution(run, aksConnectivityGuidedLab, task)
    expect(evaluateLab(aksConnectivityGuidedLab, run).isComplete).toBe(true)
  })

  it('requires a rebuilt listener artifact and both correctly scoped Service types', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-bypass' })
    const listener = aksConnectivityGuidedLab.tasks.find(task => task.id === 'listener')
    run = executeAksSolution(run, aksConnectivityGuidedLab, listener)
    expect(evaluateLab(aksConnectivityGuidedLab, run).tasks.find(task => task.id === 'listener').done).toBe(true)
    const internal = aksConnectivityGuidedLab.tasks.find(task => task.id === 'internal-service')
    const wrongType = aksConnectivityGuidedLab.solutionFiles['k8s/service-internal.yaml'].replace('type: ClusterIP', 'type: LoadBalancer')
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/service-internal.yaml', text: wrongType }, aksConnectivityGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/service-internal.yaml' }, aksConnectivityGuidedLab).run
    expect(evaluateLab(aksConnectivityGuidedLab, run).tasks.find(task => task.id === internal.id).done).toBe(false)
  })

  it('seeds only a healthy configured 8080 assistant and no learner Services', () => {
    const run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-seed' })
    const state = run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id]
    const pods = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    expect(Object.values(state.resources).filter(item => item.kind === 'Service')).toEqual([])
    expect(pods).toHaveLength(2)
    expect(pods.every(pod => pod.status.phase === 'Running' && pod.status.conditions.some(item => item.type === 'Ready' && item.status === 'True')
      && pod.spec.containers[0].ports.some(port => port.name === 'http' && port.containerPort === 8080))).toBe(true)
  })

  it('ships complete listener source and Deployment YAML in the worked Solution', () => {
    expect(parsePythonProject(aksConnectivityGuidedLab.solutionFiles, { assistant: true,
      fixedFiles: { 'training_runtime.py': aksConnectivityGuidedLab.solutionFiles['training_runtime.py'] } }).appSpec?.listeningPort).toBe(9090)
    const deployment = parseKubernetesYaml(aksConnectivityGuidedLab.solutionFiles['k8s/deployment.yaml'], 'k8s/deployment.yaml').documents[0]
    expect(deployment).toMatchObject({ kind: 'Deployment', metadata: { name: 'assistant', namespace: 'assistant' },
      spec: { replicas: 2, template: { spec: { containers: [expect.objectContaining({ image: 'acraksnetworkguided.azurecr.io/assistant:network-v1' })] } } } })
  })

  it('does not treat an unsaved or unbuilt PORT change as a listener repair', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-no-build' })
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: aksConnectivityGuidedLab.solutionFiles['app.py'] }, aksConnectivityGuidedLab).run
    expect(taskDone(run, 'listener')).toBe(false)
  })

  it('does not treat a 9090 containerPort as proof that an old captured 8080 artifact listens there', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-port-only' })
    run = applyRunAction(run, { type: 'command', line: 'az acr build -r acraksnetworkguided -t assistant:network-v1 .' }, aksConnectivityGuidedLab).run
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/deployment.yaml', text: aksConnectivityGuidedLab.solutionFiles['k8s/deployment.yaml'] }, aksConnectivityGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksConnectivityGuidedLab).run
    expect(taskDone(run, 'listener')).toBe(false)
  })

  it('invalidates listener completion when saved source no longer matches its published image', () => {
    let run = executeAksSolution(createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-stale-source' }), aksConnectivityGuidedLab,
      aksConnectivityGuidedLab.tasks.find(task => task.id === 'listener'))
    expect(taskDone(run, 'listener')).toBe(true)
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: aksConnectivityGuidedLab.solutionFiles['app.py'].replace('PORT = 9090', 'PORT = 9091') }, aksConnectivityGuidedLab).run
    expect(taskDone(run, 'listener')).toBe(false)
  })

  it('rejects a Service selector that matches no assistant Pods', () => {
    let run = executeAksSolution(createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-selector' }), aksConnectivityGuidedLab,
      aksConnectivityGuidedLab.tasks.find(task => task.id === 'listener'))
    const wrongSelector = aksConnectivityGuidedLab.solutionFiles['k8s/service-internal.yaml'].replace('app: assistant', 'app: unrelated')
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/service-internal.yaml', text: wrongSelector }, aksConnectivityGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/service-internal.yaml' }, aksConnectivityGuidedLab).run
    expect(taskDone(run, 'internal-service')).toBe(false)
  })

  it('does not accept caller-supplied response text in place of the internal answer fixture flow', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-forged-answer' })
    for (const task of aksConnectivityGuidedLab.tasks.slice(0, 5)) run = executeAksSolution(run, aksConnectivityGuidedLab, task)
    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'guided-network-internal-answer',
      body: { answer: 'Training backups are kept for 30 days.' } }, aksConnectivityGuidedLab)
    expect(result.diagnostics).toHaveLength(1)
    expect(taskDone(result.run, 'internal-answer')).toBe(false)
  })

  it('makes answer evidence stale when an applied configuration reference is removed', () => {
    let run = createBehavioralRun(aksConnectivityGuidedLab, { attemptId: 'guided-network-config-reference' })
    for (const task of aksConnectivityGuidedLab.tasks) run = executeAksSolution(run, aksConnectivityGuidedLab, task)
    expect(taskDone(run, 'external-answer')).toBe(true)
    const missingPgHost = aksConnectivityGuidedLab.solutionFiles['k8s/configmap.yaml'].replace('  PGHOST: pg-training.example\n', '')
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/configmap.yaml', text: missingPgHost }, aksConnectivityGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, aksConnectivityGuidedLab).run
    expect(taskDone(run, 'external-answer')).toBe(false)
  })
})

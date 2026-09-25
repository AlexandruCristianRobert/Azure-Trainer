import { describe, expect, it } from 'vitest'
import { aksConnectivityGuidedLab } from '../src/data/labs/aks-journey/connectivity-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

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
})

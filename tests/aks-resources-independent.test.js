import { describe, expect, it } from 'vitest'
import { aksResourcesIndependentLab } from '../src/data/labs/aks-journey/resources-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { RESOURCE_INDEPENDENT_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

describe('AKS independent resource sizing lab', () => {
  it('registers the fixed workload brief and completes every ordered reference action', () => {
    let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'independent-resources' })
    expect(aksResourcesIndependentLab.tasks.map(task => task.id)).toEqual([
      'resource-design', 'hpa-design', 'steady-burst-cooldown', 'memory-and-placement', 'cpu-not-wait', 'final-answer',
    ])
    for (const task of aksResourcesIndependentLab.tasks) {
      run = executeAksSolution(run, aksResourcesIndependentLab, task)
      expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(item => item.id === task.id).done, task.id).toBe(true)
    }
    expect(evaluateLab(aksResourcesIndependentLab, run).isComplete).toBe(true)
  })

  it('does not accept a fixed six-replica deployment as autoscaling evidence', () => {
    const run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'independent-resources' })
    const scaled = act(run, aksResourcesIndependentLab,
      { type: 'command', line: 'kubectl scale deployment/assistant --replicas 6 -n assistant' }).run
    expect(evaluateLab(aksResourcesIndependentLab, scaled).isComplete).toBe(false)
  })

  it('accepts the alternative supported policy through saved YAML, apply, and real controller evidence', () => {
    let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'independent-alternative' })
    const alternativeDeployment = RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml']
      .replace('acraksprobesguided.azurecr.io/assistant:health-v1', 'acraksresourcesindependent.azurecr.io/assistant:workload-v1')
      .replace('"300m"', '"250m"').replace('"600m"', '"500m"')
    const alternativeHpa = RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/hpa.yaml']
      .replace('averageUtilization: 60', 'averageUtilization: 70').replace('stabilizationWindowSeconds: 60', 'stabilizationWindowSeconds: 90')
    for (const action of [
      { type: 'save-file', path: 'k8s/deployment.yaml', text: alternativeDeployment },
      { type: 'command', line: 'az acr build -r acraksresourcesindependent -t assistant:workload-v1 .' },
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' },
      { type: 'save-file', path: 'k8s/deployment.yaml', text: alternativeDeployment.replace(/^  replicas: \d+\n/m, '') },
      { type: 'save-file', path: 'k8s/hpa.yaml', text: alternativeHpa },
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' },
      { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' },
      { type: 'aks-advance', seconds: 30 },
      { type: 'aks-resource-start', scenarioId: 'independent-resource-cycle' },
      { type: 'aks-advance', seconds: 300 },
      { type: 'aks-advance', seconds: 30 },
      { type: 'aks-resource-start', scenarioId: 'independent-resource-ai-wait' },
      { type: 'aks-advance', seconds: 90 },
      { type: 'aks-request', scenarioId: 'independent-resource-final' },
    ]) run = act(run, aksResourcesIndependentLab, action).run
    expect(evaluateLab(aksResourcesIndependentLab, run).isComplete).toBe(true)
  })

  it.each([
    ['missing CPU request', resources => delete resources.requests.cpu],
    ['zero CPU request', resources => { resources.requests.cpu = '0m' }],
    ['memory limit below the 256Mi footprint', resources => { resources.limits.memory = '255Mi' }],
  ])('rejects %s before it can become resource evidence', (_label, mutate) => {
    let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: `negative-${_label}` })
    const deployment = parseYaml(RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml'])
    deployment.spec.template.spec.containers[0].image = 'acraksresourcesindependent.azurecr.io/assistant:workload-v1'
    mutate(deployment.spec.template.spec.containers[0].resources)
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'resource-design').done).toBe(false)
  })

  it('rejects an HPA without stabilization or a saved target policy', () => {
    let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'negative-hpa' })
    for (const task of aksResourcesIndependentLab.tasks.slice(0, 2)) run = executeAksSolution(run, aksResourcesIndependentLab, task)
    const hpa = parseYaml(run.project.savedFiles['k8s/hpa.yaml'])
    delete hpa.spec.behavior.scaleDown
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'hpa-design').done).toBe(false)
    hpa.metadata.namespace = 'foreign'
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'hpa-design').done).toBe(false)
  })

  it('rejects an odd maximum whose per-node reservation cannot fit', () => {
    let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'negative-odd-placement' })
    const deployment = parseYaml(RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/deployment.yaml'])
    deployment.spec.template.spec.containers[0].image = 'acraksresourcesindependent.azurecr.io/assistant:workload-v1'
    deployment.spec.template.spec.containers[0].resources.requests.cpu = '500m'
    deployment.spec.template.spec.containers[0].resources.limits.cpu = '600m'
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'az acr build -r acraksresourcesindependent -t assistant:workload-v1 .' }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    const hpa = parseYaml(RESOURCE_INDEPENDENT_SOLUTION_FILES['k8s/hpa.yaml']); hpa.spec.maxReplicas = 5
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'resource-design').done).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { aksResourcesIndependentLab } from '../src/data/labs/aks-journey/resources-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { RESOURCE_INDEPENDENT_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { RESOURCE_MANIFEST } from '../src/data/templates/aks-python/resources.js'

const task = id => aksResourcesIndependentLab.tasks.find(item => item.id === id)
const configured = (attemptId = 'configured') => {
  let run = createBehavioralRun(aksResourcesIndependentLab, { attemptId })
  run = executeAksSolution(run, aksResourcesIndependentLab, task('resource-design'))
  run = executeAksSolution(run, aksResourcesIndependentLab, task('hpa-design'))
  return run
}
const cycle = run => {
  run = act(run, aksResourcesIndependentLab, { type: 'aks-resource-start', scenarioId: 'independent-resource-cycle' }).run
  run = act(run, aksResourcesIndependentLab, { type: 'aks-advance', seconds: 300 }).run
  return act(run, aksResourcesIndependentLab, { type: 'aks-advance', seconds: 30 }).run
}

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
    const run = configured('fixed-six')
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
      .replace('name: assistant-cpu', 'name: assistant-autoscaler')
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
    ]) {
      run = act(run, aksResourcesIndependentLab, action).run
      if (action.type === 'aks-advance' && action.seconds === 30)
        expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(item => item.id === 'hpa-design').done).toBe(true)
    }
    const cluster = run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id]
    expect(cluster.resources['HorizontalPodAutoscaler/assistant/assistant-autoscaler']).toMatchObject({ metadata: { name: 'assistant-autoscaler', namespace: 'assistant' }, spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'assistant' } } })
    expect(evaluateLab(aksResourcesIndependentLab, run).isComplete).toBe(true)
  })

  it('seeds a two-Pod 30-unit artifact with no resource settings or HPA', () => {
    const run = createBehavioralRun(aksResourcesIndependentLab, { attemptId: 'independent-seed' })
    const clusterId = run.sandbox.aksClusters[0].id
    const deployment = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant']
    expect(parsePythonProject(run.project.savedFiles, RESOURCE_MANIFEST).appSpec.workload).toMatchObject({ units: 30, scratchMiB: 160 })
    const artifactId = run.artifacts.publishedTags['acraksresourcesindependent.azurecr.io/assistant:workload-v1']
    const artifact = run.artifacts.buildsById[artifactId]
    expect(parsePythonProject(run.artifacts.sourceSnapshotsByHash[artifact.sourceHash].files, RESOURCE_MANIFEST).appSpec.workload).toMatchObject({ units: 30, scratchMiB: 160 })
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').every(pod => pod.status.conditions.some(item => item.type === 'Ready' && item.status === 'True'))).toBe(true)
    expect(deployment.spec.template.spec.containers[0].resources).toBeUndefined()
    expect(Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'HorizontalPodAutoscaler')).toHaveLength(0)
  })

  it.each([
    ['missing CPU request', resources => delete resources.requests.cpu],
    ['zero CPU request', resources => { resources.requests.cpu = '0m' }],
    ['memory limit below the 256Mi footprint', resources => { resources.requests.memory = '128Mi'; resources.limits.memory = '255Mi' }],
  ])('rejects %s before it can become resource evidence', (_label, mutate) => {
    let run = configured(`negative-${_label}`)
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(item => item.id === 'resource-design').done).toBe(true)
    const deployment = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    mutate(deployment.spec.template.spec.containers[0].resources)
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Deployment/assistant/assistant'].spec.template.spec.containers[0].resources)
      .toEqual(deployment.spec.template.spec.containers[0].resources)
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'resource-design').done).toBe(false)
  })

  it('rejects an HPA without stabilization or a saved target policy', () => {
    let run = configured('negative-hpa-window')
    const hpa = parseYaml(run.project.savedFiles['k8s/hpa.yaml'])
    delete hpa.spec.behavior.scaleDown
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'hpa-design').done).toBe(false)
    run = configured('negative-hpa-foreign')
    const foreign = parseYaml(run.project.savedFiles['k8s/hpa.yaml'])
    foreign.metadata.namespace = 'foreign'
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(foreign) }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'hpa-design').done).toBe(false)
  })

  it('rejects an odd maximum whose per-node reservation cannot fit', () => {
    let run = configured('negative-odd-placement')
    const deployment = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    deployment.spec.template.spec.containers[0].resources.requests.cpu = '400m'
    deployment.spec.template.spec.containers[0].resources.limits.cpu = '600m'
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    const hpa = parseYaml(run.project.savedFiles['k8s/hpa.yaml']); hpa.spec.maxReplicas = 5
    run = act(run, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(task => task.id === 'resource-design').done).toBe(false)
  })

  it('cancels active autoscaling evidence when a configured deployment is scaled manually', () => {
    let run = configured('manual-cancel')
    run = act(run, aksResourcesIndependentLab, { type: 'aks-resource-start', scenarioId: 'independent-resource-cycle' }).run
    run = act(run, aksResourcesIndependentLab, { type: 'command', line: 'kubectl scale deployment/assistant --replicas 6 -n assistant' }).run
    const clusterId = run.sandbox.aksClusters[0].id
    expect(run.runtime.kubernetes.clusters[clusterId].resourcesRuntime.experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
    expect(evaluateLab(aksResourcesIndependentLab, run).tasks.find(item => item.id === 'steady-burst-cooldown').done).toBe(false)
  })

  it('rejects throttled and fabricated cycle evidence, and rejects stale or foreign cycle receipts for placement', () => {
    let throttled = configured('throttled-cycle')
    const deployment = parseYaml(throttled.project.savedFiles['k8s/deployment.yaml'])
    deployment.spec.template.spec.containers[0].resources.requests.cpu = '100m'
    deployment.spec.template.spec.containers[0].resources.limits.cpu = '100m'
    throttled = act(throttled, aksResourcesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    throttled = act(throttled, aksResourcesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    throttled = cycle(throttled)
    const throttledExperiment = throttled.runtime.kubernetes.clusters[throttled.sandbox.aksClusters[0].id].resourcesRuntime.experiment
    expect(throttledExperiment).toMatchObject({ phase: 'complete', outcome: 'failed' })
    expect(throttledExperiment.observations.find(item => item.second === 90)).toMatchObject({ completed: expect.any(Number) })
    expect(throttledExperiment.observations.find(item => item.second === 90).completed).toBeLessThan(32)
    expect(throttledExperiment.observations.find(item => item.second === 90).remaining).toBeGreaterThan(0)
    expect(evaluateLab(aksResourcesIndependentLab, throttled).tasks.find(item => item.id === 'steady-burst-cooldown').done).toBe(false)

    const valid = cycle(configured('receipt-defence'))
    expect(evaluateLab(aksResourcesIndependentLab, valid).tasks.find(item => item.id === 'memory-and-placement').done).toBe(true)
    const fabricated = structuredClone(valid)
    const id = fabricated.evidence.currentEvidenceByTask['steady-burst-cooldown']
    fabricated.evidence.experimentsById[id].measurements.samples[0].workload.units = 1
    expect(evaluateLab(aksResourcesIndependentLab, fabricated).tasks.find(item => item.id === 'steady-burst-cooldown').done).toBe(false)
    const foreign = structuredClone(valid)
    foreign.evidence.experimentsById[id].taskId = 'foreign-cycle'
    expect(evaluateLab(aksResourcesIndependentLab, foreign).tasks.find(item => item.id === 'memory-and-placement').done).toBe(false)
    const stale = act(valid, aksResourcesIndependentLab, { type: 'save-file', path: 'app.py', text: `${valid.project.savedFiles['app.py']}\n# stale` }).run
    expect(evaluateLab(aksResourcesIndependentLab, stale).tasks.find(item => item.id === 'memory-and-placement').done).toBe(false)

    const literal = configured('literal-local-work')
    const forgedSource = literal.project.savedFiles['app.py'].replace('return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)', 'return {"checksum": 7395, "units": 30}')
    const saved = act(literal, aksResourcesIndependentLab, { type: 'save-file', path: 'app.py', text: forgedSource }).run
    const build = applyRunAction(saved, { type: 'command', line: 'az acr build -r acraksresourcesindependent -t assistant:workload-v1 .' }, aksResourcesIndependentLab)
    expect(build.diagnostics.length > 0 || build.lines.some(line => line.kind === 'err')).toBe(true)
    expect(evaluateLab(aksResourcesIndependentLab, saved).tasks.find(item => item.id === 'resource-design').done).toBe(false)
  })
})

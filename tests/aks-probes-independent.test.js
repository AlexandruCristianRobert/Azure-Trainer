import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { aksProbesIndependentLab } from '../src/data/labs/aks-journey/probes-independent.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'
import { seedProbesIndependent, PROBES_INDEPENDENT_IMAGE_BAD } from '../src/data/labs/aks-journey/probe-seeds.js'
import { act, executeAksSolution } from './helpers/aks.js'

function task(run, id, lab = aksProbesIndependentLab) { return evaluateLab(lab, run).tasks.find(item => item.id === id) }

function executeBefore(run, taskId, lab = aksProbesIndependentLab) {
  const index = lab.tasks.findIndex(item => item.id === taskId)
  for (const item of lab.tasks.slice(0, index)) run = executeAksSolution(run, lab, item)
  return run
}

function runExperiment(run, scenarioId, seconds, lab = aksProbesIndependentLab) {
  run = act(run, lab, { type: 'aks-probe-start', scenarioId }).run
  return act(run, lab, { type: 'aks-advance', seconds }).run
}

function makeRun(attemptId = 'independent-probes', lab = aksProbesIndependentLab) {
  return createBehavioralRun(lab, { attemptId })
}

function receipt(run, scenarioId) {
  const clusterId = run.sandbox.aksClusters[0].id
  return run.runtime.kubernetes.clusters[clusterId].health.receipts.findLast(item => item.scenarioId === scenarioId)
}

function stageAlternativePolicy(run) {
  const source = HEALTH_SOLUTION_FILES['app.py'].replace(
    'initialized() and accepting_requests()',
    'initialized() and accepting_requests() and postgres_available()',
  ).replace('200 if initialized() else 503', '204 if initialized() else 503')
    .replace('200 if initialized() and accepting_requests() and postgres_available() else 503',
      '204 if initialized() and accepting_requests() and postgres_available() else 503')
  run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
  run = act(run, aksProbesIndependentLab,
    { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
  const manifest = parseYaml(HEALTH_SOLUTION_FILES['k8s/deployment.yaml'])
  const container = manifest.spec.template.spec.containers[0]
  manifest.spec.template.spec.terminationGracePeriodSeconds = 1
  manifest.spec.template.spec.containers[0].image = 'acraksprobesindependent.azurecr.io/assistant:health-independent'
  container.startupProbe.periodSeconds = 3
  container.startupProbe.failureThreshold = 16
  container.readinessProbe.periodSeconds = 1
  container.readinessProbe.failureThreshold = 2
  container.readinessProbe.successThreshold = 2
  container.livenessProbe.periodSeconds = 4
  container.livenessProbe.failureThreshold = 2
  container.livenessProbe.timeoutSeconds = 1
  run = act(run, aksProbesIndependentLab,
    { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
  run = act(run, aksProbesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  return run
}

describe('independent AKS health policy Lab 15', () => {
  it('declares the standalone policy design, bounded experiments, and complete Solutions', () => {
    expect(aksProbesIndependentLab).toMatchObject({
      id: 'aks-probes-independent', status: 'available', skillAreaId: 'containers', service: 'aks',
      contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 15, labMode: 'independent',
      manifestId: 'aks-python-health-v1',
    })
    expect(aksProbesIndependentLab.tasks.map(item => item.id)).toEqual([
      'design-and-deploy', 'startup', 'admission', 'database', 'optional-ai', 'hang', 'final-answer',
    ])
    for (const item of aksProbesIndependentLab.tasks) {
      expect(item.explanation, item.id).toBeTruthy()
      expect(item.hints, item.id).toHaveLength(2)
      expect(item.examNote, item.id).toBeTruthy()
      expect(item.solution.steps.length, item.id).toBeGreaterThan(0)
    }
    expect(aksProbesIndependentLab.scenarios).toMatchObject({
      'independent-probe-startup': { kind: 'aks-probe', version: 1, durationSeconds: 60 },
      'independent-probe-admission': { kind: 'aks-probe', version: 1, durationSeconds: 90 },
      'independent-probe-database': { kind: 'aks-probe', version: 1, durationSeconds: 90 },
      'independent-probe-ai': { kind: 'aks-probe', version: 1, durationSeconds: 100 },
      'independent-probe-hang': { kind: 'aks-probe', version: 1, durationSeconds: 180 },
      'independent-probe-final': { kind: 'aks-request', version: 1 },
    })
    const reference = parseYaml(aksProbesIndependentLab.solutionFiles['k8s/deployment.yaml'])
    const referencePod = reference.spec.template.spec
    const referenceContainer = referencePod.containers[0]
    expect(referencePod.terminationGracePeriodSeconds).toBe(1)
    expect(referenceContainer.startupProbe).toMatchObject({ periodSeconds: 5, failureThreshold: 10 })
    expect(referenceContainer.readinessProbe).toMatchObject({ periodSeconds: 2, failureThreshold: 1, successThreshold: 1 })
    expect(referenceContainer.livenessProbe).toMatchObject({ periodSeconds: 5, failureThreshold: 2, timeoutSeconds: 1 })
  })

  it('seeds the slow standalone assistant with two unprobed replicas and the required services', () => {
    const run = makeRun('independent-seed')
    const clusterId = run.sandbox.aksClusters[0].id
    const state = run.runtime.kubernetes.clusters[clusterId]
    const deployment = state.resources['Deployment/assistant/assistant']
    expect(deployment.spec.template.spec.containers[0].image).toBe(PROBES_INDEPENDENT_IMAGE_BAD)
    expect(deployment.spec.template.spec.containers[0]).not.toHaveProperty('startupProbe')
    expect(deployment.spec.template.spec.containers[0]).not.toHaveProperty('readinessProbe')
    expect(deployment.spec.template.spec.containers[0]).not.toHaveProperty('livenessProbe')
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(state.resources['Service/assistant/assistant-internal']).toBeTruthy()
    expect(state.resources['Service/assistant/assistant-public']).toBeTruthy()
    expect(parsePythonProject(run.project.savedFiles, HEALTH_MANIFEST).appSpec?.health?.endpoints).toBeTruthy()
  })

  it('completes all five behavior experiments and the final healthy assistant answer', () => {
    let run = makeRun('independent-full-solution')
    for (const item of aksProbesIndependentLab.tasks) run = executeAksSolution(run, aksProbesIndependentLab, item)
    expect(evaluateLab(aksProbesIndependentLab, run).isComplete).toBe(true)
    expect(evaluateLab(aksProbesIndependentLab, run).tasks.every(item => item.done)).toBe(true)
    for (const scenarioId of ['independent-probe-startup', 'independent-probe-admission', 'independent-probe-database',
      'independent-probe-ai', 'independent-probe-hang']) expect(receipt(run, scenarioId)?.outcome).toBe('passed')
    const clusterId = run.sandbox.aksClusters[0].id
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(getServiceBackends(run, { clusterId, namespace: 'assistant', serviceName: 'assistant-public' }).readyEndpoints).toHaveLength(2)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksProbesIndependentLab)).toBeTruthy()
  })

  it('accepts behaviorally correct alternative probe periods and thresholds', () => {
    let run = stageAlternativePolicy(makeRun('independent-alternative-policy'))
    const clusterId = run.sandbox.aksClusters[0].id
    const probe = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].spec.template.spec.containers[0]
    expect(probe.startupProbe).toMatchObject({ periodSeconds: 3, failureThreshold: 16 })
    expect(probe.readinessProbe).toMatchObject({ periodSeconds: 1, failureThreshold: 2, successThreshold: 2 })
    expect(probe.livenessProbe).toMatchObject({ periodSeconds: 4, failureThreshold: 2, timeoutSeconds: 1 })
    expect(run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant']
      .spec.template.spec.terminationGracePeriodSeconds).toBe(1)
    expect(task(run, 'design-and-deploy').done).toBe(true)
    for (const [scenarioId, seconds] of [['independent-probe-startup', 60], ['independent-probe-admission', 90],
      ['independent-probe-database', 90], ['independent-probe-ai', 100], ['independent-probe-hang', 180]]) {
      run = runExperiment(run, scenarioId, seconds)
      expect(receipt(run, scenarioId)?.outcome, scenarioId).toBe('passed')
    }
    run = executeAksSolution(run, aksProbesIndependentLab, aksProbesIndependentLab.tasks.at(-1))
    expect(evaluateLab(aksProbesIndependentLab, run).tasks.every(item => item.done)).toBe(true)
    expect(evaluateLab(aksProbesIndependentLab, run).isComplete).toBe(true)
  })

  it('rejects a database-unaware readiness policy during the required database outage', () => {
    let run = executeBefore(makeRun('database-not-ready'), 'database')
    const source = run.project.savedFiles['app.py'].replace(
      'initialized() and accepting_requests() and postgres_available()',
      'initialized() and accepting_requests()',
    )
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    run = act(run, aksProbesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-database', 90)
    expect(task(run, 'database').done).toBe(false)
  })

  it('does not pass a startup budget sized only for the earlier 24-second initializer', () => {
    let run = executeBefore(makeRun('startup-budget-24-is-short'), 'startup')
    const manifest = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    manifest.spec.template.spec.containers[0].startupProbe.failureThreshold = 6
    run = act(run, aksProbesIndependentLab,
      { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-startup', 90)
    expect(receipt(run, 'independent-probe-startup')?.outcome).toBe('failed')
    expect(task(run, 'startup').done).toBe(false)
  })

  it('rejects AI-dependent readiness even when the application source parses', () => {
    let run = executeBefore(makeRun('ai-coupled-readiness'), 'optional-ai')
    const source = run.project.savedFiles['app.py'].replace(
      'initialized() and accepting_requests() and postgres_available()',
      'initialized() and accepting_requests() and postgres_available() and ai_available()',
    )
    const parsed = parsePythonProject({ ...run.project.savedFiles, 'app.py': source }, HEALTH_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    run = act(run, aksProbesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-ai', 100)
    expect(task(run, 'optional-ai').done).toBe(false)
  })

  it('requires functional startup and readiness endpoints and all three applied probes', () => {
    let run = executeBefore(makeRun('constant-startup'), 'startup')
    let source = run.project.savedFiles['app.py'].replace('200 if initialized() else 503', '200')
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    run = act(run, aksProbesIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-startup', 60)
    expect(task(run, 'startup').done).toBe(false)

    let noProbes = makeRun('missing-probes')
    noProbes = executeAksSolution(noProbes, aksProbesIndependentLab, aksProbesIndependentLab.tasks[0])
    const manifest = parseYaml(noProbes.project.savedFiles['k8s/deployment.yaml'])
    const container = manifest.spec.template.spec.containers[0]
    delete container.startupProbe; delete container.readinessProbe; delete container.livenessProbe
    noProbes = act(noProbes, aksProbesIndependentLab,
      { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    noProbes = act(noProbes, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(task(noProbes, 'design-and-deploy').done).toBe(false)

    let constantReady = executeBefore(makeRun('constant-ready'), 'admission')
    source = constantReady.project.savedFiles['app.py'].replace(
      '200 if initialized() and accepting_requests() and postgres_available() else 503', '200')
    constantReady = act(constantReady, aksProbesIndependentLab,
      { type: 'save-file', path: 'app.py', text: source }).run
    constantReady = act(constantReady, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    constantReady = act(constantReady, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    constantReady = runExperiment(constantReady, 'independent-probe-admission', 90)
    expect(task(constantReady, 'admission').done).toBe(false)
  })

  it('rejects source edits and Pod deletion as substitutes for observed recovery', () => {
    let run = executeBefore(makeRun('edit-during-experiment'), 'hang')
    run = act(run, aksProbesIndependentLab,
      { type: 'aks-probe-start', scenarioId: 'independent-probe-hang' }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# edit during the bounded experiment\n' }).run
    expect(Object.values(run.runtime.kubernetes.clusters).some(state => state.health.experiment?.status === 'active')).toBe(false)
    expect(receipt(run, 'independent-probe-hang')?.status).toBe('cancelled')

    let manifestEdit = executeBefore(makeRun('manifest-edit-during-experiment'), 'admission')
    manifestEdit = act(manifestEdit, aksProbesIndependentLab,
      { type: 'aks-probe-start', scenarioId: 'independent-probe-admission' }).run
    manifestEdit = act(manifestEdit, aksProbesIndependentLab, { type: 'aks-advance', seconds: 10 }).run
    const changedManifest = manifestEdit.project.savedFiles['k8s/deployment.yaml'].replace('replicas: 2', 'replicas: 3')
    manifestEdit = act(manifestEdit, aksProbesIndependentLab,
      { type: 'save-file', path: 'k8s/deployment.yaml', text: changedManifest }).run
    expect(receipt(manifestEdit, 'independent-probe-admission')?.status).toBe('cancelled')

    let deleted = executeBefore(makeRun('delete-during-hang'), 'hang')
    deleted = act(deleted, aksProbesIndependentLab,
      { type: 'aks-probe-start', scenarioId: 'independent-probe-hang' }).run
    deleted = act(deleted, aksProbesIndependentLab, { type: 'aks-advance', seconds: 90 }).run
    const clusterId = deleted.sandbox.aksClusters[0].id
    const pod = getDeploymentPods(deleted, clusterId, 'assistant', 'assistant')[0]
    deleted = act(deleted, aksProbesIndependentLab,
      { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }).run
    expect(task(deleted, 'hang').done).toBe(false)
    expect(receipt(deleted, 'independent-probe-hang')?.status).toBe('cancelled')
  })

  it('requires a bounded liveness timeout and termination schedule for a real hang', () => {
    let run = executeBefore(makeRun('hang-timeout-overrides-bound'), 'hang')
    const manifest = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    manifest.spec.template.spec.containers[0].livenessProbe.timeoutSeconds = 10
    manifest.spec.template.spec.containers[0].livenessProbe.periodSeconds = 30
    run = act(run, aksProbesIndependentLab,
      { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-hang', 180)
    expect(receipt(run, 'independent-probe-hang')?.outcome).toBe('failed')
    expect(task(run, 'hang').done).toBe(false)
  })

  it('observes the local timeout before expecting container termination and recovery', () => {
    let run = executeBefore(makeRun('hang-timeout-before-restart'), 'hang')
    run = act(run, aksProbesIndependentLab,
      { type: 'aks-probe-start', scenarioId: 'independent-probe-hang' }).run
    const clusterId = run.sandbox.aksClusters[0].id
    const uids = run.runtime.kubernetes.clusters[clusterId].health.experiment.podUids
    const startAtMs = run.runtime.simTimeMs
    run = act(run, aksProbesIndependentLab, { type: 'aks-advance', seconds: 52 }).run
    let state = run.runtime.kubernetes.clusters[clusterId]
    expect(state.health.experiment?.status).toBe('active')
    expect(state.health.experiment.baselineReadyAtMs).toBeGreaterThan(startAtMs)
    expect(state.health.containers[uids[0]].restartCount).toBe(0)
    expect(state.health.containers[uids[0]].checks.liveness.failures).toBeGreaterThanOrEqual(1)
    run = act(run, aksProbesIndependentLab, { type: 'aks-advance', seconds: 180 }).run
    state = run.runtime.kubernetes.clusters[clusterId]
    const completed = receipt(run, 'independent-probe-hang')
    expect(completed.status).toBe('completed')
    expect(completed.summary.facts.livenessTimeoutAt).toBeGreaterThanOrEqual(completed.baselineReadyAtMs + 5_000)
    expect(state.health.containers[uids[0]].containerId).not.toBe(completed.containerIds[uids[0]])
  })

  it('rejects a liveness endpoint that restarts a responsive process during optional AI outage', () => {
    let run = executeBefore(makeRun('ai-coupled-liveness'), 'optional-ai')
    const source = run.project.savedFiles['app.py'].replace(
      'def live():\n    return {"status": 200, "body": {"check": "liveness"}}',
      'def live():\n    return {"status": 200 if ai_available() else 503, "body": {"check": "liveness"}}',
    )
    expect(source).not.toBe(run.project.savedFiles['app.py'])
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'independent-probe-ai', 100)
    expect(task(run, 'optional-ai').done).toBe(false)
    expect(receipt(run, 'independent-probe-ai').summary.restartReceipts.some(item => item.probeType === 'LivenessProbeFailed')).toBe(true)
  })

  it('keeps saved source, build, saved manifest, and applied Deployment as separate states', () => {
    let run = makeRun('source-image-apply-boundaries')
    const source = HEALTH_SOLUTION_FILES['app.py'].replace(
      'initialized() and accepting_requests()',
      'initialized() and accepting_requests() and postgres_available()',
    )
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'app.py', text: source }).run
    expect(task(run, 'design-and-deploy').done).toBe(false)
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'az acr build -r acraksprobesindependent -t assistant:health-independent .' }).run
    expect(task(run, 'design-and-deploy').done).toBe(false)
    const manifest = aksProbesIndependentLab.solutionFiles['k8s/deployment.yaml']
    run = act(run, aksProbesIndependentLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: manifest }).run
    expect(task(run, 'design-and-deploy').done).toBe(false)
    run = act(run, aksProbesIndependentLab,
      { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(task(run, 'design-and-deploy').done).toBe(true)
  })
})

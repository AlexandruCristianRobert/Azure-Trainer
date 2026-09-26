import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { aksProbesTroubleshootingLab } from '../src/data/labs/aks-journey/probes-troubleshooting.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'
import { seedProbesTroubleshooting, PROBES_TROUBLESHOOTING_IMAGE_BAD } from '../src/data/labs/aks-journey/probe-seeds.js'
import { act, executeAksSolution } from './helpers/aks.js'

function task(run, id) { return evaluateLab(aksProbesTroubleshootingLab, run).tasks.find(item => item.id === id) }

function executeBefore(run, taskId) {
  const index = aksProbesTroubleshootingLab.tasks.findIndex(item => item.id === taskId)
  for (const item of aksProbesTroubleshootingLab.tasks.slice(0, index)) run = executeAksSolution(run, aksProbesTroubleshootingLab, item)
  return run
}

function runExperiment(run, scenarioId, seconds) {
  run = act(run, aksProbesTroubleshootingLab, { type: 'aks-probe-start', scenarioId }).run
  return act(run, aksProbesTroubleshootingLab, { type: 'aks-advance', seconds }).run
}

function makeRun(attemptId = 'probe-troubleshooting') {
  return createBehavioralRun(aksProbesTroubleshootingLab, { attemptId })
}

function receipt(run, scenarioId) {
  const clusterId = run.sandbox.aksClusters[0].id
  return run.runtime.kubernetes.clusters[clusterId].health.receipts.findLast(item => item.scenarioId === scenarioId)
}

describe('AKS probe restart-loop troubleshooting Lab 14', () => {
  it('declares the troubleshooting journey and seeds the two intended faults', () => {
    expect(aksProbesTroubleshootingLab).toMatchObject({
      id: 'aks-probes-troubleshooting', status: 'available', skillAreaId: 'containers', service: 'aks',
      contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 14, labMode: 'troubleshooting',
      manifestId: 'aks-python-health-v1',
    })
    expect(aksProbesTroubleshootingLab.tasks.map(item => item.id)).toEqual([
      'diagnose-startup', 'repair-startup', 'diagnose-coupling', 'repair-liveness', 'preserve-service', 'detect-real-hang', 'final-answer',
    ])
    for (const item of aksProbesTroubleshootingLab.tasks) {
      expect(item.explanation, item.id).toBeTruthy()
      expect(item.hints, item.id).toHaveLength(2)
      expect(item.examNote, item.id).toBeTruthy()
      expect(item.solution.steps.length, item.id).toBeGreaterThan(0)
    }
    const run = makeRun()
    const clusterId = run.sandbox.aksClusters[0].id
    const state = run.runtime.kubernetes.clusters[clusterId]
    const deployment = state.resources['Deployment/assistant/assistant']
    const container = deployment.spec.template.spec.containers[0]
    const app = parsePythonProject(run.project.savedFiles, HEALTH_MANIFEST).appSpec
    const health = app.health.endpoints
    expect(container.image).toBe(PROBES_TROUBLESHOOTING_IMAGE_BAD)
    expect(container.startupProbe).toMatchObject({ periodSeconds: 5, failureThreshold: 3 })
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(state.resources['Service/assistant/assistant-internal']).toBeTruthy()
    expect(state.resources['Service/assistant/assistant-public']).toBeTruthy()
    expect(health.find(item => item.path === '/health/startup').statusExpression).toBeTruthy()
    expect(health.find(item => item.path === '/health/ready').statusExpression).toBeTruthy()
    expect(health.find(item => item.path === '/health/live').statusExpression).not.toMatchObject({ kind: 'constant', value: 200 })
  })

  it('completes all Solutions with passed diagnoses, repaired probes, tolerated AI outage, real hang recovery, and final answer', () => {
    let run = makeRun('troubleshooting-full-solution')
    for (const item of aksProbesTroubleshootingLab.tasks) run = executeAksSolution(run, aksProbesTroubleshootingLab, item)
    expect(evaluateLab(aksProbesTroubleshootingLab, run).isComplete).toBe(true)
    expect(evaluateLab(aksProbesTroubleshootingLab, run).tasks.every(item => item.done)).toBe(true)
    for (const id of ['trouble-probe-short-start', 'trouble-probe-startup-fixed', 'trouble-probe-ai-coupling',
      'trouble-probe-ai-tolerated', 'trouble-probe-real-hang']) expect(receipt(run, id)?.status).toBe('completed')
    expect(receipt(run, 'trouble-probe-short-start')).toMatchObject({ outcome: 'passed' })
    expect(receipt(run, 'trouble-probe-ai-coupling')).toMatchObject({ outcome: 'passed' })
    expect(receipt(run, 'trouble-probe-ai-tolerated')).toMatchObject({ outcome: 'passed' })
    expect(receipt(run, 'trouble-probe-real-hang')).toMatchObject({ outcome: 'passed' })
    expect(receipt(run, 'trouble-probe-real-hang').samples.some(item =>
      item.faultedPodResponse?.transport?.reason === 'PROCESS_TIMEOUT')).toBe(true)
    const clusterId = run.sandbox.aksClusters[0].id
    const state = run.runtime.kubernetes.clusters[clusterId]
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(getServiceBackends(run, { clusterId, namespace: 'assistant', serviceName: 'assistant-public' }).readyEndpoints).toHaveLength(2)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksProbesTroubleshootingLab)).toBeTruthy()
  })

  it('records the short-start diagnosis and keeps its historical proof current after repairing startup', () => {
    let run = makeRun('short-start-history')
    run = runExperiment(run, 'trouble-probe-short-start', 60)
    expect(task(run, 'diagnose-startup').done).toBe(true)
    const diagnosis = receipt(run, 'trouble-probe-short-start')
    expect(diagnosis.summary.restartReceipts.length).toBeGreaterThan(0)
    expect(diagnosis.summary.probeEvents ?? diagnosis.samples).toBeTruthy()
    run = executeAksSolution(run, aksProbesTroubleshootingLab, aksProbesTroubleshootingLab.tasks[1])
    expect(task(run, 'diagnose-startup').done).toBe(true)
    expect(task(run, 'repair-startup').done).toBe(true)
    expect(receipt(run, 'trouble-probe-startup-fixed')).toMatchObject({ outcome: 'passed' })
  })

  it('accepts a longer initial delay as an alternative startup budget', () => {
    let run = makeRun('startup-initial-delay')
    const manifest = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    const container = manifest.spec.template.spec.containers[0]
    container.startupProbe.initialDelaySeconds = 25
    container.startupProbe.failureThreshold = 3
    run = act(run, aksProbesTroubleshootingLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    run = act(run, aksProbesTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    run = runExperiment(run, 'trouble-probe-startup-fixed', 60)
    expect(task(run, 'repair-startup').done).toBe(true)
    expect(receipt(run, 'trouble-probe-startup-fixed')).toMatchObject({ outcome: 'passed' })
  })

  it('proves AI-coupled liveness with a successful info request during outage before restart', () => {
    let run = executeBefore(makeRun('ai-liveness-coupling'), 'diagnose-coupling')
    run = runExperiment(run, 'trouble-probe-ai-coupling', 90)
    expect(task(run, 'diagnose-coupling').done).toBe(true)
    const diagnosis = receipt(run, 'trouble-probe-ai-coupling')
    expect(diagnosis.summary.restartReceipts.length).toBeGreaterThan(0)
    expect(diagnosis.samples).toEqual(expect.arrayContaining([expect.objectContaining({ second: 6,
      request: expect.objectContaining({ method: 'GET', path: '/api/info' }),
      response: expect.objectContaining({ status: 200 }) })]))
  })

  it('requires rebuilding and applying the repaired liveness source before accepting the repair', () => {
    let run = executeBefore(makeRun('liveness-build-boundaries'), 'repair-liveness')
    const fixedSource = HEALTH_SOLUTION_FILES['app.py']
    const fixedManifest = aksProbesTroubleshootingLab.solutionFiles['k8s/deployment.yaml']
    run = act(run, aksProbesTroubleshootingLab, { type: 'save-file', path: 'app.py', text: fixedSource }).run
    expect(task(run, 'repair-liveness').done).toBe(false)
    run = act(run, aksProbesTroubleshootingLab, { type: 'command', line: 'az acr build -r acraksprobestrouble -t assistant:health-fixed .' }).run
    expect(task(run, 'repair-liveness').done).toBe(false)
    run = act(run, aksProbesTroubleshootingLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: fixedManifest }).run
    expect(task(run, 'repair-liveness').done).toBe(false)
    run = act(run, aksProbesTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(task(run, 'repair-liveness').done).toBe(false)
    run = runExperiment(run, 'trouble-probe-startup-fixed', 60)
    expect(task(run, 'repair-liveness').done).toBe(true)
  })

  it('does not treat a saved startup budget as an applied repair', () => {
    let run = makeRun('startup-budget-needs-apply')
    const manifest = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    manifest.spec.template.spec.containers[0].startupProbe.failureThreshold = 6
    run = act(run, aksProbesTroubleshootingLab,
      { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    run = runExperiment(run, 'trouble-probe-startup-fixed', 60)
    expect(receipt(run, 'trouble-probe-startup-fixed')).toMatchObject({ outcome: 'failed' })
    expect(task(run, 'repair-startup').done).toBe(false)
  })

  it('preserves startup backoff counters and can complete the diagnosis after reload', () => {
    let run = makeRun('startup-reload-backoff')
    run = act(run, aksProbesTroubleshootingLab,
      { type: 'aks-probe-start', scenarioId: 'trouble-probe-short-start' }).run
    run = act(run, aksProbesTroubleshootingLab, { type: 'aks-advance', seconds: 25 }).run
    const clusterId = run.sandbox.aksClusters[0].id
    const active = run.runtime.kubernetes.clusters[clusterId].health.experiment
    const countsBefore = Object.fromEntries(active.podUids.map(uid => [uid,
      run.runtime.kubernetes.clusters[clusterId].health.containers[uid]?.restartCount ?? 0]))
    expect(Object.values(countsBefore).some(count => count > 0)).toBe(true)
    run = JSON.parse(JSON.stringify(run))
    expect(validateBehavioralRun(run, aksProbesTroubleshootingLab)).toBeTruthy()
    const restored = run.runtime.kubernetes.clusters[clusterId].health.experiment
    expect(restored).toMatchObject({ status: 'active', scenarioId: 'trouble-probe-short-start' })
    expect(Object.fromEntries(restored.podUids.map(uid => [uid,
      run.runtime.kubernetes.clusters[clusterId].health.containers[uid]?.restartCount ?? 0]))).toEqual(countsBefore)
    run = act(run, aksProbesTroubleshootingLab, { type: 'aks-advance', seconds: 60 }).run
    expect(task(run, 'diagnose-startup').done).toBe(true)
    expect(receipt(run, 'trouble-probe-short-start')).toMatchObject({ outcome: 'passed' })
  })

  it('keeps diagnosis incomplete when repairs are applied without running the diagnosis', () => {
    let run = makeRun('repairs-without-diagnosis')
    run = executeAksSolution(run, aksProbesTroubleshootingLab, aksProbesTroubleshootingLab.tasks[1])
    expect(task(run, 'diagnose-startup').done).toBe(false)
  })

  it('keeps both historical diagnoses current through repeated tolerated-AI experiments', () => {
    let run = executeBefore(makeRun('repeated-tolerated-ai'), 'preserve-service')
    expect(task(run, 'diagnose-startup').done).toBe(true)
    expect(task(run, 'diagnose-coupling').done).toBe(true)
    run = runExperiment(run, 'trouble-probe-ai-tolerated', 90)
    run = runExperiment(run, 'trouble-probe-ai-tolerated', 90)
    expect(task(run, 'diagnose-startup').done).toBe(true)
    expect(task(run, 'diagnose-coupling').done).toBe(true)
    expect(receipt(run, 'trouble-probe-short-start')).toMatchObject({ outcome: 'passed' })
    expect(receipt(run, 'trouble-probe-ai-coupling')).toMatchObject({ outcome: 'passed' })
  })

  it('does not pass a real-hang test when liveness is removed, too slow, or replaced by a manual rollout', () => {
    let noLiveness = executeBefore(makeRun('no-liveness'), 'detect-real-hang')
    const missing = parseYaml(noLiveness.project.savedFiles['k8s/deployment.yaml'])
    delete missing.spec.template.spec.containers[0].livenessProbe
    noLiveness = act(noLiveness, aksProbesTroubleshootingLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(missing) }).run
    noLiveness = act(noLiveness, aksProbesTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    noLiveness = runExperiment(noLiveness, 'trouble-probe-real-hang', 150)
    expect(task(noLiveness, 'detect-real-hang').done).toBe(false)

    let tooSlow = executeBefore(makeRun('slow-liveness'), 'detect-real-hang')
    const slow = parseYaml(tooSlow.project.savedFiles['k8s/deployment.yaml'])
    slow.spec.template.spec.containers[0].livenessProbe.periodSeconds = 30
    slow.spec.template.spec.containers[0].livenessProbe.failureThreshold = 30
    tooSlow = act(tooSlow, aksProbesTroubleshootingLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(slow) }).run
    tooSlow = act(tooSlow, aksProbesTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    tooSlow = runExperiment(tooSlow, 'trouble-probe-real-hang', 150)
    expect(task(tooSlow, 'detect-real-hang').done).toBe(false)

    let manualRollout = executeBefore(makeRun('manual-rollout-is-not-recovery'), 'detect-real-hang')
    manualRollout = act(manualRollout, aksProbesTroubleshootingLab, { type: 'aks-probe-start', scenarioId: 'trouble-probe-real-hang' }).run
    manualRollout = act(manualRollout, aksProbesTroubleshootingLab, { type: 'aks-advance', seconds: 35 }).run
    manualRollout = act(manualRollout, aksProbesTroubleshootingLab,
      { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    manualRollout = act(manualRollout, aksProbesTroubleshootingLab, { type: 'aks-advance', seconds: 150 }).run
    expect(task(manualRollout, 'detect-real-hang').done).toBe(false)
  })
})

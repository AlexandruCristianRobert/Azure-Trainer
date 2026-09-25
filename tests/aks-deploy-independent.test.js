import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { aksDeployIndependentLab } from '../src/data/labs/aks-journey/deploy-independent.lab.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'
import { act } from './helpers/aks.js'

function started(attemptId = 'independent') {
  return createBehavioralRun(aksDeployIndependentLab, { attemptId })
}

function task(result, id) { return result.tasks.find(item => item.id === id) }

function solve(run, alternateFiles = {}, { skipTaskIds = [] } = {}) {
  for (const item of aksDeployIndependentLab.tasks) {
    if (skipTaskIds.includes(item.id)) continue
    for (const step of item.solution?.steps ?? []) {
      if (step.kind === 'file') {
        const content = alternateFiles[step.path] ?? step.content
        run = act(run, aksDeployIndependentLab, { type: 'draft', path: step.path, text: content }).run
        run = act(run, aksDeployIndependentLab, { type: 'save-file', path: step.path }).run
      } else if (step.kind === 'command') {
        const action = step.resolver ? aksDeployIndependentLab.solutionActionResolvers[step.resolver](run, aksDeployIndependentLab, item, step.resolver)
          : { type: 'command', line: step.line }
        run = act(run, aksDeployIndependentLab, action).run
      } else if (step.kind === 'scenario') run = act(run, aksDeployIndependentLab, { type: 'aks-request', scenarioId: step.scenarioId }).run
    }
  }
  return run
}

function alternateManifests() {
  const deployment = aksDeployIndependentLab.solutionFiles['k8s/review-deployment.yaml']
    .replace('apiVersion: apps/v1\nkind: Deployment', 'kind: Deployment\napiVersion: apps/v1')
    .replace('          app: review-assistant\n', '          app: review-assistant\n          tier: backend\n')
    .replace('        app: review-assistant\n', '        app: review-assistant\n        tier: backend\n')
  const service = aksDeployIndependentLab.solutionFiles['k8s/review-service.yaml']
    .replace('apiVersion: v1\nkind: Service', 'kind: Service\napiVersion: v1')
    .replace('    app: review-assistant\n', '    app: review-assistant\n    tier: backend\n')
    .replace('targetPort: http', 'targetPort: 8080').replace('type: LoadBalancer', 'type: ClusterIP')
  return { 'k8s/review-deployment.yaml': deployment, 'k8s/review-service.yaml': service }
}

describe('independent AKS deployment lab', () => {
  it('routes the first three AKS Labs in order and stops after Lab 3', () => {
    expect(nextLabFor(labById('aks-deploy-guided'))?.id).toBe('aks-deploy-troubleshooting')
    expect(nextLabFor(labById('aks-deploy-troubleshooting'))).toBe(aksDeployIndependentLab)
    expect(nextLabFor(aksDeployIndependentLab)).toBeNull()
  })

  it('does not accept the primary response as proof of the new instance', () => {
    let run = started('isolation')
    run = act(run, aksDeployIndependentLab, { type: 'aks-request', scenarioId: 'independent-primary' }).run
    const result = evaluateLab(aksDeployIndependentLab, run)
    expect(task(result, 'review-request').done).toBe(false)
    expect(result.isComplete).toBe(false)
  })

  it('requires a fresh primary response after review deployment and replacement', () => {
    let run = started('primary-freshness')
    run = act(run, aksDeployIndependentLab, { type: 'aks-request', scenarioId: 'independent-primary' }).run
    run = solve(run, {}, { skipTaskIds: ['primary-intact'] })
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'primary-intact').done).toBe(false)
    expect(evaluateLab(aksDeployIndependentLab, run).isComplete).toBe(false)

    run = act(run, aksDeployIndependentLab, { type: 'aks-request', scenarioId: 'independent-primary' }).run
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'primary-intact').done).toBe(true)
    expect(evaluateLab(aksDeployIndependentLab, run).isComplete).toBe(true)
  })

  it('completes the worked Solution with a valid alternate manifest layout', () => {
    const run = solve(started('solution'), alternateManifests())
    const result = evaluateLab(aksDeployIndependentLab, run)
    expect(result.isComplete, JSON.stringify(result.tasks.map(item => [item.id, item.done, item.reason]))).toBe(true)
    expect(run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Namespace//primary']).toBeDefined()
    expect(run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Namespace//review']).toBeDefined()
  })

  it('invalidates review proof after a source edit and detects a changed primary configuration', () => {
    let run = solve(started('stale'))
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'review-request').done,
      JSON.stringify(evaluateLab(aksDeployIndependentLab, run).tasks.map(item => [item.id, item.done, item.reason]))).toBe(true)
    run = act(run, aksDeployIndependentLab, { type: 'save-file', path: 'app.py',
      text: run.project.savedFiles['app.py'].replace('"2.0"', '"2.1"') }).run
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'review-request').done).toBe(false)

    const changed = structuredClone(solve(started('primary-change')))
    const state = changed.runtime.kubernetes.clusters[changed.sandbox.aksClusters[0].id]
    state.resources['Deployment/primary/assistant'].spec.template.spec.containers[0].env[0].value = 'staging'
    expect(task(evaluateLab(aksDeployIndependentLab, changed), 'primary-intact').done).toBe(false)

    const changedService = structuredClone(solve(started('primary-service-change')))
    const service = changedService.runtime.kubernetes.clusters[changedService.sandbox.aksClusters[0].id]
      .resources['Service/primary/assistant']
    service.spec.type = 'ClusterIP'
    expect(task(evaluateLab(aksDeployIndependentLab, changedService), 'primary-intact').done).toBe(false)
  })

  it('invalidates request proof after a later replacement and rejects a hardcoded review image', () => {
    let run = solve(started('replacement-stale'))
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'review-request').done).toBe(true)
    run = act(run, aksDeployIndependentLab, aksDeployIndependentLab.solutionActionResolvers['delete-review-pod'](run, aksDeployIndependentLab)).run
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'review-request').done).toBe(false)

    run = solve(started('hardcoded'))
    const literalApp = run.project.savedFiles['app.py'].replace('os.environ.get("APP_ENV", "development")', '"review"')
    run = act(run, aksDeployIndependentLab, { type: 'save-file', path: 'app.py', text: literalApp }).run
    run = act(run, aksDeployIndependentLab, { type: 'command', line: 'az acr build -r acraksindependent -t assistant:v2 .' }).run
    run = act(run, aksDeployIndependentLab, aksDeployIndependentLab.solutionActionResolvers['delete-review-pod'](run, aksDeployIndependentLab)).run
    run = act(run, aksDeployIndependentLab, { type: 'aks-request', scenarioId: 'independent-review' }).run
    expect(task(evaluateLab(aksDeployIndependentLab, run), 'review-request').done).toBe(false)
  })

  it('rejects a wrong tag, replica count, namespace, or hardcoded review environment', () => {
    const check = aksDeployIndependentLab.tasks.find(item => item.id === 'manifests').check
    const good = aksDeployIndependentLab.solutionFiles['k8s/review-deployment.yaml']
    const context = deployment => ({ project: { savedFiles: { ...aksDeployIndependentLab.solutionFiles,
      'k8s/review-deployment.yaml': deployment } } })
    for (const bad of [good.replace(':v2', ':v1'), good.replace('replicas: 2', 'replicas: 1'),
      good.replace('namespace: review', 'namespace: primary'), good.replace('value: review', 'value: production')])
      expect(check(context(bad))).toBe(false)
  })
})

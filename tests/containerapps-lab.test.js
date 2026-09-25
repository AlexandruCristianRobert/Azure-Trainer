import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { LABS, labById } from '../src/data/labs/index.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const LAB = 'containerapps-keda'
const opts = { sleep: () => Promise.resolve() }
const apply = (sandbox, command) => {
  const result = runLine(sandbox, command)
  expect(result.lines.filter((l) => l.kind === 'err'), command).toEqual([])
  return result.sandbox
}
function throughTask(count) {
  const lab = labById(LAB)
  expect(lab.tasks).toHaveLength(5)
  return lab.tasks.slice(0, count).reduce((sb, task) => apply(sb, task.solution), createSandbox())
}

describe('Container Apps Lab', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('is playable and each Solution completes exactly the next Task', () => {
    const lab = labById(LAB)
    expect(lab.status).toBe('available')
    expect(lab.tasks).toHaveLength(5)
    let sandbox = lab.seed(createSandbox())
    expect(lab.tasks.map((t) => t.check(sandbox))).toEqual([false, false, false, false, false])
    lab.tasks.forEach((task, index) => {
      sandbox = apply(sandbox, task.solution)
      expect(lab.tasks.map((t) => t.check(sandbox))).toEqual(
        [0, 1, 2, 3, 4].map((i) => i <= index),
      )
    })
  })

  it('does not count wrong ingress, port, bounds or HTTP concurrency', () => {
    const lab = labById(LAB)
    const sandbox = throughTask(5)
    const app = sandbox.containerApps[0]
    app.ingress = 'internal'
    expect(lab.tasks[2].check(sandbox)).toBe(false)
    app.ingress = 'external'
    app.targetPort = 8080
    expect(lab.tasks[2].check(sandbox)).toBe(false)
    app.targetPort = 80
    app.maxReplicas = 10
    expect(lab.tasks[3].check(sandbox)).toBe(false)
    app.maxReplicas = 5
    app.minReplicas = 1
    expect(lab.tasks[3].check(sandbox)).toBe(false)
    app.scaleRules[0].http.metadata.concurrentRequests = '10'
    expect(lab.tasks[4].check(sandbox)).toBe(false)
  })

  it('requires the named app and environment in the expected resource group', () => {
    const lab = labById(LAB)
    const sandbox = throughTask(5)
    sandbox.containerApps[0].resourceGroup = 'rg-other'
    expect(lab.tasks.slice(2).map((t) => t.check(sandbox))).toEqual([false, false, false])
    sandbox.containerApps[0].resourceGroup = 'rg-containerapps'
    sandbox.containerApps[0].environmentResourceGroup = 'rg-other'
    expect(lab.tasks.slice(2).map((t) => t.check(sandbox))).toEqual([false, false, false])
    sandbox.containerApps[0].environmentResourceGroup = 'rg-containerapps'
    sandbox.containerAppEnvironments = []
    expect(lab.tasks.slice(1).map((t) => t.check(sandbox))).toEqual([false, false, false, false])
  })

  it('judges properties independently of command order or resource group casing', () => {
    const lab = labById(LAB)
    let sandbox = apply(createSandbox(), 'az group create -n RG-ContainerApps -l "West Europe"')
    sandbox = apply(sandbox, lab.tasks[1].solution)
    sandbox = apply(sandbox, lab.tasks[2].solution + ' --min-replicas 0 --max-replicas 5 --scale-rule-name http-requests --scale-rule-type http --scale-rule-http-concurrency 50')
    expect(lab.tasks.map((t) => t.check(sandbox))).toEqual([true, true, true, true, true])
  })

  it('the HTTP Solution corrects an existing rule regardless of its name casing', () => {
    const lab = labById(LAB)
    let sandbox = throughTask(4)
    sandbox = apply(sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name HTTP-REQUESTS --scale-rule-type http --scale-rule-http-concurrency 10')
    expect(lab.tasks[4].check(sandbox)).toBe(false)
    sandbox = apply(sandbox, lab.tasks[4].solution)
    expect(lab.tasks[4].check(sandbox)).toBe(true)
    expect(sandbox.containerApps[0].scaleRules).toHaveLength(1)
  })

  it('resumes independently of Service Bus, completes once, and restarts retaining results', async () => {
    let run = useLabRunStore()
    run.load(LAB)
    expect(run.total).toBe(5)
    for (const task of run.lab.tasks.slice(0, 3)) await run.execute(task.solution, opts)
    run.revealHint('http-scaling')
    run.revealSolution('replica-limits')
    run.tick(1000)
    run.tick(6000)
    run.pauseTimer()
    run.load('servicebus-order-backend')
    expect(run.sandbox.containerApps).toEqual([])
    await run.execute(run.lab.tasks[0].solution, opts)

    setActivePinia(createPinia())
    run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(3)
    expect(run.elapsedMs).toBe(5000)
    expect(run.hintsUsed).toBe(1)
    expect(run.solutionsUsed).toBe(1)
    for (const task of run.lab.tasks.slice(3)) await run.execute(task.solution, opts)
    expect(run.isComplete).toBe(true)
    const progress = useProgressStore()
    expect(progress.results).toHaveLength(1)
    expect(progress.results[0]).toMatchObject({ labId: LAB, tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 1, durationMs: 5000 })
    expect(progress.skillAreaProgress('containers')).toEqual({ total: LABS.filter((lab) => lab.skillAreaId === 'containers').length, completed: 1, inProgress: 0 })
    await run.execute('az containerapp show -g rg-containerapps -n ca-contoso-api', opts)
    expect(progress.results).toHaveLength(1)
    run.load(LAB)
    expect(run.isComplete).toBe(true)
    run.restart()
    expect(run.doneCount).toBe(0)
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.sandbox.containerAppEnvironments).toEqual([])
    expect(progress.results).toHaveLength(1)
    run.load('servicebus-order-backend')
    expect(run.doneCount).toBe(1)
  })

  it('migrates old Service Bus saves without losing progress', async () => {
    const run = useLabRunStore()
    run.load('servicebus-order-backend')
    await run.execute(run.lab.tasks[0].solution, opts)
    const key = 'at_run_servicebus-order-backend'
    const saved = JSON.parse(localStorage.getItem(key))
    delete saved.sandbox.containerApps
    delete saved.sandbox.containerAppEnvironments
    localStorage.setItem(key, JSON.stringify(saved))
    run.load('servicebus-order-backend')
    expect(run.doneCount).toBe(1)
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.sandbox.containerAppEnvironments).toEqual([])
    expect(JSON.parse(localStorage.getItem(key)).sandbox.containerApps).toEqual([])
  })

  it('rejects saves with malformed new collections and starts a fresh Lab', () => {
    const sandbox = createSandbox()
    sandbox.containerApps = {}
    localStorage.setItem(`at_run_${LAB}`, JSON.stringify({ labId: LAB, sandbox }))
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.total).toBe(5)
    expect(run.doneCount).toBe(0)
  })

  it('a command still waiting in another Lab cannot overwrite the current run', async () => {
    const run = useLabRunStore()
    run.load('servicebus-order-backend')
    let finishOld
    const pending = run.execute('az group create -n rg-orders -l westeurope', {
      sleep: () => new Promise((resolve) => { finishOld = resolve }),
    })
    run.load(LAB)
    let finishCurrent
    const current = run.execute('az group create -n rg-containerapps -l westeurope', {
      sleep: () => new Promise((resolve) => { finishCurrent = resolve }),
    })
    finishOld()
    await pending
    expect(run.running).toBe(true)
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(run.scrollback).toHaveLength(1)
    finishCurrent()
    await current
    expect(run.sandbox.resourceGroups.map((g) => g.name)).toEqual(['rg-containerapps'])
    expect(run.doneCount).toBe(1)
    expect(run.running).toBe(false)
  })

  it('restarting a Lab discards its in-flight command', async () => {
    const run = useLabRunStore()
    run.load('servicebus-order-backend')
    let finish
    const pending = run.execute('az group create -n rg-orders -l westeurope', {
      sleep: () => new Promise((resolve) => { finish = resolve }),
    })
    run.restart()
    finish()
    await pending
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(run.scrollback).toEqual([])
    expect(run.doneCount).toBe(0)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { usePortalStore } from '../src/stores/portal.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const LAB = 'servicebus-order-backend'
const noSleep = () => Promise.resolve()
const opts = { sleep: noSleep }

describe('labRun store', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('start seeds a run and persists it', () => {
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.labId).toBe(LAB)
    expect(run.lab.title).toBe('Order-processing backend on Service Bus')
    expect(run.total).toBe(5)
    expect(run.doneCount).toBe(0)
    expect(run.currentTaskId).toBe('resource-group')
    expect(JSON.parse(localStorage.getItem(`at_run_${LAB}`)).labId).toBe(LAB)
  })

  it('a corrupt saved run (sandbox: null) is discarded for a fresh seeded run, which is re-persisted', () => {
    localStorage.setItem(`at_run_${LAB}`, JSON.stringify({ labId: LAB, sandbox: null }))
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(0)
    expect(() => run.taskStates).not.toThrow()
    expect(run.taskStates).toHaveLength(5)
    const persisted = JSON.parse(localStorage.getItem(`at_run_${LAB}`))
    expect(persisted.sandbox.resourceGroups).toEqual([])
    expect(persisted.sandbox.namespaces).toEqual([])
  })

  it('execute echoes the command, appends output, ticks Tasks, notifies, focuses Blade', async () => {
    const run = useLabRunStore()
    const portal = usePortalStore()
    run.load(LAB)
    await run.execute('az group create -n rg-orders -l westeurope', opts)
    expect(run.scrollback[0]).toEqual({ kind: 'cmd', text: 'az group create -n rg-orders -l westeurope' })
    expect(run.scrollback[1].kind).toBe('out')
    expect(run.scrollback[1].text).toContain('"name": "rg-orders"')
    expect(run.taskStates[0].done).toBe(true)
    expect(run.doneCount).toBe(1)
    expect(run.currentTaskId).toBe('namespace')
    expect(run.history).toEqual(['az group create -n rg-orders -l westeurope'])
    expect(portal.blade).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(portal.notifications[0].text).toBe("Created resource group 'rg-orders'.")
    expect(run.running).toBe(false)
  })

  it('errors go to scrollback as err and do not change the Sandbox', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    await run.execute('az servicebus topic create --name order-events', opts)
    expect(run.scrollback[1]).toEqual({ kind: 'err', text: 'ERROR: the following arguments are required: --namespace-name, --resource-group/-g' })
    expect(run.sandbox.resourceGroups).toHaveLength(0)
  })

  it('shell-level errors keep their bash: wording; az errors still get the ERROR: prefix', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    await run.execute('foo', opts)
    expect(run.scrollback[1]).toEqual({ kind: 'err', text: 'bash: foo: command not found' })
    await run.execute('az servicebus topic create --name order-events', opts)
    expect(run.scrollback[3].text.startsWith('ERROR: ')).toBe(true)
  })

  it('clear empties the scrollback; blank lines only echo the prompt', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    await run.execute('az account show', opts)
    await run.execute('clear', opts)
    expect(run.scrollback).toEqual([])
    await run.execute('', opts)
    expect(run.scrollback).toEqual([{ kind: 'cmd', text: '' }])
    expect(run.history).toEqual(['az account show'])
  })

  it('hints/solutions are recorded; timer ticks and pauses', () => {
    const run = useLabRunStore()
    run.load(LAB)
    run.revealHint('topic')
    run.revealHint('topic')
    run.revealHint('topic')
    expect(run.hintsRevealed.topic).toBe(2)
    expect(run.hintsUsed).toBe(2)
    run.revealSolution('topic')
    expect(run.solutionsUsed).toBe(1)
    run.tick(1000)
    run.tick(6000)
    expect(run.elapsedMs).toBe(5000)
    run.pauseTimer()
    run.tick(20000)
    expect(run.elapsedMs).toBe(5000)
    run.tick(21000)
    expect(run.elapsedMs).toBe(6000)
  })

  it('reload resumes from storage', async () => {
    let run = useLabRunStore()
    run.load(LAB)
    await run.execute('az group create -n rg-orders -l westeurope', opts)
    setActivePinia(createPinia())
    run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(1)
    expect(run.scrollback).toHaveLength(2)
  })

  it('completing all Tasks writes a Lab Result once, notifies and toasts; restart resets but keeps the result', async () => {
    const run = useLabRunStore()
    const progress = useProgressStore()
    const portal = usePortalStore()
    run.load(LAB)
    run.revealHint('topic')
    for (const t of run.lab.tasks) for (const line of t.solution.split('\n')) await run.execute(line, opts)
    expect(run.isComplete).toBe(true)
    expect(run.completedAt).toBeTruthy()
    expect(progress.results).toHaveLength(1)
    expect(progress.results[0]).toMatchObject({ labId: LAB, tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 0 })
    expect(portal.toast).toEqual({ title: 'Lab completed', text: 'Order-processing backend on Service Bus' })
    expect(portal.notifications[0].title).toBe('Lab completed')
    await run.execute('az account show', opts)
    expect(progress.results).toHaveLength(1)
    run.restart()
    expect(run.doneCount).toBe(0)
    expect(run.scrollback).toEqual([])
    expect(run.completedAt).toBeNull()
    expect(run.elapsedMs).toBe(0)
    expect(progress.results).toHaveLength(1)
    expect(portal.blade).toEqual({ kind: 'resource-groups' })
    expect(portal.notifications).toEqual([])
    expect(portal.unread).toBe(0)
  })
})

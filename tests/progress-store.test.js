import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

describe('progress store', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('starts empty and persists results', () => {
    const p = useProgressStore()
    expect(p.results).toEqual([])
    p.addResult({ id: 'r1', labId: 'servicebus-order-backend', tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 0, durationMs: 877000, finishedAt: '2026-09-16T14:42:00.000Z' })
    expect(JSON.parse(localStorage.getItem('at_results'))).toHaveLength(1)
    expect(p.latestResult('servicebus-order-backend').id).toBe('r1')
    expect(p.latestResult('nope')).toBeNull()
  })

  it('labStatus derives from run + results', () => {
    const p = useProgressStore()
    expect(p.labStatus('servicebus-order-backend')).toBe('not-started')
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: null, sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.labStatus('servicebus-order-backend')).toBe('in-progress')
    expect(p.runSummary('servicebus-order-backend')).toEqual({ tasksDone: 0, total: 5, completedAt: null })
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: '2026-09-16T14:42:00.000Z', sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.labStatus('servicebus-order-backend')).toBe('completed')
  })

  it('skillAreaProgress counts labs', () => {
    const p = useProgressStore()
    expect(p.skillAreaProgress('connect')).toEqual({ total: 3, completed: 0, inProgress: 0 })
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: null, sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.skillAreaProgress('connect')).toEqual({ total: 3, completed: 0, inProgress: 1 })
    expect(p.skillAreaProgress('containers')).toEqual({ total: 1, completed: 0, inProgress: 0 })
  })
})

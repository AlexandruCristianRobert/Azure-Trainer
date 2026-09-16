import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

// The engine (runAz/runLine) only ever throws AzError, which run.js already turns
// into an `err` line — there is no reachable input that makes a real command's
// `run()` throw a plain bug. This test mocks shell.js's `runLine` to force that
// (otherwise unreachable) path, to prove execute()'s defensive try/catch keeps the
// shell from sitting stuck instead of leaving `running` true forever.
vi.mock('../src/lib/az/shell.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, runLine: vi.fn(actual.runLine) }
})

const { runLine } = await import('../src/lib/az/shell.js')
const { useLabRunStore } = await import('../src/stores/labRun.js')

const LAB = 'servicebus-order-backend'

describe('labRun execute() defensive catch', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    vi.mocked(runLine).mockClear()
  })

  it('a non-AzError thrown by the engine does not leave the shell stuck', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    vi.mocked(runLine).mockImplementationOnce(() => { throw new TypeError('boom') })
    const result = await run.execute('az group list', { sleep: () => Promise.resolve() })
    expect(result).toBeNull()
    expect(run.running).toBe(false)
    expect(run.scrollback.at(-1)).toEqual({ kind: 'err', text: 'ERROR: boom' })
  })
})

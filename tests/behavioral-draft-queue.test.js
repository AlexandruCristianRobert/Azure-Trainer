import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { HEALTH_MANIFEST, HEALTH_FILES, HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const lab = { id: 'draft-queue-fixture', title: 'Draft queue fixture', engineVersion: 2,
  contentVersion: 1, manifestId: HEALTH_MANIFEST.id, initialProjectFiles: HEALTH_FILES,
  tasks: [{ id: 'never-done', check: () => false }] }
const clone = value => structuredClone(value)

function repository() {
  let stored = null
  let writes = 0
  const snapshots = []
  async function save(candidate, { expectedRevision }) {
    writes++
    if ((stored?.revision ?? 0) !== expectedRevision) throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })
    snapshots.push({ savedApp: candidate.project.savedFiles['app.py'], history: [...candidate.history] })
    stored = { ...clone(candidate), revision: expectedRevision + 1 }
    return clone(stored)
  }
  return {
    async loadRun(labId) { return stored?.labId === labId ? clone(stored) : null },
    saveRun: save,
    async completeRun(candidate, _result, options) { return save(candidate, options) },
    get writes() { return writes },
    get snapshots() { return clone(snapshots) },
  }
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage()
  setActivePinia(createPinia())
})

describe('behavioral draft queue', () => {
  it('coalesces rapid same-file drafts and flushes the latest before saving', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const baseText = HEALTH_FILES['app.py']
    const finalText = HEALTH_SOLUTION_FILES['app.py']
    const drafts = Array.from({ length: 300 }, (_, index) => store.dispatchBehavioral({
      type: 'draft', path: 'app.py', text: index === 299 ? finalText : `${baseText}\n# draft ${index}`,
    }))
    expect(store.busy).toBe(false)

    const saving = store.dispatchBehavioral({ type: 'save-file', path: 'app.py' })
    const commandLine = 'az group create -n done -l westeurope'
    const command = store.dispatchBehavioral({ type: 'command', line: commandLine })
    await Promise.all([...drafts, saving, command])

    expect(store.behavioralRun.project.draftFiles['app.py']).toBe(finalText)
    expect(store.behavioralRun.project.savedFiles['app.py']).toBe(finalText)
    // Initial state, one coalesced draft, save, then the ordered command.
    expect(native.writes).toBe(4)
    expect(store.behavioralRun.history.at(-1)).toBe(commandLine)
    expect(native.snapshots[2].savedApp).toBe(finalText)
    expect(native.snapshots[3]).toMatchObject({ savedApp: finalText, history: [commandLine] })

    const laterDraft = `${finalText}\n# unsaved follow-up`
    await store.dispatchBehavioral({ type: 'draft', path: 'app.py', text: laterDraft })
    expect(store.behavioralRun.project.savedFiles['app.py']).toBe(finalText)
    expect(store.behavioralRun.project.draftFiles['app.py']).toBe(laterDraft)
    expect(native.writes).toBe(5)
    expect(store.busy).toBe(false)
  })

  it('flushes the previous file draft before queuing a different file', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const appDraft = `${HEALTH_FILES['app.py']}\n# app draft`
    const dockerDraft = `${HEALTH_FILES['Dockerfile']}\n# docker draft`
    const first = store.dispatchBehavioral({ type: 'draft', path: 'app.py', text: appDraft })
    const second = store.dispatchBehavioral({ type: 'draft', path: 'Dockerfile', text: dockerDraft })
    await Promise.all([first, second])
    expect(store.behavioralRun.project.draftFiles).toMatchObject({ 'app.py': appDraft, Dockerfile: dockerDraft })
    expect(native.writes).toBe(3)
  })
})

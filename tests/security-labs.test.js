import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { buildExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'

const modulePath = '../src/data/labs/security-journey/security.js'
const journey = await import(/* @vite-ignore */ modulePath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const labs = journey.SECURITY_LABS ?? []
function replay(lab, initial, edit = source => source) {
  let run = initial ?? createBehavioralRun(lab, { attemptId: lab.id })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const result = applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: step.path === 'worker.py' ? edit(step.content) : step.content }
      : { type: 'command', line: step.line }, lab)
    expect(result.diagnostics ?? []).toEqual([])
    expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    run = result.run
  }
  return run
}
const at = index => { expect(labs).toHaveLength(5); return labs[index] }
const rows = run => run.runtime.messaging.executionReceipts.at(-1).measurements.securityObservability.records

describe('code-first security curriculum', () => {
  // A seeded completion receipt would bypass the newly assigned exercise.
  it('supplies independent unfinished baselines and preserves them on restore', () => {
    expect(labs.map(lab => [lab.id, lab.journeyOrder])).toEqual([
      ['security-identity', 1], ['security-secrets', 2], ['security-rotation', 3],
      ['security-configuration', 4], ['security-refresh', 5],
    ])
    for (const lab of labs) {
      const run = createBehavioralRun(lab, { attemptId: `initial-${lab.id}` })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.runtime.messaging.effects).toEqual({})
      expect(run.runtime.messaging.hosts).toEqual({})
      expect(run.runtime.messaging.securityObservability?.records ?? []).toEqual([])
      expect(run.evidence.experimentsById).toEqual({})
      for (const task of lab.tasks) {
        const prompt = buildExplanationPrompt({ labTitle: lab.title, taskText: task.text, rationale: task.rationale, workspace: run })
        expect(prompt).not.toContain('trainer-demo-key-')
        expect(prompt).toContain('C# comparison:')
      }
      expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => !task.done)).toBe(true)
    }
  })
  // Removing any consumer or mismatching its real version/selector must fail proof.
  it.each([0, 1, 2, 3, 4])('replays Lab %i Solution with genuine persisted behavior', index => {
    const lab = at(index), run = replay(lab)
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
    expect(run.runtime.messaging.effects.notifications['e-o1']).toEqual({ eventId: 'e-o1', orderId: 'o1' })
    if (index === 2) expect(rows(run).filter(row => row.kind === 'notification-provider').map(row => row.statusCode)).toEqual([202, 401])
    if (index === 4) expect(rows(run).filter(row => row.kind === 'notification-provider').map(row => [row.statusCode, row.channel])).toEqual([[202, 'email'], [202, 'sms'], [202, 'sms']])
    const publicProof = JSON.stringify([run.evidence, run.runtime.messaging])
    expect(publicProof).not.toContain('trainer-demo-key-v1')
    expect(publicProof).not.toContain('trainer-demo-key-v2')
    expect(publicProof).not.toContain('trainer-demo-key-v3')
  })
  it('cannot complete with an unused actual secret lookup', () => {
    const lab = at(1), run = replay(lab, undefined, source => source.replace('return send_notification("e-o1", "o1", secret.value, "email")', 'return None'))
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('cannot complete rotation while consuming the pinned retired version', () => {
    const lab = at(2), run = replay(lab, undefined, source => source.replace('latest = client.get_secret("notification-api-key")', 'latest = client.get_secret("notification-api-key", version=old_version)'))
    expect(rows(run).filter(row => row.kind === 'notification-provider').map(row => row.statusCode)).toEqual([401, 401])
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('cannot complete configuration by consuming the wrong label', () => {
    const lab = at(3), run = replay(lab, undefined, source => source.replace('label_filter="production"', 'label_filter="development"'))
    expect(rows(run).find(row => row.kind === 'notification-provider')).toMatchObject({ statusCode: 202, configLabel: 'development', channel: 'console' })
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('cannot complete refresh by loading a new provider', () => {
    const lab = at(4), run = replay(lab, undefined, source => source.replaceAll('config.refresh()', 'config = load(endpoint="https://ac-orders.azconfig.io", credential=credential, selects=[SettingSelector(key_filter="Orders:*", label_filter="production")], keyvault_credential=credential)'))
    expect(rows(run).filter(row => row.kind === 'notification-provider').every(row => row.statusCode === 202)).toBe(true)
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  // Resource generation and file generation must survive change/revert.
  it('requires new verification after relevant change/revert but permits notes', () => {
    const lab = at(3)
    let run = replay(lab)
    run = applyRunAction(run, { type: 'save-file', path: 'README.md', text: 'Local notes' }, lab).run
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    const text = run.project.savedFiles['worker.py']
    for (const value of [text + '\n# edit\n', text]) run = applyRunAction(run, { type: 'save-file', path: 'worker.py', text: value }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).status).toBe('needs-verification')
    run = applyRunAction(run, { type: 'command', line: 'python worker.py' }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(true)
    for (const value of ['console', 'email']) run = applyRunAction(run, { type: 'command', line: `az appconfig kv set -n ac-orders --key Orders:Channel --label production --value ${value} --yes` }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).status).toBe('needs-verification')
  })
})

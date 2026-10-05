import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { buildExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'
import { runLine } from '../src/lib/az/shell.js'
import { validSecurityRecord } from '../src/lib/security/state.js'
import { SECRETS_OFFICER_ROLE_ID, SECRETS_USER_ROLE_ID } from '../src/lib/sandbox/keyvault.js'
import { USER_OBJECT_ID } from '../src/lib/sandbox/model.js'

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
    if (index === 4) {
      expect(rows(run).filter(row => row.kind === 'notification-provider').map(row => [row.statusCode, row.channel])).toEqual([[202, 'email'], [202, 'sms'], [202, 'sms']])
      const load = rows(run).find(row => row.kind === 'config-load')
      expect(load).toMatchObject({ watchKeys: [{ key: 'Orders:Sentinel', label: 'production' }], refreshIntervalSeconds: 30, secretRefreshIntervalSeconds: 60 })
      for (const bad of [
        { ...load, watchKeys: [{ key: 'Orders:Sentinel', label: 'production', value: 'unmodeled' }] },
        { ...load, refreshIntervalSeconds: 0 }, { ...load, secretRefreshIntervalSeconds: 86401 },
      ]) expect(validSecurityRecord(bad, [])).toBe(false)
      const malformed = structuredClone(run)
      malformed.runtime.messaging.securityObservability.records.find(row => row.kind === 'config-load').refreshIntervalSeconds = 0
      expect(() => deserializeRun(JSON.stringify(malformed), lab)).toThrow()
    }
    const publicProof = JSON.stringify([run.evidence, run.runtime.messaging])
    expect(publicProof).not.toContain('trainer-demo-key-v1')
    expect(publicProof).not.toContain('trainer-demo-key-v2')
    expect(publicProof).not.toContain('trainer-demo-key-v3')
  })
  it('cannot complete with an unused actual secret lookup', () => {
    const lab = at(1), run = replay(lab, undefined, source => source.replace('return send_notification("e-o1", "o1", secret.value, "email")', 'return None'))
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  // Break: successful Officer reads satisfy the Lab's least-privilege User task.
  it.each([false, true])('rejects application Officer grants even when Secrets User is also present: %s', withUser => {
    const lab = at(0)
    const edited = { ...lab, tasks: lab.tasks.map(task => task.id !== 'grant-vault-read' ? task : {
      ...task, solution: { steps: task.solution.steps.flatMap(step => step.kind === 'command' && step.line.includes('role assignment create')
        ? [{ ...step, line: step.line.replace('Key Vault Secrets User', 'Key Vault Secrets Officer') }, ...(withUser ? [step] : [])] : [step]) },
    }) }
    const run = replay(edited)
    expect(rows(run).some(row => row.kind === 'secret-read')).toBe(true)
    expect(rows(run).some(row => row.kind === 'notification-provider' && row.statusCode === 202)).toBe(true)
    expect(run.sandbox.keyVaults[0].roleAssignments.some(role => role.principalId === USER_OBJECT_ID && role.roleDefinitionId === SECRETS_OFFICER_ROLE_ID)).toBe(true)
    expect(evaluateLab(lab, run).tasks.find(task => task.id === 'grant-vault-read').done).toBe(false)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.find(task => task.id === 'grant-vault-read').done).toBe(false)
  })
  it('requires Secrets User metadata at the exact vault for the actual attached application', () => {
    const lab = at(0), run = replay(lab)
    const grant = lab.tasks.find(task => task.id === 'grant-vault-read')
    expect(grant.check(run)).toBe(true)
    for (const changed of [{ scope: '/training/wrong-vault' }, { principalId: USER_OBJECT_ID }]) {
      const malformed = structuredClone(run)
      Object.assign(malformed.sandbox.keyVaults[0].roleAssignments.find(role => role.roleDefinitionId === SECRETS_USER_ROLE_ID), changed)
      expect(grant.check(malformed)).toBe(false)
    }
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
  it.each([
    ['omitted watch', source => source.replace('refresh_on=[WatchKey("Orders:Sentinel", label="production")], ', '')],
    ['wrong watch', source => source.replace('WatchKey("Orders:Sentinel", label="production")', 'WatchKey("Orders:Channel", label="production")')],
    ['wrong intervals', source => source.replace('refresh_interval=30', 'refresh_interval=1').replace('secret_refresh_interval=60', 'secret_refresh_interval=1')],
  ])('cannot complete refresh with %s despite successful changed consumption', (_, edit) => {
    const lab = at(4), run = replay(lab, undefined, edit)
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

  // Output selection must not alter resource construction or hide diagnostics.
  it('preserves ordinary secret-set JSON data output', () => {
    const initial = createBehavioralRun(at(2), { attemptId: 'cli-default' })
    const line = 'az keyvault secret set --vault-name kv-orders --name notification-api-key --value trainer-demo-key-v2'
    for (const suffix of ['', ' --output json', ' --output jsonc']) {
      const result = runLine(initial.sandbox, line + suffix)
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].kind).toBe('out')
      expect(JSON.parse(result.lines[0].text)).toMatchObject({ value: 'trainer-demo-key-v2' })
      expect(result.sandbox.keyVaults[0].secrets[0].versions).toHaveLength(2)
    }
  })
  it('suppresses successful CLI data with none while preserving actual version and event', () => {
    const initial = createBehavioralRun(at(2), { attemptId: 'cli-none' })
    for (const outputOption of ['--output none', '-o none']) {
      const result = runLine(initial.sandbox, `az keyvault secret set --vault-name kv-orders --name notification-api-key --value trainer-demo-key-v2 ${outputOption}`)
      expect(result.lines).toEqual([])
      const versions = result.sandbox.keyVaults[0].secrets[0].versions
      expect(versions).toHaveLength(2)
      expect(versions[1].value).toBe('trainer-demo-key-v2')
      expect(versions[1].version).not.toBe(versions[0].version)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ type: 'created', resourceType: 'keyVaultSecret', name: 'notification-api-key', version: versions[1].version })
    }
  })
  it('keeps errors and help visible with output none', () => {
    const initial = createBehavioralRun(at(2), { attemptId: 'cli-error' })
    const failed = runLine(initial.sandbox, 'az keyvault secret set --vault-name missing-vault --name notification-api-key --value trainer-demo-key-v2 --output none')
    expect(failed.lines.some(row => row.kind === 'err' && row.text.includes('ResourceNotFound'))).toBe(true)
    expect(failed.sandbox).toEqual(initial.sandbox)
    expect(failed.events).toEqual([])
    const help = runLine(initial.sandbox, 'az keyvault secret set --help --output none')
    expect(help.lines.some(row => row.kind === 'out' && row.text.includes('--vault-name'))).toBe(true)
  })
})

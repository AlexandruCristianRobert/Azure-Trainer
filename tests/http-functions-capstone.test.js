import { beforeAll, describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { buildExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'

const load = () => import('../src/data/labs/http-functions-journey/capstone.lab.js')
const act = (lab, run, step) => applyRunAction(run, step.kind === 'file'
  ? { type: 'save-file', path: step.path, text: step.content }
  : { type: 'command', line: step.line }, lab)
const command = (lab, run, line) => act(lab, run, { kind: 'command', line })
const messages = run => Object.values(run.runtime.messaging.entities).flatMap(entity => entity.messages)
const invocation = receipt => receipt.measurements.httpFunctions?.invocations[0]
function replay(lab, transform = step => step) {
  let run = createBehavioralRun(lab, { attemptId: 'capstone' }), responses = []
  for (const original of lab.tasks[0].solution.steps) {
    const step = transform(original)
    if (!step) continue
    const result = act(lab, run, step)
    expect(result.diagnostics ?? [], step.path ?? step.line).toEqual([])
    run = result.run
    if (result.httpResponse) responses.push(result.httpResponse)
  }
  return { run, responses }
}

describe('protected published HTTP order capstone', () => {
  let lab, completed, responses
  beforeAll(async () => {
    lab = (await load()).httpCapstoneLab
    ;({ run: completed, responses } = replay(lab))
  })

  it('constructs an unfinished independent API and earns actual restorable binding/worker/retry proof', () => {
    const initial = createBehavioralRun(lab, { attemptId: 'initial' })
    expect(initial.runtime.messaging.httpFunctions).toBeUndefined()
    expect(initial.runtime.messaging.executionReceipts).toEqual([])
    expect(messages(initial)).toEqual([])
    expect(evaluateLab(lab, deserializeRun(serializeRun(initial), lab)).tasks.every(task => !task.done)).toBe(true)
    expect(lab.labMode).toBe('capstone')
    expect(lab.messagingExercise.tasks).toHaveLength(1)
    expect(responses.map(row => row.statusCode)).toEqual([401, 401, 400, 400, 202, 200, 200, 200, 409])
    expect(responses.slice(4, 8).map(row => JSON.parse(row.body))).toEqual([
      { id: 'o1', status: 'pending' }, { id: 'o1', status: 'pending' },
      { id: 'o1', status: 'processed' }, { id: 'o1', status: 'processed' },
    ])
    expect(evaluateLab(lab, completed).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(completed), lab)).isComplete).toBe(true)
    const state = completed.runtime.messaging
    expect(state.httpFunctions.accepted.map(row => row.order)).toEqual([{ id: 'o1', region: 'EU', quantity: 2 }])
    expect(state.executionReceipts.flatMap(row => invocation(row)?.operations ?? []).map(row => row.kind)).toEqual(['binding-send'])
    expect(messages(completed)).toHaveLength(1)
    expect(messages(completed)[0].status).toBe('completed')
    expect(state.effects.workByOrder).toEqual({ o1: 1 })
    expect(state.effects.processed).toEqual({ o1: { id: 'o1', region: 'EU', quantity: 2 } })
    const key = lab.messagingInput.httpFunctions.functionKeys[0].value
    expect(JSON.stringify({ runtime: state, evidence: completed.evidence, responses })).not.toContain(key)
    const prompt = buildExplanationPrompt({ labTitle: lab.title, taskText: lab.tasks[0].text, rationale: lab.tasks[0].rationale })
    expect(prompt).not.toContain(key)
    expect(prompt).toContain('C# comparison:')
  })

  it('README notes are harmless while source and resource change/revert stale all episode proof', () => {
    const notes = act(lab, completed, { kind: 'file', path: 'README.md', content: 'My order API notes' }).run
    expect(evaluateLab(lab, notes).isComplete).toBe(true)
    const source = notes.project.savedFiles['function_app.py']
    let stale = act(lab, notes, { kind: 'file', path: 'function_app.py', content: source + '\n# edited' }).run
    stale = act(lab, stale, { kind: 'file', path: 'function_app.py', content: source }).run
    expect(evaluateLab(lab, deserializeRun(serializeRun(stale), lab)).isComplete).toBe(false)
    stale = command(lab, notes, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status SendDisabled').run
    stale = command(lab, stale, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status Active').run
    expect(evaluateLab(lab, deserializeRun(serializeRun(stale), lab)).isComplete).toBe(false)
  })

  it('a replacement capture cannot borrow prior current observations', () => {
    const newer = command(lab, completed, 'func azure functionapp publish func-orders').run
    expect(evaluateLab(lab, deserializeRun(serializeRun(newer), lab)).isComplete).toBe(false)
  })

  it('missing current task evidence never becomes done from historical broker effects', () => {
    const missing = structuredClone(completed)
    missing.evidence.experimentsById = {}
    missing.evidence.currentEvidenceByTask = {}
    expect(evaluateLab(lab, deserializeRun(JSON.stringify(missing), lab)).isComplete).toBe(false)
  })

  it('restore rejects response, consumed-field, accepted payload and worker-origin tampering', () => {
    for (const mutate of [
      run => { run.runtime.messaging.httpFunctions.requests.at(-1).response.statusCode = 200 },
      run => { run.runtime.messaging.httpFunctions.accepted[0].order.quantity = 3 },
      run => { invocation(run.runtime.messaging.executionReceipts.at(-1)).reads[0].record.origin.workerReceiptId = null },
      run => { const receipt = run.runtime.messaging.executionReceipts.find(row => invocation(row)?.consumedFields.length); invocation(receipt).consumedFields = [] },
      run => { delete run.runtime.messaging.httpFunctions.requests[0].inputClass },
    ]) {
      const tampered = structuredClone(completed)
      mutate(tampered)
      expect(() => deserializeRun(JSON.stringify(tampered), lab)).toThrow()
    }
  })

  it('unused repository reads with literal matching status responses cannot complete', () => {
    const { run, responses: literal } = replay(lab, step => step.kind !== 'file' ? step : {
      ...step, content: step.content.replace('    return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}), mimetype="application/json")',
        '    if record.status == "pending":\n        return func.HttpResponse(json.dumps({"id":"o1","status":"pending"}), mimetype="application/json")\n    return func.HttpResponse(json.dumps({"id":"o1","status":"processed"}), mimetype="application/json")'),
    })
    expect(literal[6].statusCode).toBe(200)
    expect(JSON.parse(literal[5].body)).toEqual({ id: 'o1', status: 'pending' })
    expect(JSON.parse(literal[6].body)).toEqual({ id: 'o1', status: 'processed' })
    const reads = run.runtime.messaging.executionReceipts.filter(row => row.measurements.httpFunctions?.requests[0]?.method === 'GET'
      && row.measurements.httpFunctions.requests[0].response.statusCode === 200)
    expect(reads.every(row => invocation(row).reads.length === 1 && invocation(row).consumedFields.length === 0)).toBe(true)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('literal 202 without a binding setter creates no acceptance and earns no task proof', () => {
    let run = createBehavioralRun(lab, { attemptId: 'no-binding' })
    for (const original of lab.tasks[0].solution.steps.slice(0, 7)) {
      const step = original.kind === 'file' ? { ...original, content: original.content.replace('    output.set(json.dumps(order))', '    print("no output")') } : original
      const result = act(lab, run, step)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    expect(run.runtime.messaging.httpFunctions.requests.at(-1).response.statusCode).toBe(202)
    expect(run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(messages(run)).toEqual([])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('anonymous GET cannot satisfy protected order API proof', () => {
    const { run, responses: anonymous } = replay(lab, step => step.kind !== 'file' ? step : {
      ...step, content: step.content.replace('methods=["GET"], auth_level=func.AuthLevel.FUNCTION', 'methods=["GET"]'),
    })
    expect(anonymous[1].statusCode).toBe(404)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('a genuine SDK send cannot substitute for the assigned output binding', async () => {
    const { HTTP_KEYS_SOURCE } = await import('../src/data/templates/http-functions-python/hosting.js')
    const source = HTTP_KEYS_SOURCE.replace('route="orders/{id}", methods=["GET"]',
      'route="orders/{id}", methods=["GET"], auth_level=func.AuthLevel.FUNCTION')
    const { run, responses: sdk } = replay(lab, step => step.kind === 'file' ? { ...step, content: source } : step)
    expect(sdk.map(row => row.statusCode)).toEqual([401, 401, 400, 400, 202, 200, 200, 200, 409])
    expect(messages(run)[0].status).toBe('completed')
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('equivalent learner source earns proof without matching Solution text', () => {
    const { run } = replay(lab, step => step.kind === 'file' ? { ...step,
      content: '# My API implementation\n' + step.content.replaceAll('mimetype="application/json"', 'mimetype="application/json; charset=utf-8"') } : step)
    expect(evaluateLab(lab, run).isComplete).toBe(true)
  })
})

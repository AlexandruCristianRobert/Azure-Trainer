import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { buildExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'

const load = () => import('../src/data/labs/http-functions-journey/basic.js')
const ids = ['start', 'status', 'validation', 'enqueue', 'retries']
const statuses = [[200], [404, 200], [400, 400, 400, 400, 400, 400, 400, 400, 400, 200], [202, 200], [202, 200, 409, 200]]
function replay(lab, source, { limit, expectedDiagnostic } = {}) {
  let run = createBehavioralRun(lab, { attemptId: lab.id }), responses = [], diagnostics = []
  for (const step of lab.tasks[0].solution.steps.slice(0, limit)) {
    const action = step.kind === 'file' ? { type: 'save-file', path: step.path, text: source ?? step.content }
      : { type: 'command', line: step.line }
    const result = applyRunAction(run, action, lab)
    if (expectedDiagnostic) expect((result.diagnostics ?? []).every(row => row.code === expectedDiagnostic)).toBe(true)
    else expect(result.diagnostics ?? [], step.line ?? step.path).toEqual([])
    diagnostics.push(...result.diagnostics ?? [])
    run = result.run
    if (result.httpResponse) responses.push(result.httpResponse)
  }
  return { run, responses, diagnostics }
}

describe('guided HTTP API construction', () => {
  // Catches missing independent fixtures, literal response credit, and stale persisted proof.
  for (const [index, id] of ids.entries()) it(`${id} starts unfinished and its one Solution episode earns current proof`, async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[index]
    expect(lab.id).toBe(`http-functions-${id}`)
    expect(lab.journeyOrder).toBe(index + 1)
    expect(lab.journeyId).toBe('http-functions-orders')
    expect(lab.skillAreaId).toBe('connect')
    expect(lab.engineVersion).toBe(2)
    expect(lab.contentVersion).toBe(1)
    expect(lab.manifestId).toBe('http-functions-python-v1')
    expect(lab.capabilities).toEqual({ messaging: true, httpFunctions: true })
    const initial = createBehavioralRun(lab, { attemptId: lab.id })
    expect(evaluateLab(lab, initial).doneCount).toBe(0)
    expect(initial.runtime.messaging.httpFunctions).toBeUndefined()
    expect(initial.runtime.messaging.executionReceipts).toEqual([])
    expect(initial.evidence.experimentsById).toEqual({})
    expect(evaluateLab(lab, deserializeRun(serializeRun(initial), lab)).doneCount).toBe(0)
    const { run, responses } = replay(lab)
    expect(responses.map(row => row.statusCode)).toEqual(statuses[index])
    expect(evaluateLab(lab, run).isComplete).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run), lab)).isComplete).toBe(true)
    const messages = Object.values(run.runtime.messaging.entities).flatMap(entity => entity.messages)
    expect(messages.length).toBe([0, 1, 0, 1, 1][index])
    if (index >= 3) expect(JSON.parse(messages[0].body)).toEqual({ id: 'o1', region: 'EU', quantity: 2 })
    if (index === 2) {
      expect(run.runtime.messaging.httpFunctions.requests.map(row => row.inputClass)).toEqual([
        'malformed', 'nonobject', 'fields', 'id', 'region', 'quantity-bool', 'quantity-type', 'quantity-fraction', 'quantity-range', 'valid',
      ])
      expect(run.runtime.messaging.executionReceipts.filter(row => row.measurements.httpFunctions?.invocations.length)
        .map(row => row.measurements.httpFunctions.invocations[0].inputClass)).toEqual([
        'malformed', 'nonobject', 'fields', 'id', 'region', 'quantity-bool', 'quantity-type', 'quantity-fraction', 'quantity-range', 'valid',
      ])
    }
    if (index === 4) {
      expect(messages[0].status).toBe('completed')
      expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
      expect(run.runtime.messaging.effects.processed.o1).toEqual({ id: 'o1', region: 'EU', quantity: 2 })
      expect(JSON.parse(responses.at(-1).body)).toEqual({ id: 'o1', status: 'processed' })
    }
    const prompt = buildExplanationPrompt({ labTitle: lab.title, taskText: lab.tasks[0].text, rationale: lab.tasks[0].rationale })
    expect(prompt).toContain('C# comparison:')
    expect(prompt).not.toContain(lab.messagingInput.httpFunctions.functionKeys[0].value)
    const notes = applyRunAction(run, { type: 'save-file', path: 'README.md', text: 'Personal notes' }, lab).run
    expect(evaluateLab(lab, notes).isComplete).toBe(true)
    const source = run.project.savedFiles['function_app.py']
    let stale = applyRunAction(notes, { type: 'save-file', path: 'function_app.py', text: source + '\n# edited' }, lab).run
    stale = applyRunAction(stale, { type: 'save-file', path: 'function_app.py', text: source }, lab).run
    expect(evaluateLab(lab, deserializeRun(serializeRun(stale), lab)).isComplete).toBe(false)
  })

  it('does not credit text/plain health JSON and accepts application/json with a charset', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[0]
    for (const [mimetype, complete] of [['text/plain', false], ['application/json; charset=utf-8', true]]) {
      const source = lab.tasks[0].solution.steps[0].content.replace('mimetype="application/json"', `mimetype="${mimetype}"`)
      const { run, responses } = replay(lab, source)
      expect(responses[0].statusCode).toBe(200)
      expect(JSON.parse(responses[0].body)).toEqual({ status: 'ok' })
      expect(responses[0].headers['content-type']).toBe(mimetype)
      expect(evaluateLab(lab, run).isComplete, mimetype).toBe(complete)
      expect(evaluateLab(lab, deserializeRun(serializeRun(run), lab)).isComplete, mimetype).toBe(complete)
    }
  })

  it('does not credit an unused status read followed by a matching literal', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[1]
    const source = lab.tasks[0].solution.steps[0].content.replace('json.dumps({"id":record.id,"status":record.status})', '\'{"id":"o1","status":"pending"}\'')
    const { run, responses } = replay(lab, source)
    expect(responses.at(-1).statusCode).toBe(200)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })
  it('does not credit invalid input when a handler enqueues then returns 400', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[2]
    const source = `import json\nimport azure.functions as func\nfrom clients import bus\nfrom azure.servicebus import ServiceBusMessage\napp = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)\n@app.route(route="orders", methods=["POST"])\ndef post_order(req: func.HttpRequest) -> func.HttpResponse:\n    with bus.get_queue_sender(queue_name="orders") as sender:\n        sender.send_messages(ServiceBusMessage(json.dumps({"id":"o1","region":"EU","quantity":2}), message_id="o1"))\n    return func.HttpResponse("invalid", status_code=400)\n`
    const { run, responses } = replay(lab, source, { limit: 3 })
    expect(responses[0].statusCode).toBe(400)
    expect(Object.values(run.runtime.messaging.entities)[0].messages.length).toBe(1)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })
  it('does not credit literal 202 and pending without an actual queue send', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[3]
    const source = lab.tasks[0].solution.steps[0].content.replace('        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"]))', '        print("no send")')
    const { run, responses } = replay(lab, source)
    expect(responses[0].statusCode).toBe(202)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })
  it('does not credit repeated sends instead of repository-based retry reuse', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[4]
    const source = lab.tasks[0].solution.steps[0].content.replace('    if record is not None:', '    if False:')
    const { run, diagnostics } = replay(lab, source, { expectedDiagnostic: 'HTTP_CONFIG' })
    expect(diagnostics.length).toBe(2)
    expect(Object.values(run.runtime.messaging.entities)[0].messages.length).toBe(1)
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('requires distinct invalid inputs rather than repeating one malformed case', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[2]
    let run = createBehavioralRun(lab, { attemptId: lab.id })
    const steps = lab.tasks[0].solution.steps
    for (const step of [steps[0], steps[1], ...Array(9).fill(steps[2]), steps.at(-1)]) {
      const result = applyRunAction(run, step.kind === 'file'
        ? { type: 'save-file', path: step.path, text: step.content } : { type: 'command', line: step.line }, lab)
      expect(result.diagnostics ?? []).toEqual([])
      run = result.run
    }
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('fails closed on ambiguous not/and/or while preserving explicit parentheses and comparisons', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[0]
    for (const [expression, rejected] of [['not True or True', true], ['not True and False', true], ['not not True or True', true],
      ['not (True or False)', false], ['(not True) or False', false], ['(not True) and False', false],
      ['not not (True and False)', false], ['not True == False', false]]) {
      let run = createBehavioralRun(lab, { attemptId: 'precedence' })
      const source = `import azure.functions as func\napp = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)\n@app.route(route="health", methods=["GET"])\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    if ${expression}:\n        return func.HttpResponse("yes")\n    return func.HttpResponse("no")\n`
      run = applyRunAction(run, { type: 'save-file', path: 'function_app.py', text: source }, lab).run
      const captured = applyRunAction(run, { type: 'command', line: 'func start' }, lab)
      expect(captured.diagnostics.map(row => row.code), expression).toEqual(rejected ? ['MESSAGING_UNSUPPORTED'] : [])
    }
  })

  it('rejects single-copy classification mutation when restoring request/Invocation ownership', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[0]
    let run = createBehavioralRun(lab, { attemptId: 'classification' })
    for (const step of lab.tasks[0].solution.steps) run = applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: step.content } : { type: 'command', line: step.line }, lab).run
    expect(run.runtime.messaging.httpFunctions.requests[0].inputClass).toBe('none')
    for (const mutate of [state => { state.httpFunctions.requests[0].inputClass = 'malformed' },
      state => { state.executionReceipts.at(-1).measurements.httpFunctions.invocations[0].inputClass = 'malformed' }]) {
      const changed = structuredClone(run); mutate(changed.runtime.messaging)
      expect(() => deserializeRun(JSON.stringify(changed), lab)).toThrow()
    }
  })

  it('classifies protected canonical input without persisting the demo value or forcing a success response', async () => {
    const { HTTP_BASIC_LABS } = await load(), lab = HTTP_BASIC_LABS[2]
    const { run: captured } = replay(lab, undefined, { limit: 2 })
    const secret = lab.messagingInput.httpFunctions.functionKeys[0].value
    const result = applyRunAction(captured, { type: 'command',
      line: `curl -X POST -H "Content-Type: application/json" -d '{"id":"${secret}","region":"EU","quantity":2}' http://localhost:7071/api/orders` }, lab)
    expect(result.diagnostics.map(row => row.code)).toEqual(['HTTP_PRIVACY'])
    expect(result.httpResponse.statusCode).toBe(503)
    expect(result.run.runtime.messaging.httpFunctions.requests.at(-1).inputClass).toBe('protected')
    const invocation = result.run.runtime.messaging.executionReceipts.at(-1).measurements.httpFunctions.invocations[0]
    expect(invocation.inputClass).toBe('protected')
    expect(invocation.requestOrder).toBeNull()
    expect(JSON.stringify(result.run.runtime.messaging)).not.toContain(secret)
    expect(evaluateLab(lab, deserializeRun(serializeRun(result.run), lab)).isComplete).toBe(false)
  })
})

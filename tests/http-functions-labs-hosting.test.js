import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { buildExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'

const load = () => import('../src/data/labs/http-functions-journey/hosting.js')
const cloud = 'https://func-orders.azurewebsites.net/api'
const local = 'http://localhost:7071/api'
const post = (endpoint, key) => `curl -i -X POST -H "Content-Type: application/json" ${key ? `-H "x-functions-key: ${key}" ` : ''}-d '{"id":"o1","region":"EU","quantity":2}' ${endpoint}/orders`
const act = (lab, run, step) => applyRunAction(run, step.kind === 'file'
  ? { type: 'save-file', path: step.path, text: step.content }
  : { type: 'command', line: step.line }, lab)
function replay(lab, transform = step => step) {
  let run = createBehavioralRun(lab, { attemptId: lab.id }), responses = []
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
const command = (lab, run, line) => act(lab, run, { kind: 'command', line })
const messages = run => Object.values(run.runtime.messaging.entities).flatMap(entity => entity.messages)

describe('guided HTTP hosting, access and output binding', () => {
  // Missing construction, stale source credit or absent broker work must fail these episodes.
  for (const [index, stage, statuses] of [[0, 'publish', [200, 200]], [1, 'keys', [401, 401, 202, 200]],
    [2, 'binding', [202, 200, 200]]]) it(`${stage} starts unfinished and earns current restorable episode proof`, async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[index]
    expect(HTTP_HOSTING_LABS.map(row => row.journeyOrder)).toEqual([6, 7, 8])
    expect(lab.id).toBe(`http-functions-${stage}`)
    expect(lab.journeyId).toBe('http-functions-orders')
    expect(lab.skillAreaId).toBe('connect')
    expect(lab.manifestId).toBe('http-functions-python-v1')
    expect(lab.capabilities).toEqual({ messaging: true, httpFunctions: true })
    expect(lab.labMode).toBe('guided')
    expect(lab.messagingExercise.tasks).toHaveLength(1)
    const initial = createBehavioralRun(lab, { attemptId: lab.id })
    expect(initial.runtime.messaging.httpFunctions).toBeUndefined()
    expect(initial.runtime.messaging.executionReceipts).toEqual([])
    expect(messages(initial)).toEqual([])
    expect(evaluateLab(lab, deserializeRun(serializeRun(initial), lab)).doneCount).toBe(0)
    const { run, responses } = replay(lab)
    expect(responses.map(row => row.statusCode)).toEqual(statuses)
    expect(evaluateLab(lab, run).isComplete).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run), lab)).isComplete).toBe(true)
    const publicProof = JSON.stringify({ runtime: run.runtime.messaging, evidence: run.evidence, responses })
    const key = lab.messagingInput.httpFunctions.functionKeys[0].value
    expect(publicProof).not.toContain(key)
    expect(buildExplanationPrompt({ labTitle: lab.title, taskText: lab.tasks[0].text,
      rationale: lab.tasks[0].rationale })).not.toContain(key)
    expect(buildExplanationPrompt({ labTitle: lab.title, taskText: lab.tasks[0].text,
      rationale: lab.tasks[0].rationale })).toContain('C# comparison:')
    if (stage === 'publish') expect(responses.map(row => JSON.parse(row.body))).toEqual([
      { environment: 'local' }, { environment: 'published' },
    ])
    if (stage === 'keys') {
      const requests = run.runtime.messaging.httpFunctions.requests
      expect(requests.map(row => row.authorization)).toEqual(['denied', 'denied', 'granted', 'not-required'])
      for (const receipt of run.runtime.messaging.executionReceipts.filter(row => row.measurements.httpFunctions?.requests[0]?.authorization === 'denied')) {
        expect(receipt.measurements.httpFunctions.invocations[0].operations).toEqual([])
        expect(receipt.measurements.httpFunctions.invocations[0].reads).toEqual([])
        expect(receipt.measurements.httpFunctions.accepted).toEqual([])
      }
      expect(messages(run)).toHaveLength(1)
    }
    if (stage === 'binding') {
      const invocation = run.runtime.messaging.executionReceipts.find(row => row.measurements.httpFunctions?.accepted.length)?.measurements.httpFunctions.invocations[0]
      expect(invocation.operations.map(row => row.kind)).toEqual(['binding-send'])
      expect(messages(run)).toHaveLength(1)
      expect(messages(run)[0].status).toBe('completed')
      expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
      expect(JSON.parse(responses[1].body)).toEqual({ id: 'o1', status: 'pending' })
      expect(JSON.parse(responses[2].body)).toEqual({ id: 'o1', status: 'processed' })
    }
    const notes = act(lab, run, { kind: 'file', path: 'README.md', content: 'My notes' }).run
    expect(evaluateLab(lab, notes).isComplete).toBe(true)
    const source = notes.project.savedFiles['function_app.py']
    let stale = act(lab, notes, { kind: 'file', path: 'function_app.py', content: source + '\n# changed' }).run
    stale = act(lab, stale, { kind: 'file', path: 'function_app.py', content: source }).run
    expect(evaluateLab(lab, deserializeRun(serializeRun(stale), lab)).isComplete).toBe(false)
  })

  it('rejects unused getenv with a matching literal JSON response', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[0]
    const { run, responses } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
      ...step, content: step.content.replace('    return func.HttpResponse(json.dumps({"environment":environment}), mimetype="application/json")',
        '    if "localhost" in req.url:\n        return func.HttpResponse(json.dumps({"environment":"local"}), mimetype="application/json")\n    return func.HttpResponse(json.dumps({"environment":"published"}), mimetype="application/json")'),
    })
    expect(responses.map(row => row.statusCode)).toEqual([200, 200])
    expect(responses.map(row => JSON.parse(row.body))).toEqual([{ environment: 'local' }, { environment: 'published' }])
    expect(run.runtime.messaging.executionReceipts.filter(row => row.measurements.httpFunctions?.invocations.length)
      .map(row => row.measurements.httpFunctions.invocations[0].consumedFields)).toEqual([[], []])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('executes a stale published snapshot without crediting newly saved source', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[0]
    const { run: completed } = replay(lab)
    const source = completed.project.savedFiles['function_app.py']
    const saved = act(lab, completed, { kind: 'file', path: 'function_app.py',
      content: source.replace('"environment":environment', '"deployment":environment') }).run
    const requested = command(lab, saved, `curl -i ${cloud}/environment`)
    expect(requested.diagnostics).toEqual([])
    expect(JSON.parse(requested.httpResponse.body)).toEqual({ environment: 'published' })
    expect(evaluateLab(lab, deserializeRun(serializeRun(requested.run), lab)).isComplete).toBe(false)
  })

  it('reads changed cloud settings immediately while local settings require another capture', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[0]
    let { run } = replay(lab)
    run = command(lab, run, 'az functionapp config appsettings set -g rg-messaging -n func-orders --settings ENVIRONMENT=changed-cloud').run
    const published = command(lab, run, `curl -i ${cloud}/environment`)
    expect(published.diagnostics).toEqual([])
    expect(JSON.parse(published.httpResponse.body)).toEqual({ environment: 'changed-cloud' })
    run = act(lab, published.run, { kind: 'file', path: 'local.settings.json',
      content: published.run.project.savedFiles['local.settings.json'].replace('"local"', '"changed-local"') }).run
    const captured = command(lab, run, `curl -i ${local}/environment`)
    expect(JSON.parse(captured.httpResponse.body)).toEqual({ environment: 'local' })
    expect(evaluateLab(lab, captured.run).isComplete).toBe(false)
    run = command(lab, captured.run, 'func start').run
    const restarted = command(lab, run, `curl -i ${local}/environment`)
    expect(JSON.parse(restarted.httpResponse.body)).toEqual({ environment: 'changed-local' })
  })

  it('does not accept anonymous cloud sends as proof of function-key construction', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[1]
    const { run, responses } = replay(lab, step => {
      if (step.kind === 'file' && step.path === 'function_app.py') return { ...step,
        content: step.content.replace('methods=["POST"], auth_level=func.AuthLevel.FUNCTION', 'methods=["POST"]') }
      return step
    })
    expect(responses.map(row => row.statusCode)).toEqual([202, 200, 200, 200])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('denied malformed requests cannot replace the assigned same-order authorization comparison', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[1]
    const { run, responses } = replay(lab, step => step.kind === 'command'
      && step.line.startsWith('curl') && step.line.includes(cloud)
      && (!step.line.includes('x-functions-key:') || step.line.includes('deliberately-wrong-demo-key'))
      ? { ...step, line: step.line.replace("'{\"id\":\"o1\",\"region\":\"EU\",\"quantity\":2}'", "'{'") } : step)
    expect(responses.map(row => row.statusCode)).toEqual([401, 401, 202, 200])
    expect(run.runtime.messaging.httpFunctions.requests.slice(0, 2).map(row => row.inputClass)).toEqual(['malformed', 'malformed'])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('failed output flush produces 503 with no acceptance or queue message', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[2]
    let run = createBehavioralRun(lab, { attemptId: 'failed-flush' })
    for (const step of lab.tasks[0].solution.steps) {
      if (step.kind === 'command' && step.line.startsWith('curl')) break
      run = act(lab, run, step).run
    }
    run = command(lab, run, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status SendDisabled').run
    const key = lab.messagingInput.httpFunctions.functionKeys[0].value
    const failed = command(lab, run, post(cloud, key))
    expect(failed.httpResponse.statusCode).toBe(503)
    expect(failed.run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(messages(failed.run)).toEqual([])
    expect(evaluateLab(lab, deserializeRun(serializeRun(failed.run), lab)).isComplete).toBe(false)
  })

  it('a literal 202 without Out.set cannot complete the binding task', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[2]
    const { run, responses } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
      ...step, content: step.content.replace('    output.set(json.dumps(order))', '    print("no staged output")'),
    })
    expect(responses[0].statusCode).toBe(202)
    expect(run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('Out.set followed by an error response cannot flush or earn binding proof', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[2]
    const { run, responses } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
      ...step, content: step.content.replace('status_code=202', 'status_code=400'),
    })
    expect(responses[0].statusCode).toBe(400)
    expect(run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(messages(run)).toEqual([])
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('binding flush requires the actual configured namespace rather than a literal queue name', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[2]
    let run = createBehavioralRun(lab, { attemptId: 'wrong-namespace' })
    for (const step of lab.tasks[0].solution.steps.slice(0, 2)) run = act(lab, run, step).run
    run = command(lab, run, 'az functionapp config appsettings set -g rg-messaging -n func-orders --settings ServiceBusConnection__fullyQualifiedNamespace=wrong.servicebus.windows.net').run
    const failed = command(lab, run, post(cloud, lab.messagingInput.httpFunctions.functionKeys[0].value))
    expect(failed.diagnostics).toEqual([])
    expect(failed.httpResponse.statusCode).toBe(503)
    expect(failed.run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(messages(failed.run)).toEqual([])
    expect(evaluateLab(lab, failed.run).isComplete).toBe(false)
  })

  it('an SDK replacement is a real send but does not prove output binding', async () => {
    const { HTTP_HOSTING_LABS } = await load(), lab = HTTP_HOSTING_LABS[2]
    const { HTTP_KEYS_SOURCE } = await import('../src/data/templates/http-functions-python/hosting.js')
    const { run, responses } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
      ...step, content: HTTP_KEYS_SOURCE,
    })
    expect(responses[0].statusCode).toBe(202)
    expect(run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(messages(run)[0].status).toBe('completed')
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('JSON text with a non-JSON mimetype cannot earn publish or binding proof', async () => {
    const { HTTP_HOSTING_LABS } = await load()
    for (const lab of [HTTP_HOSTING_LABS[0], HTTP_HOSTING_LABS[2]]) {
      const { run, responses } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
        ...step, content: step.content.replaceAll('mimetype="application/json"', 'mimetype="text/plain"'),
      })
      expect(responses[0].statusCode).toBe(lab.journeyOrder === 6 ? 200 : 202)
      expect(evaluateLab(lab, run).isComplete).toBe(false)
    }
  })

  it('accepts equivalent authored source and JSON charset without Solution text matching', async () => {
    const { HTTP_HOSTING_LABS } = await load()
    for (const lab of HTTP_HOSTING_LABS) {
      const { run } = replay(lab, step => step.kind !== 'file' || step.path !== 'function_app.py' ? step : {
        ...step, content: '# My implementation\n' + step.content.replaceAll('mimetype="application/json"', 'mimetype="application/json; charset=utf-8"'),
      })
      expect(evaluateLab(lab, run).isComplete).toBe(true)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { parsePythonProject } from '../src/lib/project/python.js'
import { RELEASE_MANIFEST, RELEASE_SOLUTION_FILES } from '../src/data/templates/aks-python/releases.js'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { simulateIntegration } from '../src/lib/kubernetes/integration.js'
import * as aks from './helpers/aks.js'

const setup = `import json
import logging
from training_diagnostics import current_request_id
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("assistant.application")

def log_event(event, status=None):
    logger.info(json.dumps({"event": event, "request_id": current_request_id(), "status": status}))

`
const wrapper = `
def answer(question):
    log_event("request.started")
    response = answer_core(question)
    log_event("request.completed", response["status"])
    return response
`
const source = setup + RELEASE_SOLUTION_FILES['app.py'].replace('def answer(question):', 'def answer_core(question):') + wrapper
const files = text => ({ ...RELEASE_SOLUTION_FILES, 'app.py': text })
// This contract fixture deliberately does not depend on the new template.
const manifest = { ...RELEASE_MANIFEST, diagnosticsVersion: 1 }
const compile = text => parsePythonProject(files(text), manifest)
const invoke = (text = source, { question = 'How long are backups kept?', profile = 'healthy', environment = {}, requestId = 'request-test-1' } = {}) => {
  const parsed = compile(text)
  expect(parsed.diagnostics).toEqual([])
  const snapshot = aks.makeTrainingSnapshot()
  snapshot.environment = { ...snapshot.environment, AUDIENCE: 'employee', ...environment }
  return simulateIntegration(parsed.appSpec, snapshot, { method: 'POST', path: '/api/ask', body: { question }, requestId }, INTEGRATION_FIXTURES, profile)
}
const records = (status, requestId = 'request-test-1') => [
  { event: 'request.started', request_id: requestId, status: null },
  { event: 'request.completed', request_id: requestId, status },
]

describe('finite Python logging projection', () => {
  it('compiles helper logs around the original core and projects actual status', () => {
    const result = invoke()
    expect(compile(source).appSpec.diagnostics).toMatchObject({ version: 1, statements: expect.any(Array) })
    expect(result.appLogRecords).toEqual(records(200))
    expect(result.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    expect(result.body).toMatchObject({ release: '2.0', sources: ['training-backups'] })
  })

  it('accepts direct dictionaries, alternate locals, quotes and whitespace', () => {
    const direct = source.replace(wrapper, `
def answer(question):
    audit.info(json.dumps({'request_id': current_request_id ( ), 'event': 'request.started', 'status': None}))
    outcome = answer_core ( question )
    audit.info(json.dumps({'status': outcome [ 'status' ], 'event': 'request.completed', 'request_id': current_request_id()}))
    return outcome
`).replace('logger = logging.getLogger', 'audit = logging.getLogger').replace('logger.info', 'audit.info')
    expect(invoke(direct).appLogRecords).toEqual(records(200))
    expect(invoke(source.replaceAll('log_event', 'write_event').replaceAll('response', 'outcome').replaceAll('logger', 'audit')).appLogRecords).toEqual(records(200))
  })

  it('faithfully preserves wrong literal IDs and statuses', () => {
    const result = invoke(source.replace('current_request_id()', '"wrong-request"').replace('response["status"]', '201'))
    expect(result.status).toBe(200)
    expect(result.appLogRecords).toEqual([
      { event: 'request.started', request_id: 'wrong-request', status: null },
      { event: 'request.completed', request_id: 'wrong-request', status: 201 },
    ])
  })

  it.each([
    ['absent', wrapper.replace('    log_event("request.started")\n', '').replace('    log_event("request.completed", response["status"])\n', ''), []],
    ['reversed', wrapper.replace('log_event("request.started")', 'log_event("request.completed")').replace('log_event("request.completed", response["status"])', 'log_event("request.started", response["status"])'), [{ event: 'request.completed', request_id: 'request-test-1', status: null }, { event: 'request.started', request_id: 'request-test-1', status: 200 }]],
    ['unreachable completion', wrapper.replace('    log_event("request.completed", response["status"])\n    return response', '    return response\n    log_event("request.completed", response["status"])'), [records(200)[0]]],
    ['started after the core', wrapper.replace('    log_event("request.started")\n    response = answer_core(question)', '    response = answer_core(question)\n    log_event("request.started")'), records(200)],
  ])('does not synthesize or reorder %s learner calls', (_label, edited, expected) => {
    expect(invoke(source.replace(wrapper, edited)).appLogRecords).toEqual(expected)
    const statements = compile(source.replace(wrapper, edited)).appSpec.diagnostics.statements
    if (_label === 'started after the core') expect(statements[0]).toMatchObject({ op: 'core' })
  })

  it.each([
    ['healthy', {}, 'How long are backups kept?', 200, ['embedding', 'postgres-query', 'answer']],
    ['healthy', {}, '   ', 400, []],
    ['healthy', {}, 'unknown fixture', 422, ['embedding']],
    ['healthy', { EMBEDDING_DEPLOYMENT: 'missing' }, 'How long are backups kept?', 502, ['embedding']],
    ['healthy', { PGHOST: 'missing' }, 'How long are backups kept?', 503, ['embedding', 'postgres-query']],
    ['answer-unavailable-always', {}, 'How long are backups kept?', 503, ['embedding', 'postgres-query', 'answer']],
    ['embedding-timeout-always', {}, 'How long are backups kept?', 504, ['embedding']],
    ['healthy', {}, 'What is the travel allowance?', 200, ['embedding', 'postgres-query']],
  ])('uses the actual result for profile %s and stops subsequent stages', (profile, environment, question, status, stages) => {
    const result = invoke(source, { profile, environment, question })
    expect(result.status).toBe(status)
    expect(result.appLogRecords).toEqual(records(status))
    expect(result.dependencyTrace.map(item => item.operation)).toEqual(stages)
  })

  it('uses no request scope when the caller provides none', () => {
    expect(invoke(source, { requestId: null }).appLogRecords).toEqual(records(200, null))
  })

  it('supports a locally bound helper dictionary and omits undeclared JSON fields', () => {
    const edited = source.replace('    logger.info(json.dumps({"event": event, "request_id": current_request_id(), "status": status}))', '    record = {"event": event, "request_id": current_request_id()}\n    logger.info(json.dumps(record))')
    expect(invoke(edited).appLogRecords).toEqual([
      { event: 'request.started', request_id: 'request-test-1' },
      { event: 'request.completed', request_id: 'request-test-1' },
    ])
  })

  it('supports an explicit request-id helper argument with a required status parameter', () => {
    const edited = source.replace('log_event(event, status=None)', 'log_event(event, request_id, status)')
      .replace('"request_id": current_request_id()', '"request_id": request_id')
      .replace('log_event("request.started")', 'log_event("request.started", current_request_id(), None)')
      .replace('log_event("request.completed", response["status"])', 'log_event("request.completed", current_request_id(), response["status"])')
    expect(invoke(edited).appLogRecords).toEqual(records(200))
  })

  it('supports finite local fields and dictionaries in direct wrapper logs', () => {
    const edited = source.replace(wrapper, `
def answer(question):
    correlation = current_request_id()
    entry = {"event": "request.started", "request_id": correlation, "status": None}
    logger.info(json.dumps(entry))
    outcome = answer_core(question)
    status_code = outcome["status"]
    logger.info(json.dumps({"event": "request.completed", "request_id": correlation, "status": status_code}))
    return outcome
`)
    expect(invoke(edited).appLogRecords).toEqual(records(200))
  })

  it('projects no info messages without INFO configuration or after a direct core return', () => {
    expect(invoke(source.replace('logging.basicConfig(level=logging.INFO, format="%(message)s")\n', '')).appLogRecords).toEqual([])
    expect(invoke(source.replace(wrapper, '\ndef answer(question):\n    return answer_core(question)\n    log_event("request.completed")\n')).appLogRecords).toEqual([])
  })

  it('retains literal provenance even when wrong constants happen to equal this request', () => {
    const parsed = compile(source.replace('current_request_id()', '"request-test-1"').replace('response["status"]', '200'))
    expect(parsed.diagnostics).toEqual([])
    const log = parsed.appSpec.diagnostics.statements.find(statement => statement.op === 'log')
    expect(log.fields.request_id).toEqual({ kind: 'literal', value: 'request-test-1' })
    expect(parsed.appSpec.diagnostics.statements.filter(statement => statement.op === 'log').at(-1).fields.status).toEqual({ kind: 'literal', value: 200 })
  })

  it('accepts ordinary import whitespace', () => {
    expect(invoke(source.replace('import logging', 'import   logging').replace('from training_diagnostics import current_request_id', 'from   training_diagnostics   import   current_request_id')).appLogRecords).toEqual(records(200))
  })

  it('accepts equivalent basicConfig keyword order and helper parameter names', () => {
    const edited = source.replace('level=logging.INFO, format="%(message)s"', "format = '%(message)s', level = logging.INFO")
      .replace('log_event(event, status=None)', 'log_event(name, code=None)').replace('"event": event', '"event": name').replace('"status": status', '"status": code')
    expect(invoke(edited).appLogRecords).toEqual(records(200))
  })

  it('keeps disabled authored calls in the captured statements for diagnosis', () => {
    const parsed = compile(source.replace('logging.basicConfig(level=logging.INFO, format="%(message)s")\n', ''))
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.diagnostics.statements.filter(statement => statement.op === 'log')).toMatchObject([{ enabled: false }, { enabled: false }])
  })

  it.each([
    text => text.replace('logger = logging.getLogger', 'json = logging.getLogger'),
    text => text.replace('log_event(event, status=None)', 'log_event(logger, status=None)').replace('"event": event', '"event": logger'),
    text => text.replace('    logger.info(json.dumps', '    logger = {"event": "wrong", "request_id": None}\n    logger.info(json.dumps'),
  ])('rejects shadowing imports and loggers in helper bindings', edit => {
    const parsed = compile(edit(source))
    expect(parsed.appSpec).toBeNull()
    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' }))
  })

  it.each(['logger', 'log_event', 'current_request_id', 'json', 'logging'])('rejects rebinding %s instead of inventing events', name => {
    expect(compile(source + `\n${name} = 0\n`)).toMatchObject({ appSpec: null, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' })]) })
  })

  it('rejects rebinding the logger inside the wrapper', () => {
    expect(compile(source.replace('    response = answer_core(question)', '    logger = answer_core(question)\n    response = logger'))).toMatchObject({ appSpec: null, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' })]) })
  })

  it('rejects unknown module effects in the logging project', () => {
    expect(compile(source + '\nimport subprocess\n')).toMatchObject({ appSpec: null, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' })]) })
  })

  it('enforces the syntax-node cap before lowering the core', () => {
    expect(parsePythonProject(files(source), { ...manifest, maxTokens: 5 })).toMatchObject({ appSpec: null, diagnostics: [expect.objectContaining({ code: 'TOKEN_LIMIT' })] })
  })

  it.each([
    text => text.replace('json.dumps({"event": event, "request_id": current_request_id(), "status": status})', 'json.dumps(os.environ)'),
    text => text.replace('logger.info', 'logger.warning'),
    text => text.replace('log_event("request.started")', 'log_event(question)'),
    text => text.replace('response["status"]', 'response["body"]'),
    text => text.replace('log_event("request.started")', `log_event("${'x'.repeat(65)}")`),
    text => text.replace('logging.basicConfig(level=logging.INFO, format="%(message)s")', 'logging.basicConfig(filename="secrets.log")'),
  ])('rejects unsupported logging expressions with a located trainer diagnostic', edit => {
    expect(compile(edit(source))).toMatchObject({ appSpec: null, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py', line: expect.any(Number), column: expect.any(Number) })]) })
  })

  it('leaves earlier release AppSpec and simulator results unchanged', () => {
    const app = parsePythonProject(RELEASE_SOLUTION_FILES, RELEASE_MANIFEST)
    expect(app.diagnostics).toEqual([])
    expect(app.appSpec).not.toHaveProperty('diagnostics')
    const snapshot = aks.makeTrainingSnapshot()
    snapshot.environment.AUDIENCE = 'employee'
    expect(simulateIntegration(app.appSpec, snapshot, { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, INTEGRATION_FIXTURES)).not.toHaveProperty('appLogRecords')
  })

  it('provides five complete integration inputs and parses request-id edits in the diagnosis helper', () => {
    expect(aks.diagnosisIntegrationCase).toBeTypeOf('function')
    const inputs = aks.diagnosisIntegrationCase({ requestIdExpression: '"learner-literal"' })
    expect(inputs).toHaveLength(5)
    expect(inputs[2].requestId).toBe('request-test-1')
    expect(simulateIntegration(...inputs).appLogRecords.map(record => record.request_id)).toEqual(['learner-literal', 'learner-literal'])
  })
})

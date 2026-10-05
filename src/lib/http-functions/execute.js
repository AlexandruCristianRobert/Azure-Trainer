import { HTTP_LIMITS, HTTP_PROFILE, closedHttpObject, normalizeHttpAppId, normalizeHttpTarget, normalizeOrder, sameCanonicalOrder, parseHttpRequest, matchHttpRoute, jsonBytes, httpError, classifyHttpOrderInput } from './contracts.js'
import { emptyHttpFunctionsState, validateHttpFunctionsState, validateHttpResponse } from './state.js'
import { recordAcceptedOrder, classifySubmission } from './orders.js'
import { httpMeasurements, httpPublicSafe, httpResourceStamp, validHttpJournal, httpEvidenceIsCurrent } from './evidence.js'
import { parseMessagingProject } from '../messaging/python.js'
import { executeMessagingProgram } from '../messaging/vm.js'
import { messagingMeasurements } from '../messaging/evidence.js'
import { applyServiceBusOperation } from '../messaging/servicebus.js'
import { HTTP_RUNTIME_FILES } from '../../data/templates/http-functions-python/runtime.js'
import { getFunctionApp, getStorageAccount } from '../sandbox/functions.js'
import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { recordVerification } from '../labEngine/evidence.js'

const entry = 'function_app.py', mode = 'http-handler'
const clone = value => structuredClone(value)
const response = (statusCode, body, headers = {}) => ({ statusCode, body, headers })
const withState = (run, messaging) => ({ ...run, runtime: { ...run.runtime, messaging } })
const reject = (run, code = 'HTTP_CONFIG', message = 'The modeled HTTP command is invalid.') => {
  const diagnostic = { code, message, path: entry, line: 1, column: 1 }
  return { run, diagnostics: [diagnostic], lines: [`${code}: ${message}`], portalEvents: [], httpResponse: null }
}
function context(run, lab) {
  const config = lab.messagingInput?.httpFunctions
  if (lab.capabilities?.httpFunctions !== true || !closedHttpObject(config, ['appId', 'target', 'functionKeys'])
    || !Array.isArray(config.functionKeys) || config.functionKeys.length > 4 || config.functionKeys.some(key => !closedHttpObject(key, ['id', 'value'])
      || typeof key.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key.id) || typeof key.value !== 'string' || key.value.length < 1 || key.value.length > 256)
    || new Set(config.functionKeys.map(key => key.id)).size !== config.functionKeys.length) httpError('Select a valid private HTTP Lab configuration.')
  const appId = normalizeHttpAppId(config.appId), target = normalizeHttpTarget(config.target), parts = appId.split('/')
  if (parts[2] !== SUBSCRIPTION_ID.toLowerCase()) httpError('Select the supplied subscription.')
  const app = getFunctionApp(run.sandbox, parts[4], parts.at(-1))
  if (app.runtime !== 'python' || app.runtimeVersion !== '3.12' || app.functionsVersion !== '4' || app.os !== 'Linux' || app.hostingPlan !== 'FlexConsumption') httpError('Use the supported Python 3.12 Functions 4 app.')
  getStorageAccount(run.sandbox, app.storageResourceGroup, app.storageAccount)
  return { appId, target, app, config, secrets: config.functionKeys.map(key => key.value) }
}
function settings(files, scope, app) {
  let host, local
  try { host = JSON.parse(files['host.json']); local = JSON.parse(files['local.settings.json']) } catch { httpError('Host and local settings require valid JSON.') }
  if (!closedHttpObject(host, ['version']) || host.version !== '2.0') httpError('Use supported host.json version 2.0 without extra host options.')
  if (!closedHttpObject(local, ['IsEncrypted', 'Values']) || local.IsEncrypted !== false || !closedHttpObject(local.Values, [], Object.keys(local.Values ?? {}))
    || Object.keys(local.Values).length > HTTP_LIMITS.entries || Object.values(local.Values).some(value => typeof value !== 'string')
    || local.Values.FUNCTIONS_WORKER_RUNTIME !== 'python' || local.Values.AzureWebJobsStorage !== 'UseDevelopmentStorage=true') httpError('Use the Python worker and simulated local storage settings.')
  if (scope === 'local') return clone(local.Values)
  if (!closedHttpObject(app.appSettings, [], Object.keys(app.appSettings ?? {})) || Object.keys(app.appSettings).length > HTTP_LIMITS.entries
    || Object.values(app.appSettings).some(value => typeof value !== 'string')
    || Object.entries(app.appSettings).some(([key]) => /^(?:AzureWebJobs|FUNCTIONS_|WEBSITE_|SCM_)/i.test(key))) httpError('Unsupported published application settings.')
  return clone(app.appSettings)
}
function parse(files) { return parseMessagingProject(files, { entry, mode, profile: HTTP_PROFILE, fixedFiles: HTTP_RUNTIME_FILES }) }
function capacity(run, kind) {
  const state = run.runtime.messaging, extension = state.httpFunctions ?? emptyHttpFunctionsState()
  if ((state.executionReceipts?.length ?? 0) >= 50 || state.nextId >= Number.MAX_SAFE_INTEGER - 1000
    || extension.nextId >= Number.MAX_SAFE_INTEGER - 100 || kind === 'request' && (extension.requests.length >= HTTP_LIMITS.requests
      || jsonBytes(extension) + 64 * 1024 > HTTP_LIMITS.stateBytes)
    || kind === 'capture' && extension.localHosts.length + extension.deployments.length >= HTTP_LIMITS.captures) httpError('HTTP command capacity reached. Reset for a fresh attempt.', 'HTTP_LIMIT')
  return extension
}
function journal(run, next, lab, { trace = [], diagnostics = [], sourcePaths, value = null, invocation = null }) {
  const state = next.runtime.messaging, executionId = `execution-${state.nextId}`
  const measurements = messagingMeasurements(run.runtime.messaging, state, { trace, value, sourcePaths }, entry, mode, diagnostics)
  measurements.httpFunctions = httpMeasurements(run.runtime.messaging.httpFunctions, state.httpFunctions)
  if (invocation) measurements.httpFunctions.invocations.push({ ...invocation, executionId })
  next = withState(next, { ...state, nextId: state.nextId + 1, executionReceipts: [...state.executionReceipts,
    { id: executionId, entry, mode, measurements: clone(measurements) }] })
  if (!validHttpJournal(next.runtime.messaging, lab.messagingInput.httpFunctions, next.sandbox)) httpError('HTTP command provenance is inconsistent.')
  if (invocation) for (const declaration of lab.messagingExercise?.tasks ?? []) {
    if (declaration.entry !== entry || declaration.mode !== mode) continue
    const task = lab.tasks.find(row => row.id === declaration.taskId), m = { ...clone(measurements), executionId }
    let passed = false
    try { passed = diagnostics.length === 0 && sourcePaths.every(path => Object.hasOwn(task.dependencies ?? {}, `messaging:file:${path}`))
      && httpEvidenceIsCurrent({ measurements: m }, next, lab) && declaration.check(clone(m)) === true } catch { /* no behavior credit */ }
    next = recordVerification(next, lab, task.id, { scenarioId: declaration.scenarioId, scenarioVersion: declaration.scenarioVersion,
      outcome: passed ? 'passed' : 'failed', completed: true, startedAtMs: run.runtime.simTimeMs, endedAtMs: next.runtime.simTimeMs, measurements: m })
  }
  return next
}
export function captureHttpFunctions(run, lab, scope) {
  try {
    if (!['local', 'published'].includes(scope)) httpError('Unsupported capture scope.')
    const ctx = context(run, lab), extension = capacity(run, 'capture')
    settings(run.project.savedFiles, scope, ctx.app)
    const parsed = parse(run.project.savedFiles)
    if (parsed.diagnostics.length) return reject(run, parsed.diagnostics[0].code, 'Saved HTTP source cannot be registered.')
    if (!parsed.program.httpHandlers.length) httpError('Register at least one HTTP handler.')
    const paths = [...new Set([...parsed.program.sourcePaths, ...Object.keys(HTTP_RUNTIME_FILES), 'host.json', 'local.settings.json'])].sort()
    const sources = Object.fromEntries(paths.map(path => [path, run.project.savedFiles[path]]))
    if (!Object.values(sources).every(text => typeof text === 'string' && httpPublicSafe(text, ctx.secrets))) httpError('Captured source contains protected values.', 'HTTP_PRIVACY')
    const captures = [...extension.localHosts, ...extension.deployments]
    const capture = { id: `http-capture-${extension.nextId}`, appId: ctx.appId, scope,
      generation: 1 + Math.max(0, ...captures.filter(row => row.appId === ctx.appId && row.scope === scope).map(row => row.generation)),
      status: 'captured', createdAtMs: run.runtime.messaging.timeMs, entry, sources,
      sourceVersions: Object.fromEntries(paths.map(path => [path, run.project.fileVersions[path] ?? 0])),
      routes: parsed.program.httpHandlers.map(({ route, methods, authLevel, functionId, functionName, path }) => ({ route, methods, authLevel, functionId, functionName, path })) }
    const history = scope === 'local' ? 'localHosts' : 'deployments', selection = scope === 'local' ? 'currentLocal' : 'currentPublished'
    const httpFunctions = { ...extension, nextId: extension.nextId + 1, [history]: [...extension[history], capture], [selection]: { ...extension[selection], [ctx.appId]: capture.id } }
    if (!validateHttpFunctionsState(httpFunctions)) httpError('Captured source exceeds the supported snapshot bounds.', 'HTTP_LIMIT')
    const next = journal(run, withState(run, { ...run.runtime.messaging, httpFunctions }), lab, { sourcePaths: paths })
    return { run: next, lines: [`HTTP ${scope} capture registered (${capture.routes.length} routes).`], diagnostics: [], portalEvents: [], httpResponse: null }
  } catch (error) { return reject(run, error.httpCode ?? 'HTTP_CONFIG', error.httpCode ? error.message : 'The modeled HTTP command is invalid.') }
}
export function runHttpFunctionsRequest(run, lab, intent) {
  try {
    const ctx = context(run, lab), extension = capacity(run, 'request'), request = parseHttpRequest(intent, { appId: ctx.appId })
    if (Object.keys(request.query).some(key => key.toLowerCase() === 'code') || Object.hasOwn(request.headers, 'authorization')) httpError('Use only a function-key header for the modeled cloud key route.', 'HTTP_UNSUPPORTED')
    if (!httpPublicSafe(request.path, ctx.secrets)) httpError('Protected request path.', 'HTTP_PRIVACY')
    const selection = request.scope === 'local' ? extension.currentLocal : extension.currentPublished
    const capture = [...extension.localHosts, ...extension.deployments].find(row => row.id === selection[ctx.appId])
    if (!capture) httpError('Capture this HTTP endpoint before invoking it.')
    const env = settings(capture.sources, request.scope, ctx.app), parsed = parse(capture.sources)
    if (parsed.diagnostics.length) httpError('Captured source is invalid.')
    const match = matchHttpRoute(capture.routes, request.method, request.path)
    const route = match.route ? parsed.program.httpHandlers.find(row => row.functionId === match.route.functionId) : null
    const key = request.scope === 'published' && route?.authLevel === 'function' ? ctx.config.functionKeys.find(key => key.value === request.headers['x-functions-key']) : null
    const authorization = request.scope === 'published' && route?.authLevel === 'function' ? key ? 'granted' : 'denied' : 'not-required'
    let state = run.runtime.messaging, trace = [], diagnostics = [], http = { reads: [], operations: [], consumedReadIds: [], consumedFields: [], stagedOutput: null }
    let actualResponse = !route ? response(match.status, match.status === 404 ? 'Not found.' : 'Method not allowed.', match.status === 405 ? { allow: match.allow.join(', ') } : {})
      : authorization === 'denied' ? response(401, 'Function key required.') : null
    let requestOrder = null
    let inputClass = classifyHttpOrderInput(request.method, request.body)
    if (inputClass === 'valid') {
      requestOrder = normalizeOrder(JSON.parse(request.body))
      if (!httpPublicSafe(requestOrder, ctx.secrets)) { requestOrder = null; inputClass = 'protected' }
    }
    if (!actualResponse) {
      const executed = executeMessagingProgram({ program: parsed.program, state, sandbox: run.sandbox, input: lab.messagingInput ?? {},
        httpInvocation: { request, route, params: match.params, appId: ctx.appId, target: ctx.target, generation: capture.generation, settings: env, protectedValues: ctx.secrets } })
      state = executed.state; trace = executed.trace; diagnostics = executed.diagnostics
      http = executed.http; actualResponse = http.response ?? response(503, 'The HTTP handler could not complete.')
      if (!validateHttpResponse(actualResponse) || !httpPublicSafe(actualResponse, ctx.secrets)) {
        actualResponse = response(503, 'The HTTP handler returned an invalid public response.')
        http.stagedOutput = null; http.consumedReadIds = []; http.consumedFields = []
        diagnostics = [...diagnostics, { code: 'HTTP_RESPONSE', message: 'The response exceeds the supported public response contract.', path: entry, line: 1, column: 1 }]
      }
      if (http.stagedOutput && actualResponse.statusCode < 400) {
        try {
          const output = http.stagedOutput, endpoint = env[`${output.connection}__fullyQualifiedNamespace`]
          if (endpoint?.toLowerCase() !== `${ctx.target.namespace}.servicebus.windows.net` || output.queueName.toLowerCase() !== ctx.target.queue) httpError('Output binding must resolve the actual order queue.')
          const order = normalizeOrder(JSON.parse(output.value))
          if (!requestOrder || !sameCanonicalOrder(order, requestOrder) || classifySubmission(state, ctx, order).kind !== 'new') httpError('Output requires a new matching request order.')
          const sent = applyServiceBusOperation(state, run.sandbox, { kind: 'send', target: ctx.target, message: { body: output.value, messageId: order.id, properties: {} } })
          const send = sent.trace.find(row => row.kind === 'send')
          if (!send || !sent.trace.some(row => row.kind === 'enqueue')) httpError('Output did not enqueue an order.')
          const httpFunctions = recordAcceptedOrder(sent.state.httpFunctions ?? extension, { appId: ctx.appId, target: ctx.target, order, generation: capture.generation, sendReceiptId: send.id }, sent.state)
          state = { ...sent.state, httpFunctions }; trace.push(...sent.trace)
          http.operations.push({ id: `http-operation-${http.operations.length + 1}`, kind: 'binding-send', target: ctx.target, sendReceiptId: send.id, acceptedId: httpFunctions.accepted.at(-1).id })
        } catch { actualResponse = response(503, 'The output binding could not enqueue the order.'); http.consumedReadIds = []; http.consumedFields = [] }
      }
    }
    const current = state.httpFunctions ?? extension, executionId = `execution-${state.nextId}`, requestId = `http-request-${current.nextId}`
    const record = { id: requestId, appId: ctx.appId, scope: request.scope, generation: capture.generation, method: request.method, path: request.path, authorization, inputClass,
      operationIds: http.operations.map(row => row.id), readIds: http.consumedReadIds, response: actualResponse,
      sendReceiptIds: http.operations.map(row => row.sendReceiptId), workerReceiptIds: [...new Set(http.reads.filter(row => row.kind === 'repository' && row.found).map(row => row.record.origin.workerReceiptId).filter(Boolean))],
      executionId, beforeNextId: run.runtime.messaging.nextId, afterNextId: state.nextId + 1 }
    const httpFunctions = { ...current, nextId: current.nextId + 1, requests: [...current.requests, record] }
    if (!validateHttpFunctionsState(httpFunctions)) httpError('Request snapshot exceeds supported bounds.', 'HTTP_LIMIT')
    const invocation = { requestId, captureId: capture.id, functionId: route?.functionId ?? null, keyId: key?.id ?? null, requestOrder, inputClass,
      resourceStamp: httpResourceStamp(run, lab), resourceGeneration: run.dependencyGenerations['http:resources'] ?? 0,
      reads: http.reads, operations: http.operations, consumedReadIds: http.consumedReadIds, consumedFields: http.consumedFields, response: actualResponse }
    const next = journal(run, withState(run, { ...state, httpFunctions }), lab,
      { trace, diagnostics, sourcePaths: Object.keys(capture.sources), value: actualResponse, invocation })
    return { run: next, httpResponse: actualResponse, lines: [`HTTP ${actualResponse.statusCode}`, ...Object.entries(actualResponse.headers).map(([key, value]) => `${key}: ${value}`), actualResponse.body], diagnostics, portalEvents: [] }
  } catch (error) { return reject(run, error.httpCode ?? 'HTTP_CONFIG', error.httpCode ? error.message : 'The modeled HTTP command is invalid.') }
}
export function applyHttpEffect(run, intent, lab) {
  if (closedHttpObject(intent, ['kind', 'request']) && intent.kind === 'request') return runHttpFunctionsRequest(run, lab, intent.request)
  if (closedHttpObject(intent, ['kind', 'scope'], ['name']) && intent.kind === 'capture'
    && (intent.scope === 'local' ? intent.name === undefined : typeof intent.name === 'string' && intent.name.toLowerCase() === lab.messagingInput?.httpFunctions?.appId.split('/').at(-1).toLowerCase())) return captureHttpFunctions(run, lab, intent.scope)
  return reject(run, 'HTTP_CONFIG', 'HTTP effects accept a supported command intent only.')
}

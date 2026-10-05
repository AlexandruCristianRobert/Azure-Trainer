import { HTTP_LIMITS, normalizeHttpAppId, normalizeHttpTarget, normalizeHttpHeaders, normalizeOrder, sameCanonicalOrder, jsonBytes } from './contracts.js'
import { readOrderStatus, classifySubmission, recordAcceptedOrder } from './orders.js'
import { emptyHttpFunctionsState } from './state.js'
import { createHttpValues } from './values.js'
import { sensitiveTelemetryName } from '../observability/privacy.js'

export function createHttpSession(context) {
  const { handle, info, fail, jsonValue, getState, setState, invocation, program } = context
  const privateValues = [...(context.protectedValues ?? []), ...(invocation?.protectedValues ?? []), ...Object.entries(invocation?.request.headers ?? {}).filter(([key]) => ['x-functions-key', 'authorization'].includes(key)).map(([, value]) => value)]
  const values = createHttpValues({ handle, info, fail, protectedValues: privateValues })
  const reads = [], operations = []
  let response = null, consumed = [], staged = null
  const handled = value => ({ handled: true, value })
  const bound = loc => { if (!invocation) fail('HTTP invocation context is required.', loc, 'HTTP_CONFIG') }
  const read = (fields, loc) => {
    if (reads.length >= 50 || jsonBytes(reads) + jsonBytes(fields) > 64 * 1024) fail('HTTP read limit reached.', loc, 'HTTP_LIMIT')
    values.guard(fields, loc)
    const row = { id: `http-read-${reads.length + 1}`, atNextId: getState().nextId, ...fields }; reads.push(row); return row
  }
  function call(name, owner, args, loc) {
    if (name === 'OrderStatusRepository') return handled(handle('orderrepository'))
    if (name === 'FunctionApp') return handled(handle('functionapp'))
    if (name === 'HttpResponse') {
      values.guard(args.body, loc); values.guard(args.headers ?? {}, loc)
      const body = values.unbox(args.body), statusCode = values.unbox(args.status_code ?? 200)
      if (typeof body !== 'string' || !Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599) fail('HttpResponse requires text and a valid HTTP status.', loc, 'HTTP_CONFIG')
      if (jsonBytes(body) > HTTP_LIMITS.responseBytes) fail('HTTP response body limit reached.', loc, 'HTTP_LIMIT')
      let headers
      try { headers = normalizeHttpHeaders(jsonValue(args.headers ?? {}, loc)) } catch (error) { if (error.diagnostic) throw error; fail('Invalid HTTP response headers.', loc, error.httpCode) }
      if (args.mimetype !== undefined) { const mime = values.unbox(args.mimetype); values.guard(mime, loc); if (typeof mime !== 'string' || !mime || /[\r\n]/.test(mime)) fail('Invalid response MIME type.', loc, 'HTTP_CONFIG'); headers['content-type'] = mime }
      return handled(handle('httpresponse', { response: { statusCode, headers, body }, links: [...values.collect(args.body), ...values.collect(args.headers ?? {})] }))
    }
    if (name === 'httprequest.get_json') {
      let value
      try { value = JSON.parse(invocation.request.body) } catch { fail('Invalid JSON request.', loc, 'MESSAGING_RUNTIME', { errorType: 'ValueError' }) }
      return handled(jsonValue(value, loc))
    }
    if (name === 'httprequest.get_body') return handled(handle('bytes', { value: invocation.request.body }))
    if (name === 'orderrepository.get') {
      bound(loc)
      const orderId = values.unbox(args.order_id); values.guard(orderId, loc)
      if (typeof orderId !== 'string') fail('Repository id must be text.', loc, 'HTTP_CONFIG')
      const record = readOrderStatus(getState(), { appId: invocation.appId, target: invocation.target, orderId })
      const row = read({ kind: 'repository', orderId, found: record !== null, record }, loc)
      return handled(record ? handle('orderrecord', { record, readId: row.id }) : null)
    }
    if (name === 'os.getenv') {
      bound(loc)
      const key = values.unbox(args.key); values.guard(key, loc)
      if (typeof key !== 'string' || sensitiveTelemetryName(key)) fail('Protected environment setting cannot be exposed.', loc, 'HTTP_PRIVACY')
      const value = Object.hasOwn(invocation.settings, key) ? invocation.settings[key] : args.default ?? null
      values.guard(value, loc)
      if (value !== null && typeof value !== 'string') fail('Environment settings must be text.', loc, 'HTTP_CONFIG')
      const row = read({ kind: 'environment', name: key, value }, loc)
      return handled(values.scalar(value, row.id, 'value'))
    }
    if (name === 'data.get') {
      const key = values.unbox(args.key)
      if (!owner || typeof owner !== 'object' || Array.isArray(owner) || info(owner) || typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('dict.get requires a dictionary and safe text key.', loc)
      return handled(Object.hasOwn(owner, key) ? owner[key] : args.default ?? null)
    }
    if (name === 'isinstance') {
      const value = values.unbox(args.object), type = info(args.classinfo)
      const name = type?.type === 'pytype' ? type.name : type?.type === 'callable' && type.name === 'str' ? 'str' : null
      if (!name) fail('isinstance supports str, int, bool, dict and list.', loc, 'MESSAGING_UNSUPPORTED')
      return handled(name === 'str' ? typeof value === 'string' : name === 'int' ? typeof value === 'boolean' || Number.isSafeInteger(value)
        : name === 'bool' ? typeof value === 'boolean' : name === 'list' ? Array.isArray(value) : !!value && typeof value === 'object' && !Array.isArray(value) && !info(value))
    }
    if (name === 'httpout.set') {
      bound(loc); values.guard(args.value, loc)
      const value = values.unbox(args.value)
      if (staged || typeof value !== 'string') fail('Output binding accepts one text value.', loc, 'HTTP_CONFIG')
      if (jsonBytes(value) > HTTP_LIMITS.bodyBytes) fail('Output value limit reached.', loc, 'HTTP_LIMIT')
      staged = { ...invocation.route.output, value }; return handled(null)
    }
    if (name === 'json.dumps') return handled(values.serialize(args.obj, jsonValue, loc))
    return { handled: false }
  }
  function member(owner, name, loc) {
    const token = info(owner)
    if (token?.type === 'httpauth' && ['ANONYMOUS', 'FUNCTION'].includes(name)) return handled(name.toLowerCase())
    if (token?.type === 'orderrecord' && ['id', 'region', 'quantity', 'status'].includes(name)) return handled(values.scalar(token.record[name], token.readId, name))
    if (token?.type === 'httprequest' && ['method', 'url', 'params', 'route_params', 'headers'].includes(name)) {
      const field = name === 'params' ? invocation.request.query : name === 'route_params' ? invocation.params : invocation.request[name]
      // Guarded opaque header tokens cannot be converted, compared, printed or serialized.
      if (name === 'headers') return handled(Object.freeze(Object.fromEntries(Object.entries(field).map(([key, value]) => [key, ['x-functions-key', 'authorization'].includes(key) ? handle('httpcredential') : value]))))
      return handled(typeof field === 'object' ? Object.freeze({ ...field }) : field)
    }
    if (!token && owner && typeof owner === 'object' && !Array.isArray(owner) && name === 'get') return handled(handle('callable', { name: 'data.get', owner }))
    return { handled: false }
  }
  function beforeBroker(operation, loc) {
    values.guard(operation.target ?? {}, loc)
    if (operation.message) values.guard(operation.message, loc)
    if (!invocation || operation.kind !== 'send') return null
    if (operations.length >= 50) fail('HTTP operation limit reached.', loc, 'HTTP_LIMIT')
    if (invocation.request.method !== 'POST') return null
    let requestOrder, sentOrder
    try { requestOrder = normalizeOrder(JSON.parse(invocation.request.body)); sentOrder = normalizeOrder(JSON.parse(operation.message.body)) } catch { return null }
    const target = normalizeHttpTarget(operation.target)
    if (JSON.stringify(target) !== JSON.stringify(normalizeHttpTarget(invocation.target)) || !sameCanonicalOrder(requestOrder, sentOrder)) return null
    if (classifySubmission(getState(), invocation, requestOrder).kind !== 'new') fail('An existing order cannot be submitted again.', loc, 'HTTP_CONFIG')
    const extension = getState().httpFunctions ?? emptyHttpFunctionsState()
    if (extension.accepted.length >= HTTP_LIMITS.accepted || jsonBytes(extension) + 2048 > HTTP_LIMITS.stateBytes) fail('HTTP acceptance capacity reached.', loc, 'HTTP_LIMIT')
    return { order: requestOrder, target }
  }
  function afterBroker(operation, result, pending, loc) {
    if (!invocation || operation.kind !== 'send') return
    const send = result.trace.find(row => row.kind === 'send')
    const row = { id: `http-operation-${operations.length + 1}`, kind: 'sdk-send', target: normalizeHttpTarget(operation.target), sendReceiptId: send.id, acceptedId: null }
    if (pending) {
      const state = getState(), extension = recordAcceptedOrder(state.httpFunctions ?? emptyHttpFunctionsState(), { appId: invocation.appId, target: pending.target, order: pending.order, generation: invocation.generation, sendReceiptId: send.id }, state)
      setState({ ...state, httpFunctions: extension })
      row.acceptedId = extension.accepted.find(record => record.sendReceiptId === send.id).id
    }
    values.guard(row, loc); operations.push(row)
  }
  function invoke(invokeFunction, loc) {
    bound(loc)
    if (normalizeHttpAppId(invocation.appId) !== invocation.request.appId || !program.httpHandlers.some(handler => JSON.stringify(handler) === JSON.stringify(invocation.route))) fail('Invocation must select an analyzed HTTP handler.', loc, 'HTTP_CONFIG')
    const args = [handle('httprequest'), ...(invocation.route.output ? [handle('httpout')] : [])]
    return invokeFunction(invocation.route.functionId, args, {}, loc)
  }
  function finish(value, loc) {
    const token = info(value)
    if (token?.type !== 'httpresponse') fail('HTTP handlers must return an actual HttpResponse.', loc, 'HTTP_CONFIG')
    response = token.response; values.guard(response, loc)
    consumed = token.links
    if (response.statusCode >= 400) staged = null
    return response
  }
  function measurements(failed = false) {
    return { response: failed ? null : response, reads, operations, consumedReadIds: failed ? [] : [...new Set(consumed.map(link => link.readId))],
      consumedFields: failed ? [] : consumed.filter((link, index, all) => all.findIndex(item => item.readId === link.readId && item.field === link.field) === index), stagedOutput: failed ? null : staged }
  }
  return { ...values, call, member, index: () => ({ handled: false }), beforeBroker, afterBroker, invoke, finish, measurements }
}

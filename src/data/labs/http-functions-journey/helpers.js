import { messagingTask, file, command, functionsReady, functionsResources, FUNCTION_APP_ID, ORDERS_TARGET, ORDERS_ID, exactOrder } from '../messaging-journey/helpers.js'
import { HTTP_RUNTIME_FILES } from '../../templates/http-functions-python/runtime.js'
import { httpEvidenceIsCurrent } from '../../../lib/http-functions/evidence.js'
export { file, command, FUNCTION_APP_ID, ORDERS_TARGET, ORDERS_ID, exactOrder }

export const HTTP_ORDER = Object.freeze({ id: 'o1', region: 'EU', quantity: 2 })
export const HTTP_INPUT = Object.freeze({ httpFunctions: { appId: FUNCTION_APP_ID, target: ORDERS_TARGET,
  functionKeys: [{ id: 'default', value: 'demo-http-orders-key' }] } })
export const HTTP_METADATA = Object.freeze({ engineVersion: 2, contentVersion: 1,
  journeyId: 'http-functions-orders', skillAreaId: 'connect', service: 'functions',
  status: 'available', labMode: 'guided', manifestId: 'http-functions-python-v1',
  capabilities: { messaging: true, httpFunctions: true } })
export const HTTP_PATHS = Object.freeze(['function_app.py', 'clients.py', ...Object.keys(HTTP_RUNTIME_FILES), 'host.json', 'local.settings.json'])
export const HTTP_RESOURCES = Object.freeze([...functionsResources])
const HTTP_CONTEXT = { ...HTTP_METADATA, messagingInput: HTTP_INPUT }
export const httpRequest = measurement => measurement.httpFunctions?.requests[0]
export const httpInvocation = measurement => measurement.httpFunctions?.invocations[0]
export const httpBody = measurement => {
  try { return JSON.parse(httpRequest(measurement)?.response.body) } catch { return null }
}
export const httpNoSend = measurement => httpInvocation(measurement)?.operations.length === 0
  && measurement.trace.filter(row => row.kind === 'enqueue').length === 0
  && httpRequest(measurement)?.sendReceiptIds.length === 0
export function httpStatusRead(measurement, status, id = 'o1') {
  const request = httpRequest(measurement), invocation = httpInvocation(measurement)
  if (request?.method !== 'GET' || request.path !== `/api/orders/${id}` || !invocation?.functionId || !httpNoSend(measurement)) return false
  const read = invocation.reads.find(row => row.kind === 'repository' && row.orderId === id)
  if (status === null) return read?.found === false && read.record === null && request.response.statusCode === 404
  return request.response.statusCode === 200 && read?.found === true && read.record.status === status
    && exactOrder(httpBody(measurement), { id, status })
    && ['id', 'status'].every(field => invocation.consumedFields.some(row => row.readId === read.id && row.field === field))
}
export function httpAcceptedSend(measurement, order = HTTP_ORDER, kind = 'sdk-send') {
  const request = httpRequest(measurement), invocation = httpInvocation(measurement)
  const accepted = measurement.httpFunctions?.accepted
  const operation = invocation?.operations[0]
  return request?.method === 'POST' && request.path === '/api/orders' && request.response.statusCode === 202
    && request.response.headers.location === `/api/orders/${order.id}`
    && exactOrder(httpBody(measurement), { id: order.id, status: 'pending' })
    && exactOrder(invocation.requestOrder, order) && invocation.operations.length === 1 && operation.kind === kind
    && accepted.length === 1 && accepted[0].id === operation.acceptedId && exactOrder(accepted[0].order, order)
    && accepted[0].sendReceiptId === operation.sendReceiptId && accepted[0].target.queue === ORDERS_TARGET.queue
    && request.sendReceiptIds.length === 1 && request.sendReceiptIds[0] === operation.sendReceiptId
    && measurement.trace.filter(row => row.kind === 'enqueue').length === 1
    && measurement.trace.some(row => row.id === operation.sendReceiptId && row.kind === 'send' && row.entityId === ORDERS_ID
      && row.sourceMessageId === accepted[0].sourceMessageId)
    && measurement.trace.some(row => row.kind === 'enqueue' && row.entityId === ORDERS_ID
      && row.messageRecordId === accepted[0].messageRecordId && row.sourceMessageId === accepted[0].sourceMessageId)
}
export function httpRetryRead(measurement, statusCode, status = 'pending', order = HTTP_ORDER) {
  const request = httpRequest(measurement), invocation = httpInvocation(measurement)
  if (request?.method !== 'POST' || request.path !== '/api/orders' || request.response.statusCode !== statusCode
    || !exactOrder(invocation?.requestOrder, order) || !httpNoSend(measurement)) return false
  const read = invocation.reads.find(row => row.kind === 'repository' && row.orderId === order.id && row.found)
  if (!read || !exactOrder({ id: read.record.id, region: read.record.region, quantity: read.record.quantity }, HTTP_ORDER)) return false
  if (statusCode === 409) return read.record.quantity !== order.quantity || read.record.region !== order.region
  return read.record.status === status && request.response.headers.location === `/api/orders/${order.id}`
    && exactOrder(httpBody(measurement), { id: order.id, status })
    && ['id', 'status'].every(field => invocation.consumedFields.some(row => row.readId === read.id && row.field === field))
}

// All retained episode observations resolve their own authoritative execution,
// current capture, saved source versions and resource generation. No baseline proof.
export function currentHttpObservations(context, lab = HTTP_CONTEXT) {
  return context.runtime.messaging.executionReceipts.filter(receipt => receipt.mode === 'http-handler'
    && receipt.measurements.httpFunctions?.invocations.length === 1
    && httpEvidenceIsCurrent({ measurements: receipt.measurements }, context, lab)).map(receipt => receipt.measurements)
}
export function httpTask({ id, text, rationale, hints = [], solution, currentCheck, episodeCheck = observations => observations.some(currentCheck) }) {
  return messagingTask({ id, text, rationale, hints, solution,
    paths: HTTP_PATHS, resourceIds: HTTP_RESOURCES,
    check: context => functionsReady(context) && episodeCheck(currentHttpObservations(context), context) })
}
export const httpExerciseTask = (task, check) => ({ taskId: task.id, ...task.verification,
  entry: 'function_app.py', mode: 'http-handler', check })
export const httpGet = path => command(`curl -i http://localhost:7071/api/${path}`)
export const httpPost = body => command(`curl -i -X POST -H "Content-Type: application/json" -d '${typeof body === 'string' ? body : JSON.stringify(body)}' http://localhost:7071/api/orders`)
export function httpLab({ stage, order, title, brief, files, task, currentCheck, initialize }) {
  return { ...HTTP_METADATA, id: `http-functions-${stage}`, journeyOrder: order, title, minutes: 25,
    brief, initialProjectFiles: files, initializeSimulation: initialize, messagingInput: HTTP_INPUT,
    tasks: [task], messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'http-handler' }, { entry: 'worker.py', mode: 'script' }],
      tasks: [httpExerciseTask(task, currentCheck)] } }
}

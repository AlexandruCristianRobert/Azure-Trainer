import { HTTP_CAPSTONE_SOURCE, httpCapstoneProjectFiles } from '../../templates/http-functions-python/capstone.js'
import { httpTask, httpLab, file, command, httpCloudPost, httpCloudGet, HTTP_INPUT, HTTP_ORDER,
  httpRequest, httpInvocation, httpNoSend, httpAcceptedSend, httpStatusRead, httpRetryRead, httpJsonResponse, exactOrder } from './helpers.js'
import { seedHttpStage } from './seeds.js'
import { completedOrderWork } from '../messaging-journey/helpers.js'

const changedOrder = Object.freeze({ id: 'o1', region: 'EU', quantity: 3 })
const granted = measurement => httpRequest(measurement)?.scope === 'published'
  && httpRequest(measurement).authorization === 'granted' && httpInvocation(measurement)?.keyId === 'default'
const conflict = measurement => granted(measurement) && httpRetryRead(measurement, 409, 'processed', changedOrder)
const denied = (measurement, method) => {
  const request = httpRequest(measurement), invocation = httpInvocation(measurement)
  return request?.scope === 'published' && request.method === method
    && request.path === (method === 'POST' ? '/api/orders' : '/api/orders/o1')
    && request.authorization === 'denied' && request.response.statusCode === 401
    && !!invocation?.functionId && invocation.keyId === null && invocation.reads.length === 0 && httpNoSend(measurement)
    && (method === 'GET' || request.inputClass === 'valid' && exactOrder(invocation.requestOrder, HTTP_ORDER))
}
const invalid = (measurement, inputClass) => granted(measurement) && httpRequest(measurement).method === 'POST'
  && httpRequest(measurement).path === '/api/orders' && httpRequest(measurement).inputClass === inputClass
  && httpRequest(measurement).response.statusCode === 400 && httpInvocation(measurement).requestOrder === null
  && httpInvocation(measurement).reads.length === 0 && httpNoSend(measurement)
function originalRead(measurement, accepted, workerReceiptId = null) {
  const read = httpInvocation(measurement)?.reads.find(row => row.kind === 'repository' && row.found && row.orderId === 'o1')
  return !!read && exactOrder({ id: read.record.id, region: read.record.region, quantity: read.record.quantity }, HTTP_ORDER)
    && read.record.origin.acceptedId === accepted.id && read.record.origin.appId === accepted.appId
    && read.record.origin.messageRecordId === accepted.messageRecordId
    && read.record.origin.sendReceiptId === accepted.sendReceiptId
    && exactOrder(read.record.origin.target, accepted.target) && read.record.origin.workerReceiptId === workerReceiptId
}
const task = httpTask({ id: 'complete-published-order-api',
  text: 'Construct the complete Python v2 order API: parse JSON with ValueError handling; validate exactly id/region/non-boolean integer quantity; explicitly protect BOTH POST orders and GET orders/{id} with AuthLevel.FUNCTION. Read the supplied repository for status and before submitting. Stage a new valid order through a Service Bus queue output binding and return JSON 202/Location only on actual enqueue. Same payload returns JSON 200 with directly consumed record.id/status and Location without another send; changed payload returns 409 without mutating the original. Save and publish once. Reject keyless POST and GET, malformed JSON and boolean quantity; submit o1/EU/2 with the supplied demo-only header; GET pending; explicitly run python worker.py; GET processed; retry unchanged and then o1/EU/3. Prove exactly one binding enqueue, one matching worker completion, and an immutable original.',
  rationale: { concept: 'One protected asynchronous order API episode',
    what: 'Connects validation, function-key access, an actual staged queue output, consumed repository status and payload-bound retry behavior.',
    why: 'An accepted HTTP command needs inspectable asynchronous work and a stable meaning when callers retry.',
    without: 'Literal success/status labels cannot establish queue acceptance, worker processing or safe reuse of the original payload.',
    csharp: 'In a C# isolated worker, protect both [HttpTrigger(AuthorizationLevel.Function, ...)] routes, parse/validate the request and use a custom return object with [ServiceBusOutput("orders", Connection = "ServiceBusConnection")] plus the HTTP response. Read the same repository before producing output; identical retries return OK and changed data returns Conflict. These C# comparisons are authored guidance, not another execution language. Sequential trainer idempotency is not a concurrent database transaction or production outbox.' },
  hints: ['Protect GET explicitly as well as POST; a FunctionApp default cannot override an explicitly anonymous route.',
    'Do not treat a literal 202, unused lookup or SDK replacement as output-binding/read proof.',
    'Return the original record.id/status directly and run the supplied worker yourself.'],
  solution: { steps: [file('function_app.py', HTTP_CAPSTONE_SOURCE), command('func azure functionapp publish func-orders'),
    httpCloudPost(HTTP_ORDER), httpCloudGet('orders/o1'),
    httpCloudPost('{', HTTP_INPUT.httpFunctions.functionKeys[0].value),
    httpCloudPost({ id: 'o1', region: 'EU', quantity: true }, HTTP_INPUT.httpFunctions.functionKeys[0].value),
    httpCloudPost(HTTP_ORDER, HTTP_INPUT.httpFunctions.functionKeys[0].value),
    httpCloudGet('orders/o1', HTTP_INPUT.httpFunctions.functionKeys[0].value), command('python worker.py'),
    httpCloudGet('orders/o1', HTTP_INPUT.httpFunctions.functionKeys[0].value),
    httpCloudPost(HTTP_ORDER, HTTP_INPUT.httpFunctions.functionKeys[0].value),
    httpCloudPost(changedOrder, HTTP_INPUT.httpFunctions.functionKeys[0].value)] },
  currentCheck: conflict,
  episodeCheck: (observations, context) => {
    const state = context.runtime.messaging, accepted = state.httpFunctions?.accepted ?? []
    if (accepted.length !== 1 || !exactOrder(accepted[0].order, HTTP_ORDER)) return false
    const original = accepted[0]
    const worker = state.executionReceipts.find(receipt => receipt.entry === 'worker.py' && receipt.mode === 'script'
      && receipt.measurements.receipts.servicebus.length === 1
      && receipt.measurements.receipts.servicebus[0].id === original.messageRecordId
      && completedOrderWork(receipt.measurements, receipt.measurements.receipts.servicebus[0], 'o1', 2))
    const workerTrace = worker?.measurements.trace.find(row => row.kind === 'order-record' && row.messageRecordId === original.messageRecordId)
    if (!workerTrace || !exactOrder(state.effects.workByOrder, { o1: 1 }) || !exactOrder(state.effects.processed?.o1, HTTP_ORDER)) return false
    const acceptedAt = observations.findIndex(measurement => granted(measurement) && httpJsonResponse(measurement)
      && httpAcceptedSend(measurement, HTTP_ORDER, 'binding-send')
      && httpInvocation(measurement).reads.some(row => row.kind === 'repository' && !row.found && row.orderId === 'o1'))
    if (acceptedAt < 0 || observations.filter(measurement => measurement.trace.some(row => row.kind === 'enqueue')).length !== 1) return false
    const before = observations.slice(0, acceptedAt)
    if (!before.some(measurement => denied(measurement, 'POST')) || !before.some(measurement => denied(measurement, 'GET'))
      || !before.some(measurement => invalid(measurement, 'malformed')) || !before.some(measurement => invalid(measurement, 'quantity-bool'))) return false
    const pendingAt = observations.findIndex((measurement, index) => index > acceptedAt && granted(measurement)
      && httpJsonResponse(measurement) && httpStatusRead(measurement, 'pending') && originalRead(measurement, original))
    const processedAt = observations.findIndex((measurement, index) => index > pendingAt && granted(measurement)
      && httpJsonResponse(measurement) && httpStatusRead(measurement, 'processed') && originalRead(measurement, original, workerTrace.id))
    const reuseAt = observations.findIndex((measurement, index) => index > processedAt && granted(measurement)
      && httpJsonResponse(measurement) && httpRetryRead(measurement, 200, 'processed') && originalRead(measurement, original, workerTrace.id))
    return pendingAt > acceptedAt && processedAt > pendingAt && reuseAt > processedAt
      && observations.some((measurement, index) => index > reuseAt && conflict(measurement) && originalRead(measurement, original, workerTrace.id))
  },
})
export const httpCapstoneLab = { ...httpLab({ stage: 'capstone', order: 9, title: 'Simulated: Complete the protected published Order API',
  brief: 'Integrate the HTTP Order API on independently supplied empty resources, published settings, SDK client, protected worker and teaching repository. Validation, protected order routes, output binding, responses and retries begin unfinished; no HTTP request or completion proof is seeded.',
  files: httpCapstoneProjectFiles(), task, currentCheck: conflict, initialize: run => seedHttpStage(run, 'capstone') }),
  labMode: 'capstone', minutes: 35 }

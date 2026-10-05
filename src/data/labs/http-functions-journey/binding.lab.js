import { HTTP_BINDING_SOURCE, httpHostingProjectFiles } from '../../templates/http-functions-python/hosting.js'
import { httpTask, httpLab, file, command, httpCloudPost, httpCloudGet, HTTP_INPUT, HTTP_ORDER,
  httpRequest, httpAcceptedSend, httpStatusRead, httpJsonResponse, exactOrder } from './helpers.js'
import { seedHttpStage } from './seeds.js'
import { completedOrderWork } from '../messaging-journey/helpers.js'

const processed = measurement => httpRequest(measurement)?.scope === 'published'
  && httpJsonResponse(measurement) && httpStatusRead(measurement, 'processed')
const task = httpTask({ id: 'flush-order-output-binding',
  text: 'Replace the supplied POST SDK sender with @app.service_bus_queue_output(arg_name="output", queue_name="orders", connection="ServiceBusConnection"), an output: func.Out[str] parameter, and output.set(json.dumps(order)) only for a new validated order. Retain supplied validation, repository-first same-body 200/changed-body 409, function-level POST access and JSON 202/Location. Save and publish. Submit one valid order with the demo-only header; inspect an actual binding-send and enqueue, then GET its real pending status. Explicitly run python worker.py and GET processed. A setter or literal 202 alone is insufficient: a normal response must flush to the actual queue. SendDisabled yields 503 with no new acceptance.',
  rationale: { concept: 'Staged output and the actual host flush boundary',
    what: 'Stages an order in Out[str], then proves the host flushed it to the configured queue after a normal response.',
    why: 'The Order API can declare a queue output while preserving validation, payload-bound retries and explicit asynchronous work.',
    without: 'A staged value that cannot flush is no acceptance; substituting an SDK send exercises a different execution boundary.',
    csharp: 'A C# isolated worker commonly returns a custom result with a [ServiceBusOutput("orders", Connection = "ServiceBusConnection")] property and a separate HTTP response property. Python v2 uses the queue-output decorator plus func.Out[str].set. A completed SDK send survives later response failure, whereas this bounded binding model rolls back staged output on response/flush failure; it is not a production distributed transaction.' },
  hints: ['Use the actual ServiceBusConnection__fullyQualifiedNamespace app setting to resolve sb-orders.', 'The supplied worker is protected prerequisite code. HTTP never runs it implicitly.', 'After changing queue status back to Active, capture/request again to obtain current resource-generation proof.'],
  solution: { steps: [file('function_app.py', HTTP_BINDING_SOURCE), command('func azure functionapp publish func-orders'),
    httpCloudPost(HTTP_ORDER, HTTP_INPUT.httpFunctions.functionKeys[0].value), httpCloudGet('orders/o1'),
    command('python worker.py'), httpCloudGet('orders/o1')] },
  currentCheck: processed,
  episodeCheck: (observations, context) => {
    const state = context.runtime.messaging, accepted = state.httpFunctions?.accepted ?? []
    return observations.some(measurement => httpRequest(measurement)?.scope === 'published'
      && httpRequest(measurement).authorization === 'granted' && httpJsonResponse(measurement)
      && httpAcceptedSend(measurement, HTTP_ORDER, 'binding-send'))
      && observations.some(measurement => httpRequest(measurement)?.scope === 'published'
        && httpJsonResponse(measurement) && httpStatusRead(measurement, 'pending'))
      && observations.some(processed) && accepted.length === 1 && exactOrder(accepted[0].order, HTTP_ORDER)
      && state.executionReceipts.some(receipt => receipt.entry === 'worker.py' && receipt.mode === 'script'
        && receipt.measurements.receipts.servicebus.length === 1
        && completedOrderWork(receipt.measurements, receipt.measurements.receipts.servicebus[0], 'o1', 2))
      && exactOrder(state.effects.workByOrder, { o1: 1 }) && exactOrder(state.effects.processed?.o1, HTTP_ORDER)
  },
})
export const httpBindingLab = httpLab({ stage: 'binding', order: 8, title: 'Simulated: Send orders through a Service Bus output binding',
  brief: 'A complete independent validated, retry-aware function-key API and actual cloud settings are supplied. Its POST still uses the SDK: construct the output binding and prove flush, pending status and explicit worker processing. Empty queue; no HTTP capture/request/acceptance/proof is seeded.',
  files: httpHostingProjectFiles('binding'), task, currentCheck: processed, initialize: run => seedHttpStage(run, 'binding') })

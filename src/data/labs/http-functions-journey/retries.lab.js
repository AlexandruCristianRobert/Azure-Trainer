import { HTTP_SOLUTION_SOURCES, httpProjectFiles } from '../../templates/http-functions-python/api.js'
import { httpTask, httpLab, file, command, httpPost, httpGet, HTTP_ORDER, httpAcceptedSend, httpStatusRead, httpRetryRead, exactOrder } from './helpers.js'
import { seedHttpStage } from './seeds.js'
import { completedOrderWork } from '../messaging-journey/helpers.js'

const processed = m => httpStatusRead(m, 'processed')
const task = httpTask({ id: 'reuse-and-conflict-orders',
  text: 'Before sending in the validated POST, read OrderStatusRepository.get(order["id"]). If found, compare its original region/quantity. The same payload returns 200 with the actual record.id/status and the same Location, without another send; changed payload returns 409 without mutation. Save/capture, POST o1/EU/2, retry it, POST o1/EU/3, explicitly run python worker.py, then GET o1. Confirm one queued message, one actual business work/processed marker and processed status. The supplied worker is protected prerequisite code, not an HTTP callback.',
  rationale: { concept: 'Payload-bound retry reuse and explicit asynchronous work', what: 'Reads accepted order state before a send, separates identical retries from conflicting reuse, and observes work after the worker executes.', why: 'A caller can safely retry an uncertain acknowledgement while preserving the original business command.', without: 'Repeating sends creates duplicate deliveries; accepting changed data under the same ID rewrites the meaning of an existing command.', csharp: 'A C# isolated function follows the same repository-first comparison before SendMessageAsync, returning OK or Conflict. Consumer idempotency is still necessary. This serialized teaching repository is not an atomic distributed transaction or production outbox.' },
  hints: ['Return repository id/status directly for read provenance.', 'Compare the actual send count across requests, rather than trusting a response label.', 'GET cannot produce processed until the explicit worker does matching work, records and completes.'],
  solution: { steps: [file('function_app.py', HTTP_SOLUTION_SOURCES.retries), command('func start'), httpPost(HTTP_ORDER), httpPost(HTTP_ORDER),
    httpPost({ id: 'o1', region: 'EU', quantity: 3 }), command('python worker.py'), httpGet('orders/o1')] },
  currentCheck: processed,
  episodeCheck: (observations, context) => {
    const state = context.runtime.messaging
    const sends = observations.filter(m => m.trace.some(row => row.kind === 'enqueue'))
    const accepted = state.httpFunctions?.accepted ?? []
    return sends.length === 1 && observations.some(m => httpAcceptedSend(m))
      && observations.some(m => httpRetryRead(m, 200))
      && observations.some(m => httpRetryRead(m, 409, 'pending', { id: 'o1', region: 'EU', quantity: 3 }))
      && observations.some(processed) && accepted.length === 1 && exactOrder(accepted[0].order, HTTP_ORDER)
      && state.executionReceipts.some(receipt => receipt.entry === 'worker.py' && receipt.mode === 'script'
        && receipt.measurements.receipts.servicebus.length === 1
        && completedOrderWork(receipt.measurements, receipt.measurements.receipts.servicebus[0], 'o1', 2))
      && exactOrder(state.effects.workByOrder, { o1: 1 }) && exactOrder(state.effects.processed?.o1, HTTP_ORDER)
  },
})
export const httpRetriesLab = httpLab({ stage: 'retries', order: 5, title: 'Simulated: Reuse retries and reject conflicting orders',
  brief: 'Construct repository-first retry handling on an independently supplied validated enqueue/status API. Empty queue and app/storage/SDK/worker/repository prerequisites are supplied. Retry code is unfinished; no acceptance, HTTP capture, request or completion proof is seeded.',
  files: httpProjectFiles('retries'), task, currentCheck: processed, initialize: run => seedHttpStage(run, 'retries') })

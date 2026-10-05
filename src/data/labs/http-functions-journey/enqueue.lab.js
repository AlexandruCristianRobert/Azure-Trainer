import { HTTP_SOLUTION_SOURCES, httpProjectFiles } from '../../templates/http-functions-python/api.js'
import { httpTask, httpLab, file, command, httpPost, httpGet, HTTP_ORDER, httpAcceptedSend, httpStatusRead } from './helpers.js'
import { seedHttpStage } from './seeds.js'

const pending = m => httpStatusRead(m, 'pending')
const task = httpTask({ id: 'enqueue-before-acknowledgement',
  text: 'Extend the supplied validated POST handler in function_app.py. Use bus.get_queue_sender(queue_name="orders") and sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"])). Only after the real send return 202 JSON {id,status:"pending"} and Location /api/orders/{id}. Save/capture, POST o1/EU/2, then GET o1 to consume its actual pending state. Inspect the actual queue; HTTP must not run the supplied worker.',
  rationale: { concept: 'Queue-backed 202 and status location', what: 'Links a successful SDK send to an asynchronous acknowledgement and a real status resource.', why: '202 tells the caller work was queued, while Location points to its later result.', without: 'A literal 202 can acknowledge work that never entered the queue; immediately claiming processed hides asynchronous execution.', csharp: 'C# isolated worker would await ServiceBusSender.SendMessageAsync before returning Accepted with Location. Python uses the synchronous SDK subset here; the same send-before-response dependency applies.' },
  hints: ['Use the parsed validated order as the sent payload.', 'No worker command belongs in this pending-only episode.'],
  solution: { steps: [file('function_app.py', HTTP_SOLUTION_SOURCES.enqueue), command('func start'), httpPost(HTTP_ORDER), httpGet('orders/o1')] },
  currentCheck: pending, episodeCheck: observations => observations.some(m => httpAcceptedSend(m)) && observations.some(pending),
})
export const httpEnqueueLab = httpLab({ stage: 'enqueue', order: 4, title: 'Simulated: Enqueue an order before returning 202',
  brief: 'Add an actual Service Bus SDK send, asynchronous acknowledgement and Location to the independently supplied validated API. The queue is empty and the new enqueue behavior is unfinished. App/storage/worker/repository are supplied; no HTTP history is seeded.',
  files: httpProjectFiles('enqueue'), task, currentCheck: pending, initialize: run => seedHttpStage(run, 'enqueue') })

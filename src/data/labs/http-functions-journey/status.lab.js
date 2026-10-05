import { HTTP_SOLUTION_SOURCES, httpProjectFiles } from '../../templates/http-functions-python/api.js'
import { httpTask, httpLab, file, command, httpGet, httpStatusRead } from './helpers.js'
import { seedHttpStage } from './seeds.js'

const pending = m => httpStatusRead(m, 'pending')
const task = httpTask({ id: 'repository-status-route',
  text: 'Implement GET orders/{id} in function_app.py. Read req.route_params["id"] with the supplied OrderStatusRepository. Return 404 for None; otherwise serialize the actual record.id and record.status as JSON with 200. Save/capture, request unknown o-missing, then o1. The independently supplied o1/EU/quantity2 queue input is genuinely pending and grants no HTTP read credit.',
  rationale: { concept: 'Route parameters and consumed repository reads', what: 'A parameter selects an actual order record; its id/status fields flow into the HTTP response.', why: 'Clients must distinguish a pending order from an unknown identifier.', without: 'A canned pending body can lie about queue state; merely calling get without using its result proves no response linkage.', csharp: 'C# isolated [HttpTrigger(..., Route="orders/{id}")] can bind an id parameter. Its repository result must likewise feed HttpResponseData.WriteAsJsonAsync; Python uses req.route_params and json.dumps.' },
  hints: ['Unknown lookup returns None, not a placeholder record.', 'HTTP requests do not process the queue.'],
  solution: { steps: [file('function_app.py', HTTP_SOLUTION_SOURCES.status), command('func start'), httpGet('orders/o-missing'), httpGet('orders/o1')] },
  currentCheck: pending, episodeCheck: observations => observations.some(m => httpStatusRead(m, null, 'o-missing')) && observations.some(pending),
})
export const httpStatusLab = httpLab({ stage: 'status', order: 2, title: 'Simulated: Read actual order status over HTTP',
  brief: 'Construct route-parameter lookup and real 404/pending responses. A working health route and one actual pending queue input are independently supplied with the app/storage/broker/worker. The status handler is unfinished; no HTTP request, capture or read proof exists.',
  files: httpProjectFiles('status'), task, currentCheck: pending, initialize: run => seedHttpStage(run, 'status') })

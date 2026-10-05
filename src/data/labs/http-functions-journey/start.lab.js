import { HTTP_SOLUTION_SOURCES, httpProjectFiles } from '../../templates/http-functions-python/api.js'
import { httpTask, httpLab, file, command, httpGet, httpRequest, httpBody, httpInvocation, httpNoSend } from './helpers.js'
import { seedHttpStage } from './seeds.js'

const healthy = m => httpRequest(m)?.method === 'GET' && httpRequest(m).path === '/api/health'
  && httpRequest(m).response.statusCode === 200 && httpBody(m)?.status === 'ok'
  && (httpRequest(m).response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() === 'application/json'
  && !!httpInvocation(m)?.functionId && httpNoSend(m)
const task = httpTask({ id: 'local-http-health',
  text: 'In function_app.py, keep the Python v2 FunctionApp and register GET health with @app.route. Return a JSON HttpResponse containing status ok and application/json. Save, run func start to capture the saved project, then curl -i http://localhost:7071/api/health. Inspect the response. The supplied app/storage/broker are prerequisites; no host or HTTP evidence is prepared.',
  rationale: { concept: 'HTTP route registration and captured source', what: 'A decorator registers a request handler; HttpResponse supplies its body, status and headers.', why: 'The Order API needs a callable health entry before business routes are added.', without: 'An unregistered path returns host 404; saving alone leaves the previous captured code running.', csharp: 'In C# isolated worker, [Function] and [HttpTrigger] register a function taking HttpRequestData and returning HttpResponseData. Python v2 uses decorators and func.HttpRequest/HttpResponse; both require a host capture.' },
  hints: ['Use func.AuthLevel.ANONYMOUS for these local introductory routes.', 'func start captures saved code; rerun it after edits.'],
  solution: { steps: [file('function_app.py', HTTP_SOLUTION_SOURCES.start), command('func start'), httpGet('health')] }, currentCheck: healthy,
})
export const httpStartLab = httpLab({ stage: 'start', order: 1, title: 'Simulated: Start the Python HTTP Order API',
  brief: 'Construct a Python v2 health route, capture its saved host, and make one local request. Independent Python 3.12/Functions 4 app, storage, queue, SDK client and protected worker/repository are supplied. The new handler is unfinished; no HTTP host, request or proof is seeded.',
  files: httpProjectFiles('start'), task, currentCheck: healthy, initialize: run => seedHttpStage(run, 'start') })

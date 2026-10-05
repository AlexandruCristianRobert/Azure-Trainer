import { HTTP_KEYS_SOURCE, httpHostingProjectFiles } from '../../templates/http-functions-python/hosting.js'
import { httpTask, httpLab, file, command, httpPost, httpCloudPost, HTTP_INPUT, HTTP_ORDER,
  httpRequest, httpInvocation, httpNoSend, httpAcceptedSend, httpRetryRead, httpJsonResponse, exactOrder } from './helpers.js'
import { seedHttpStage } from './seeds.js'

const localReuse = measurement => httpRequest(measurement)?.scope === 'local'
  && httpRequest(measurement).authorization === 'not-required' && httpJsonResponse(measurement) && httpRetryRead(measurement, 200)
const denied = measurement => httpRequest(measurement)?.scope === 'published'
  && httpRequest(measurement).method === 'POST' && httpRequest(measurement).path === '/api/orders'
  && httpRequest(measurement).authorization === 'denied' && httpRequest(measurement).response.statusCode === 401
  && httpRequest(measurement).inputClass === 'valid' && exactOrder(httpInvocation(measurement)?.requestOrder, HTTP_ORDER)
  && !!httpInvocation(measurement)?.functionId && httpInvocation(measurement).keyId === null
  && httpInvocation(measurement).reads.length === 0 && httpNoSend(measurement)
const granted = measurement => httpRequest(measurement)?.scope === 'published'
  && httpRequest(measurement).authorization === 'granted' && !!httpInvocation(measurement)?.keyId
  && httpJsonResponse(measurement) && httpAcceptedSend(measurement)
const task = httpTask({ id: 'protect-published-orders',
  text: 'Set auth_level=func.AuthLevel.FUNCTION on the POST orders route, preserving supplied validation, retry, settings and status behavior. Save, capture the local host and publish func-orders. Submit the same valid order to the published route with no key, then a deliberately wrong dummy header: both must return 401 before repository reads or queue work. Use the supplied demo-only x-functions-key header from the hidden Solution for one accepted 202. Submit the same body locally with no key: ordinary local Core Tools authentication is disabled and the actual accepted record returns 200 without another send. Inspect value-free authorization outcomes; do not put keys in response bodies or explanation prompts.',
  rationale: { concept: 'Function-level access at the published host boundary',
    what: 'Protects a published route with a dummy function-key header before handler execution, then contrasts ordinary local host behavior.',
    why: 'The Order API must make its chosen access boundary explicit before accepting broker work.',
    without: 'An anonymous published route permits the submission regardless of the header; a handler-side response label does not prove authorization blocked effects.',
    csharp: 'A C# isolated worker uses [HttpTrigger(AuthorizationLevel.Function, "post", Route = "orders")]. Python v2 uses func.AuthLevel.FUNCTION on @app.route. Ordinary Core Tools local execution disables key enforcement; this browser model supports only the authored header-key boundary, not identity/RBAC or secret management.' },
  hints: ['Keep status and environment routes anonymous; protect only the assigned POST route.', 'The key is a clearly dummy training fixture, deliberately visible in authored Solution commands. Public runtime proof records only its fixture ID and outcome.'],
  solution: { steps: [file('function_app.py', HTTP_KEYS_SOURCE), command('func start'), command('func azure functionapp publish func-orders'),
    httpCloudPost(HTTP_ORDER), httpCloudPost(HTTP_ORDER, 'deliberately-wrong-demo-key'),
    httpCloudPost(HTTP_ORDER, HTTP_INPUT.httpFunctions.functionKeys[0].value), httpPost(HTTP_ORDER)] },
  currentCheck: localReuse,
  episodeCheck: (observations, context) => observations.filter(denied).length >= 2 && observations.some(granted)
    && observations.some(localReuse) && context.runtime.messaging.httpFunctions?.accepted.length === 1,
})
export const httpKeysLab = httpLab({ stage: 'keys', order: 7, title: 'Simulated: Protect published orders with a function key',
  brief: 'The complete independent API and real modeled published settings are supplied, with an initially anonymous POST route. Construct its function-level access and compare cloud denial with ordinary local execution. Empty queue; no capture/request/acceptance/proof is seeded.',
  files: httpHostingProjectFiles('keys'), task, currentCheck: localReuse, initialize: run => seedHttpStage(run, 'keys') })

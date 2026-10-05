import { HTTP_SOLUTION_SOURCES, httpProjectFiles } from '../../templates/http-functions-python/api.js'
import { httpTask, httpLab, file, command, httpPost, httpRequest, httpInvocation, httpBody, httpNoSend, httpJsonResponse, exactOrder, HTTP_ORDER } from './helpers.js'
import { seedHttpStage } from './seeds.js'

export const HTTP_INVALID_BODIES = Object.freeze(['{', [],
  { id: 'o1', region: 'EU', quantity: 2, extra: 'x' },
  { id: '-bad', region: 'EU', quantity: 2 }, { id: 'o1', region: 'APAC', quantity: 2 },
  { id: 'o1', region: 'EU', quantity: true }, { id: 'o1', region: 'EU', quantity: '2' },
  { id: 'o1', region: 'EU', quantity: 1.5 },
  { id: 'o1', region: 'EU', quantity: 0 }])
export const HTTP_INVALID_CLASSES = Object.freeze(['malformed', 'nonobject', 'fields', 'id', 'region',
  'quantity-bool', 'quantity-type', 'quantity-fraction', 'quantity-range'])
const valid = m => httpRequest(m)?.method === 'POST' && httpRequest(m).path === '/api/orders'
  && httpRequest(m).response.statusCode === 200 && exactOrder(httpInvocation(m)?.requestOrder, HTTP_ORDER)
  && httpJsonResponse(m) && exactOrder(httpBody(m), HTTP_ORDER) && httpNoSend(m)
const invalid = m => httpRequest(m)?.method === 'POST' && httpRequest(m).path === '/api/orders'
  && !!httpInvocation(m)?.functionId && httpRequest(m).response.statusCode === 400
  && httpRequest(m).authorization !== 'denied' && HTTP_INVALID_CLASSES.includes(httpInvocation(m).inputClass)
  && httpInvocation(m).requestOrder === null && httpNoSend(m)
const task = httpTask({ id: 'validate-order-json',
  text: 'Construct POST orders and explicit learner validation. Catch only ValueError from req.get_json and return 400. Require exactly id/region/quantity: id is 1–64 characters, starts alphanumeric and thereafter contains only alphanumerics/_/-; region is EU or US; quantity is a non-boolean integer 1–100. Reject arrays, missing/extra keys, wrong types and ranges with 400 before any send. For a valid order return its JSON with 200. Save/capture and run one case each: malformed JSON, array, extra key, invalid id, invalid region, boolean/string/fractional/out-of-range quantity, followed by o1/EU/2. Distinct input categories matter; repeating one rejected body cannot complete this task. This stage does not enqueue.',
  rationale: { concept: 'Boundary validation before side effects', what: 'Parses JSON and checks its shape, types and ranges in the executed handler.', why: 'An accepted command must have one bounded canonical payload before queue processing.', without: 'Python bool is an int subclass; a broad integer check accidentally admits True. Rejecting every body also rejects legitimate orders.', csharp: 'C# isolated worker can deserialize a DTO then validate it before sending. Python requires explicit isinstance checks, including bool before int; ValueError corresponds to the narrow malformed-JSON path rather than a catch-all.' },
  hints: ['Use dict.get after checking dict and exactly three entries.', 'Iterate the identifier characters; this bounded runtime does not import regex.', 'Keep SDK sends out of this stage.'],
  solution: { steps: [file('function_app.py', HTTP_SOLUTION_SOURCES.validation), command('func start'), ...HTTP_INVALID_BODIES.map(httpPost), httpPost(HTTP_ORDER)] },
  currentCheck: valid, episodeCheck: observations => HTTP_INVALID_CLASSES.every(inputClass => observations.some(m => invalid(m) && httpInvocation(m).inputClass === inputClass)) && observations.some(valid),
})
export const httpValidationLab = httpLab({ stage: 'validation', order: 3, title: 'Simulated: Validate order JSON before accepting it',
  brief: 'Construct a validated POST route using explicit Python types, identifier rules and narrow JSON error handling. Working health/status code and empty queue/app/storage prerequisites are independent. The POST is unfinished and no HTTP evidence is seeded.',
  files: httpProjectFiles('validation'), task, currentCheck: valid, initialize: run => seedHttpStage(run, 'validation') })

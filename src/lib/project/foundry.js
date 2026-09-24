import { FOUNDRY_PROGRAM } from '../../data/templates/containerapps-dotnet/foundry.js'
import { TROUBLESHOOTING_FOUNDRY_PROGRAM } from '../../data/templates/containerapps-dotnet/foundry-troubleshooting.js'
import { INDEPENDENT_FOUNDRY_PROGRAM, INDEPENDENT_FOUNDRY_STARTER_FILES } from '../../data/templates/containerapps-dotnet/foundry-independent.js'

const programPath = 'src/Trainer.Api/Program.cs'
const settingsPath = 'src/Trainer.Api/appsettings.json'
const diagnostic = (code, message, path) => ({ code, message, path, line: 1, column: 1 })

// A small lexer compares syntax rather than substrings. Comments cannot satisfy a
// required call and extra executable statements cannot hide between them.
function tokens(source) {
  const result = []
  let position = 0
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|=>|./y
  while (position < source.length) {
    pattern.lastIndex = position
    const match = pattern.exec(source)
    if (!match) return null
    position = pattern.lastIndex
    const value = match[0]
    if (!/^\s+$/.test(value) && !value.startsWith('//') && !value.startsWith('/*')) result.push(value)
  }
  return result
}

const expected = tokens(FOUNDRY_PROGRAM)
const slot = (sequence) => expected.findIndex((_, index) => sequence.every((value, offset) => expected[index + offset] === value)) + sequence.length
const inputLimitIndex = slot(['text', '.', 'Length', '>'])
const deadlineIndex = slot(['new', 'CancellationTokenSource', '(', 'TimeSpan', '.', 'FromSeconds', '('])
const attemptIndex = slot(['NetworkTimeout', '=', 'TimeSpan', '.', 'FromSeconds', '('])
export function parseFoundrySource(program, configuration) {
  const diagnostics = []
  const actual = typeof program === 'string' ? tokens(program) : null
  const numericSlots = new Set([inputLimitIndex, deadlineIndex, attemptIndex])
  if (!actual || actual.length !== expected.length || actual.some((value, index) => !numericSlots.has(index) && value !== expected[index])) {
    diagnostics.push(diagnostic('UNSUPPORTED_FOUNDRY_SOURCE', 'The supported POST route, validation, managed identity, Responses client and timeout are required.', programPath))
  }
  const [maxInputLength, timeoutSeconds, attemptTimeoutSeconds] = [inputLimitIndex, deadlineIndex, attemptIndex].map((index) => Number(actual?.[index]))
  if (!Number.isInteger(maxInputLength) || maxInputLength < 1 || maxInputLength > 4000
    || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 10
    || !Number.isInteger(attemptTimeoutSeconds) || attemptTimeoutSeconds < 1 || attemptTimeoutSeconds > 3
    || attemptTimeoutSeconds > timeoutSeconds) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_BOUNDS', 'Input limit must be 1–4000, total timeout 1–10 seconds and attempt timeout 1–3 seconds.', programPath))
  }
  const endpoint = configuration?.FoundryEndpoint
  const deployment = configuration?.FoundryDeployment
  if (typeof endpoint !== 'string' || typeof deployment !== 'string') {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_CONFIG', 'FoundryEndpoint and FoundryDeployment must be strings.', settingsPath))
  } else if ((endpoint === '') !== (deployment === '')) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_CONFIG', 'Configure both the resource endpoint and deployment.', settingsPath))
  } else if (endpoint && !/^https:\/\/[a-z][a-z0-9-]{1,62}\.services\.ai\.azure\.com\/openai\/v1\/$/.test(endpoint)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_ENDPOINT', 'Use the Foundry account resource /openai/v1/ endpoint.', settingsPath))
  } else if (deployment && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_DEPLOYMENT', 'Use a bounded model deployment name.', settingsPath))
  }
  return { foundry: diagnostics.length ? null : { configured: Boolean(endpoint), endpoint, deployment,
    method: 'POST', path: '/api/summarize', maxInputLength, timeoutSeconds, attemptTimeoutSeconds,
    tokenScope: 'https://ai.azure.com/.default', sdkRetries: 0, identity: 'user-assigned' }, diagnostics }
}

const troubleshootingExpected = tokens(TROUBLESHOOTING_FOUNDRY_PROGRAM)
export function parseTroubleshootingFoundrySource(program, configuration) {
  const diagnostics = []
  const actual = typeof program === 'string' ? tokens(program) : null
  if (!actual || actual.length !== troubleshootingExpected.length
    || actual.some((value, index) => value !== troubleshootingExpected[index])) {
    diagnostics.push(diagnostic('UNSUPPORTED_FOUNDRY_SOURCE',
      'The supported validation, managed identity, Responses client and bounded retry loop are required.', programPath))
  }
  const endpoint = configuration?.FoundryEndpoint
  const deployment = configuration?.FoundryDeployment
  if (typeof endpoint !== 'string' || !/^https:\/\/[a-z][a-z0-9-]{1,62}\.services\.ai\.azure\.com\/openai\/v1\/$/.test(endpoint)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_ENDPOINT', 'Use an account resource /openai/v1/ endpoint.', settingsPath))
  }
  if (typeof deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_DEPLOYMENT', 'Use a bounded model deployment name.', settingsPath))
  }
  const maxAttempts = configuration?.TotalAttempts
  const timeoutSeconds = configuration?.TotalBudgetSeconds
  const attemptTimeoutSeconds = configuration?.AttemptTimeoutSeconds
  const honorRetryAfter = configuration?.HonorRetryAfter
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3
    || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 10
    || !Number.isInteger(attemptTimeoutSeconds) || attemptTimeoutSeconds < 1 || attemptTimeoutSeconds > 3
    || attemptTimeoutSeconds > timeoutSeconds || typeof honorRetryAfter !== 'boolean') {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_POLICY',
      'Use 1–3 total attempts, a 1–10 second budget, a 1–3 second attempt cap within the budget, and a boolean Retry-After switch.', settingsPath))
  }
  return { foundry: diagnostics.length ? null : { configured: true, endpoint, deployment,
    method: 'POST', path: '/api/summarize', maxInputLength: 4000, maxAttempts, timeoutSeconds,
    attemptTimeoutSeconds, honorRetryAfter, tokenScope: 'https://ai.azure.com/.default',
    sdkRetries: 0, identity: 'user-assigned' }, diagnostics }
}

const independentExpected = tokens(INDEPENDENT_FOUNDRY_PROGRAM)
const independentStarter = tokens(INDEPENDENT_FOUNDRY_STARTER_FILES[programPath])

export function parseIndependentFoundrySource(program, configuration) {
  const diagnostics = []
  const actual = typeof program === 'string' ? tokens(program) : null
  if (actual && actual.length === independentStarter.length
    && actual.every((value, index) => value === independentStarter[index])) {
    if (Object.keys(configuration ?? {}).sort().join(',') !== 'ListeningPort') diagnostics.push(diagnostic(
      'INVALID_FOUNDRY_CONFIG', 'The starter API cannot configure a brief route.', settingsPath))
    return { foundry: null, diagnostics }
  }
  if (!actual || actual.length !== independentExpected.length
    || actual.some((value, index) => value !== independentExpected[index])) {
    diagnostics.push(diagnostic('UNSUPPORTED_FOUNDRY_SOURCE',
      'The supported brief route, validation, managed identity, Responses client and bounded retry loop are required.', programPath))
  }
  const endpoint = configuration?.FoundryEndpoint
  const deployment = configuration?.FoundryDeployment
  if (typeof endpoint !== 'string' || !/^https:\/\/[a-z][a-z0-9-]{1,62}\.services\.ai\.azure\.com\/openai\/v1\/$/.test(endpoint)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_ENDPOINT', 'Use an account resource /openai/v1/ endpoint.', settingsPath))
  }
  if (typeof deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(deployment)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_DEPLOYMENT', 'Use a bounded model deployment name.', settingsPath))
  }
  const maxAttempts = configuration?.TotalAttempts
  const timeoutSeconds = configuration?.TotalBudgetSeconds
  const attemptTimeoutSeconds = configuration?.AttemptTimeoutSeconds
  const honorRetryAfter = configuration?.HonorRetryAfter
  if (!Number.isInteger(maxAttempts) || maxAttempts < 2 || maxAttempts > 3
    || !Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 8
    || !Number.isInteger(attemptTimeoutSeconds) || attemptTimeoutSeconds < 1 || attemptTimeoutSeconds > 2
    || honorRetryAfter !== true) diagnostics.push(diagnostic('INVALID_FOUNDRY_POLICY',
    'Use 2–3 total attempts, a 5–8 second budget, a 1–2 second attempt cap and HonorRetryAfter=true.', settingsPath))
  return { foundry: diagnostics.length ? null : Object.freeze({ configured: true, contract: 'brief-v1',
    method: 'POST', path: '/api/brief', inputField: 'content', outputField: 'brief', maxInputLength: 4000,
    endpoint, deployment, maxAttempts, timeoutSeconds, attemptTimeoutSeconds, honorRetryAfter,
    tokenScope: 'https://ai.azure.com/.default', sdkRetries: 0, identity: 'user-assigned' }), diagnostics }
}

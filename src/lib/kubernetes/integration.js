import { runDependencyOperation } from './dependency-policy.js'
import { retrieveFixtureRows } from './retrieval.js'

const digest = value => {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return `sha256:${(hash >>> 0).toString(16)}`
}

const failure = (code, message) => ({ code, message })
const asDependencyError = error => ({ dependency: true, code: error.code, http_status: error.status, public_message: error.message })
const result = (status, body, dependencyTrace, diagnostic, integrationTrace) => ({ status, body, dependencyTrace, diagnostic, integrationTrace })
const pythonFalsey = value => value === null || value === undefined || value === false || value === '' || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value ?? {}).length === 0)
const sensitiveKey = key => /(?:password|secret|token|credential|api[_-]?key|connection)/i.test(key ?? '')
const credentialUrl = value => typeof value === 'string' && /[a-z][a-z+.-]*:\/\/[^/\s]*?(?::[^@/\s]+)?@/i.test(value)
const boundedText = value => typeof value === 'string' && value.length <= 128 && !credentialUrl(value) ? value : '[redacted]'

function safeQueryBindings(querySpec, parameters, podSnapshot, parameterNode, nodes) {
  const parameterFor = column => querySpec?.filters?.find(filter => filter.column === column)?.parameter
  const vector = querySpec?.order?.vectorParameter
  const cutoff = querySpec?.distance?.cutoffParameter
  const sensitiveValues = new Set(Object.entries(podSnapshot?.environment ?? {})
    .filter(([key]) => sensitiveKey(key)).map(([, value]) => value).filter(value => typeof value === 'string' && value.length > 0))
  for (const ref of podSnapshot?.configRefs ?? []) if (ref.kind === 'Secret' && ref.mode === 'env') {
    const value = podSnapshot?.environment?.[ref.target]
    if (typeof value === 'string' && value.length > 0) sensitiveValues.add(value)
  }
  const sensitiveOrigin = id => {
    const node = nodes?.get(id)
    if (!node) return true
    if (node.op === 'config') return sensitiveKey(node.key) || sensitiveKey(node.environment)
    if (node.op === 'binding' || node.op === 'vector-format' || node.op === 'strip') return sensitiveOrigin(node.value ?? node.input)
    return false
  }
  const pick = name => {
    if (!name || !Object.hasOwn(parameters ?? {}, name)) return '[redacted]'
    const value = parameters[name]
    const ref = parameterNode?.entries?.[name]
    return sensitiveValues.has(value) || sensitiveOrigin(ref) ? '[redacted]' : value
  }
  return {
    collection: boundedText(pick(parameterFor('collection'))),
    audience: boundedText(pick(parameterFor('audience'))),
    published: typeof pick(parameterFor('published')) === 'boolean' ? pick(parameterFor('published')) : '[redacted]',
    vector: boundedText(pick(vector)),
    cutoff: typeof pick(cutoff) === 'number' && Number.isFinite(pick(cutoff)) ? pick(cutoff) : '[redacted]',
    limit: Number.isInteger(pick(querySpec?.limitParameter)) ? pick(querySpec.limitParameter) : '[redacted]',
  }
}

function policyDescriptor(value) {
  const args = value?.args ?? {}
  const policy = {
    maxAttempts: args.max_attempts,
    retryableCodes: args.retryable_codes,
    baseDelayMs: args.base_delay_ms,
    maxDelayMs: args.max_delay_ms,
    attemptTimeoutMs: args.attempt_timeout_ms,
  }
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 3
    || !Array.isArray(policy.retryableCodes) || policy.retryableCodes.some(code => !['THROTTLED', 'UNAVAILABLE', 'TIMEOUT'].includes(code))
    || !Number.isInteger(policy.baseDelayMs) || policy.baseDelayMs < 0 || policy.baseDelayMs > 500
    || !Number.isInteger(policy.maxDelayMs) || policy.maxDelayMs < 0 || policy.maxDelayMs > 1000
    || !Number.isInteger(policy.attemptTimeoutMs) || policy.attemptTimeoutMs < 1 || policy.attemptTimeoutMs > 1000) return null
  return policy
}

function budgetDescriptor(value) {
  const totalMs = value?.args?.total_ms
  return Number.isInteger(totalMs) && totalMs >= 1 && totalMs <= 5000 ? { totalMs, elapsedMs: 0 } : null
}

function configurationProfile(catalog, endpoint) {
  return Object.values(catalog.profiles ?? {}).find(profile => profile.AI_ENDPOINT === endpoint) ?? null
}

function publicDiagnostic(code) {
  const messages = {
    INTEGRATION_GRAPH_INVALID: 'The captured integration graph is invalid.',
    APP_CONFIGURATION: 'The captured integration configuration is invalid.',
    ASSISTANT_FLOW_INVALID: 'The application does not contain a supported integration flow.',
  }
  return failure(code, messages[code] ?? messages.ASSISTANT_FLOW_INVALID)
}

/** Execute only the bounded graph captured in an integration AppSpec. */
export function simulateIntegration(appSpec, podSnapshot, request, fixtureCatalog, scenarioProfile = 'healthy') {
  const integration = appSpec?.integration
  const graph = integration?.graph
  const trace = []
  const integrationTrace = { version: 1, graphHash: digest(graph ?? null), queryHash: digest(integration?.querySpec ?? null), fixtureVersion: fixtureCatalog?.version ?? null,
    profileId: typeof scenarioProfile === 'string' ? scenarioProfile : null, inputDisposition: null, vectorProvenance: null,
    queryBindings: null, selectedIds: [], contextIds: [], sourceProvenance: null, elapsedMs: 0, attempts: [] }
  if (request?.method !== 'POST' || request?.path !== '/api/ask') return result(404, { error: 'Not found.' }, trace, failure('ROUTE_NOT_FOUND', 'The supplied route does not exist.'), integrationTrace)
  if (!integration || integration.adapter !== 'integration-fixture-v1' || graph?.version !== 1 || !Array.isArray(graph.nodes) || graph.nodes.length > 256 || !Array.isArray(graph.roots?.answer))
    return result(503, { error: 'The supplied assistant dependency is unavailable.' }, trace, publicDiagnostic('INTEGRATION_GRAPH_INVALID'), integrationTrace)
  const script = typeof scenarioProfile === 'string' ? fixtureCatalog?.scenarioProfiles?.[scenarioProfile] : scenarioProfile
  if (!script || typeof script !== 'object') return result(503, { error: 'The supplied assistant dependency is unavailable.' }, trace, publicDiagnostic('APP_CONFIGURATION'), integrationTrace)

  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  if (nodes.size !== graph.nodes.length || graph.nodes.some(node => !node?.id || !node.op)) return result(503, { error: 'The supplied assistant dependency is unavailable.' }, trace, publicDiagnostic('INTEGRATION_GRAPH_INVALID'), integrationTrace)
  const values = new Map()
  const bindings = new Map()
  const tagged = (value, provenance = 'literal') => ({ value, provenance })
  const valueOf = id => {
    const value = evaluate(id)
    return value?.value
  }
  let caught = null
  let returned = null

  const dependency = (operation, policy, budget, invoke) => {
    const response = runDependencyOperation({ operation, policy, budget, script, invoke })
    const entry = { operation, status: response.error ? 'failed' : 'succeeded', attempts: response.attempts.map(attempt => ({ ...attempt })), ...(response.error ? { code: response.error.code } : {}) }
    trace.push(entry); integrationTrace.attempts.push(...entry.attempts)
    integrationTrace.elapsedMs = response.budget.elapsedMs
    if (response.error) throw asDependencyError(response.error)
    return response.value
  }

  const execute = ids => {
    for (const id of ids ?? []) {
      if (returned) break
      evaluate(id)
    }
  }

  const evaluate = id => {
    if (values.has(id)) return values.get(id)
    const node = nodes.get(id)
    if (!node) throw failure('INTEGRATION_GRAPH_INVALID', 'The captured integration graph references an unknown node.')
    let output
    switch (node.op) {
      case 'literal': output = tagged(structuredClone(node.value)); break
      case 'input': output = tagged(request.body?.[node.name], 'input'); break
      case 'binding': output = evaluate(node.value); bindings.set(node.name, output); break
      case 'strip': output = tagged(typeof valueOf(node.input) === 'string' ? valueOf(node.input).trim() : valueOf(node.input), valueOf(node.input) === undefined ? 'literal' : evaluate(node.input).provenance); break
      case 'dictionary': output = tagged(Object.fromEntries(Object.entries(node.entries ?? {}).map(([key, ref]) => [key, valueOf(ref)]))); break
      case 'tuple': output = tagged((node.values ?? []).map(valueOf)); break
      case 'config': {
        if (node.environment) output = tagged(podSnapshot?.environment?.[node.environment] ?? node.defaultValue, 'config')
        else { const object = valueOf(node.object); output = tagged(object?.args?.[node.key] ?? object?.[node.key], 'config') }
        break
      }
      case 'constructor': output = tagged({ class: node.class, args: Object.fromEntries(Object.entries(node.args ?? {}).map(([key, ref]) => [key, valueOf(ref)])) }, 'constructor'); break
      case 'vector-format': {
        const source = evaluate(node.input); const vector = source?.value
        output = tagged(Array.isArray(vector) ? `[${vector.join(',')}]` : vector, source?.provenance ?? 'literal')
        break
      }
      case 'context-rows': {
        const rows = valueOf(node.rows)
        output = tagged(Array.isArray(rows) ? rows.map(row => Object.fromEntries(Object.entries(node.fields ?? {}).map(([key, field]) => [key, row?.[field]]))) : [], 'rows')
        integrationTrace.contextIds = Array.isArray(rows) ? rows.map(row => row.id) : []
        break
      }
      case 'source-ids': {
        const rows = valueOf(node.rows)
        output = tagged(Array.isArray(rows) ? rows.map(row => row?.[node.field]) : [], 'rows')
        integrationTrace.sourceProvenance = 'rows'
        break
      }
      case 'guard': {
        const input = valueOf(node.condition?.input)
        if (node.condition?.kind === 'not' && pythonFalsey(input)) execute(node.then)
        output = tagged(null, 'guard'); break
      }
      case 'return': returned = valueOf(node.value); output = returned; break
      case 'catch-error': output = tagged(caught, 'error'); break
      case 'catch': {
        try { execute(node.attempt) } catch (error) {
          if (!error?.dependency) throw error
          caught = error
          values.delete(node.error)
          execute(node.body)
        }
        output = tagged(null, 'catch'); break
      }
      case 'invoke': {
        const target = valueOf(node.target)
        if (target?.dependency) { output = tagged(target[node.method], 'error'); break }
        if (node.resultType === 'method') { output = tagged({ method: node.method, client: target }, 'method'); break }
        const policy = policyDescriptor(valueOf(node.policy)); const budgetValue = bindings.get('budget')?.value
        const budget = budgetDescriptor(budgetValue)
        if (!policy || !budget) throw failure('APP_CONFIGURATION', 'The integration retry policy or budget is invalid.')
        bindings.set('budget', tagged({ class: 'RequestBudget', args: { total_ms: budget.totalMs } }, 'constructor'))
        // Preserve the shared logical clock created by the first operation.
        const storedBudget = values.get('__budget')?.value ?? budget
        values.set('__budget', tagged(storedBudget, 'constructor'))
        const args = Object.fromEntries(Object.entries(node.args?.keywords ?? {}).map(([key, ref]) => [key, evaluate(ref)]))
        if (node.method === 'embed') {
          const client = target?.client?.value ?? target?.client
          const profile = configurationProfile(fixtureCatalog, podSnapshot?.environment?.AI_ENDPOINT)
          const deployment = args.deployment?.value
          const question = args.question?.value
          const vector = dependency('embedding', policy, storedBudget, () => {
            if (!profile || client?.args?.endpoint !== profile.AI_ENDPOINT) throw failure('AI_ENDPOINT', 'The configured AI endpoint is not available in this trainer.')
            if (client?.args?.sdk_retries !== 0) throw failure('APP_CONFIGURATION', 'Adapter retries must be disabled.')
            if (deployment !== profile.EMBEDDING_DEPLOYMENT) throw failure('AI_DEPLOYMENT', 'The configured AI deployment is not available in this trainer.')
            const fixture = fixtureCatalog.questions?.[question]
            if (!fixture) throw failure('UNSUPPORTED_FIXTURE_INPUT', 'This question is outside the local training fixture.')
            return fixture.embedding
          })
          output = tagged(vector, 'embedding'); break
        }
        if (node.method === 'execute') {
          const client = target?.client?.value ?? target?.client
          const profile = configurationProfile(fixtureCatalog, podSnapshot?.environment?.AI_ENDPOINT)
          const params = args.params?.value
          const parameterNode = nodes.get(node.args?.keywords?.params)
          const vectorNode = parameterNode?.entries?.[integration.querySpec?.order?.vectorParameter]
          integrationTrace.vectorProvenance = vectorNode ? evaluate(vectorNode).provenance : null
          integrationTrace.queryBindings = safeQueryBindings(integration.querySpec, params, podSnapshot, parameterNode, nodes)
          const retrieval = dependency('postgres-query', policy, storedBudget, () => {
            if (!profile || client?.args?.host !== profile.PGHOST || client?.args?.database !== profile.PGDATABASE) throw failure('POSTGRES_CONNECTION', 'The configured PostgreSQL host is not available in this trainer.')
            if (client?.args?.user !== profile.PGUSER || client?.args?.password !== profile.PGPASSWORD) throw failure('POSTGRES_AUTH', 'The configured PostgreSQL credentials were not available in this trainer.')
            if (client?.args?.sdk_retries !== 0) throw failure('APP_CONFIGURATION', 'Adapter retries must be disabled.')
            const rows = retrieveFixtureRows(integration.querySpec, params, fixtureCatalog.documents)
            if (rows.diagnostic) throw failure(rows.diagnostic.code === 'SQL_VECTOR_INVALID' ? 'VECTOR_DIMENSION' : 'QUERY_PARAMETERS', 'The retrieval query has invalid or missing parameters.')
            integrationTrace.selectedIds = rows.selectedIds
            return rows.rows
          })
          output = tagged(retrieval, 'rows'); break
        }
        if (node.method === 'generate') {
          const client = target?.client?.value ?? target?.client
          const profile = configurationProfile(fixtureCatalog, podSnapshot?.environment?.AI_ENDPOINT)
          const context = args.context?.value
          const deployment = args.deployment?.value
          const question = args.question?.value
          const answer = dependency('answer', policy, storedBudget, () => {
            if (!profile || client?.args?.endpoint !== profile.AI_ENDPOINT) throw failure('AI_ENDPOINT', 'The configured AI endpoint is not available in this trainer.')
            if (client?.args?.sdk_retries !== 0) throw failure('APP_CONFIGURATION', 'Adapter retries must be disabled.')
            if (deployment !== profile.ANSWER_DEPLOYMENT) throw failure('AI_DEPLOYMENT', 'The configured AI deployment is not available in this trainer.')
            const answers = fixtureCatalog.questions?.[question]?.answers
            if (!Array.isArray(context) || !context.length || !answers || context.some(row => fixtureCatalog.documents?.[row.id]?.content !== row.content || !Object.hasOwn(answers, row.id))) throw failure('UNSUPPORTED_FIXTURE_CONTEXT', 'This context is outside the local training fixture.')
            const answer = answers[context[0].id]
            return { answer }
          })
          output = tagged(answer, 'answer'); break
        }
        throw failure('INTEGRATION_GRAPH_INVALID', 'The captured integration graph invokes an unsupported operation.')
      }
      default: throw failure('INTEGRATION_GRAPH_INVALID', 'The captured integration graph contains an unsupported node.')
    }
    values.set(id, output)
    return output
  }

  try {
    execute(graph.roots.answer)
    const response = returned?.value ?? returned
    if (!response || !Number.isInteger(response.status) || !response.body || typeof response.body !== 'object') throw publicDiagnostic('ASSISTANT_FLOW_INVALID')
    integrationTrace.inputDisposition = response.status === 400 ? 'rejected' : 'accepted'
    return result(response.status, response.body, trace, null, integrationTrace)
  } catch (error) {
    const diagnostic = error?.code ? error : publicDiagnostic('ASSISTANT_FLOW_INVALID')
    const status = error?.http_status ?? 503
    integrationTrace.elapsedMs = values.get('__budget')?.value?.elapsedMs ?? integrationTrace.elapsedMs
    return result(status, { error: error?.public_message ?? 'The supplied assistant dependency is unavailable.', ...(error?.code ? { code: error.code } : {}) }, trace, diagnostic, integrationTrace)
  }
}

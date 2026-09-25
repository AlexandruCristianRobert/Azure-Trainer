function result(status, code, message, trace = [], body = { error: 'The supplied assistant dependency is unavailable.' }) {
  return { status, body, dependencyTrace: trace, diagnostic: { code, message } }
}
function resolve(expression, snapshot) {
  if (expression?.kind === 'literal') return expression.value
  if (expression?.kind === 'config') return snapshot.environment?.[expression.key] ?? expression.defaultValue
  if (expression?.kind === 'file-json') {
    const source = snapshot.files?.[expression.path]
    if (typeof source !== 'string') return { error: 'CONFIG_FILE_MISSING' }
    try { return JSON.parse(source)?.[expression.key] } catch { return { error: 'CONFIG_FILE_INVALID' } }
  }
  return undefined
}
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0)
const norm = a => Math.sqrt(dot(a, a))
function vectorValid(vector) { return Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite) }

export function simulateAssistant(appSpec, podSnapshot, request, fixtureCatalog) {
  const trace = []
  if (request?.method !== 'POST' || request?.path !== '/api/ask') return result(404, 'ROUTE_NOT_FOUND', 'The supplied route does not exist.', trace, { error: 'Not found.' })
  const route = appSpec?.routes?.find(item => item.method === 'POST' && item.path === '/api/ask')
  if (!appSpec?.assistant || appSpec.assistant.adapter !== 'knowledge-fixture-v1' || appSpec.assistant.helperValid === false) return result(503, 'ASSISTANT_HELPER_INVALID', 'The fixed training helper is missing or changed.')
  if (!route || route.response?.kind !== 'assistant') return result(503, 'ASSISTANT_FLOW_INVALID', 'The application does not call the supplied assistant adapter.')
  const question = typeof request.body?.question === 'string' ? request.body.question.trim() : ''
  if (!question) return result(400, 'QUESTION_REQUIRED', 'Enter a question before asking.', trace, { error: 'A question is required.' })
  const settings = Object.fromEntries(Object.entries(route.response.settings ?? {}).map(([key, expression]) => [key, resolve(expression, podSnapshot)]))
  const fileError = Object.values(settings).find(value => value?.error)
  if (fileError) return result(503, fileError.error, fileError.error === 'CONFIG_FILE_MISSING' ? 'The mounted settings file is missing.' : 'The mounted settings file is not valid JSON.', trace)
  const profile = Object.values(fixtureCatalog.profiles).find(item => item.AI_ENDPOINT === settings.ai_endpoint)
  if (!profile) return result(502, 'AI_ENDPOINT', 'The configured AI endpoint is unavailable.', trace)
  if (settings.embedding_deployment !== profile.EMBEDDING_DEPLOYMENT) return result(502, 'AI_DEPLOYMENT', 'The configured embedding deployment is unavailable.', trace)
  const questionFixture = fixtureCatalog.questions[question]
  if (!questionFixture) return result(400, 'QUESTION_UNSUPPORTED', 'This question is outside the supplied fixture catalog.', trace, { error: 'Unsupported supplied question.' })
  if (!vectorValid(questionFixture.vector)) return result(503, 'EMBEDDING_INVALID', 'The supplied embedding fixture is invalid.', trace)
  trace.push({ operation: 'embedding', status: 'succeeded', endpoint: settings.ai_endpoint, deployment: settings.embedding_deployment, question })
  if (settings.pg_host !== profile.PGHOST || settings.pg_database !== profile.PGDATABASE) return result(503, 'POSTGRES_CONNECTION', 'The configured PostgreSQL host or database is unavailable.', trace)
  if (settings.pg_user !== profile.PGUSER || settings.pg_password !== profile.PGPASSWORD) return result(503, 'POSTGRES_AUTH', 'The configured PostgreSQL credentials were rejected.', trace)
  const candidates = Object.entries(fixtureCatalog.documents)
    .filter(([, document]) => document.collection === settings.collection && vectorValid(document.vector))
    .map(([id, document]) => ({ id, document, score: dot(questionFixture.vector, document.vector) / (norm(questionFixture.vector) * norm(document.vector)) }))
    .filter(item => Number.isFinite(item.score)).sort((a, b) => b.score - a.score)
  const selected = candidates.slice(0, 1)
  trace.push({ operation: 'postgres-query', status: 'succeeded', collection: settings.collection, selectedSourceIds: selected.map(item => item.id), limit: 1 })
  if (!selected.length) return { status: 200, body: { answer: 'No matching documents.', sources: [], environment: settings.environment, displayName: settings.display_name }, dependencyTrace: trace, diagnostic: null }
  if (settings.answer_deployment !== profile.ANSWER_DEPLOYMENT) return result(502, 'AI_DEPLOYMENT', 'The configured answer deployment is unavailable.', trace)
  const expectedDocument = questionFixture.sourceIds[settings.collection]
  if (selected[0].id !== expectedDocument) return { status: 200, body: { answer: 'No matching documents.', sources: [], environment: settings.environment, displayName: settings.display_name }, dependencyTrace: trace, diagnostic: null }
  trace.push({ operation: 'answer', status: 'succeeded', deployment: settings.answer_deployment, selectedSourceIds: [selected[0].id] })
  const answer = questionFixture.answers[settings.collection]
  return { status: 200, body: { answer: `${settings.response_prefix}${answer}`, sources: [selected[0].id], environment: settings.environment, displayName: settings.display_name }, dependencyTrace: trace, diagnostic: null }
}

import { POSTGRES_POOL_CLIENTS } from '../../templates/data-python/postgres.js'
import { POSTGRES_INDEPENDENT_FILES, POSTGRES_INDEPENDENT_MANIFEST } from '../../templates/data-python/postgres-independent.js'
import { SUPPORT_V3_QUESTIONS } from '../../fixtures/data/corpus-v3.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { parsePgSql } from '../../../lib/data/pg-sql.js'
import { seedPostgresIndependent } from './postgres-seeds.js'
import { PG_GROUP, PG_SERVER, PG_DATABASE, PG_REGISTRY, PG_TARGET, PG_DATA_TARGET, PG_SCHEMA_SQL, PG_HNSW_SQL,
  PG_ESTIMATE_LABEL, pgSqlCommand, pgVectorAppSource, pgRequestScenario, pgLoadScenario, pgTask,
  pgDeployedArtifact, pgDeployedFunctionsCurrent, pgDsnPort } from './postgres-helpers.js'

const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const sql = text => command(pgSqlCommand(`-c "${text}"`))
const base = pgVectorAppSource()
// Optimized base RAG remains available. New audience arguments are accepted
// by the paired HTTP scaffold, but these edit zones have not implemented them.
const STARTER_APP = base.replaceAll('question, product, version, language):', 'question, product, version, language, audience=None):')
  .replace(/    # Route args:[\s\S]*?(?=def retrieve_passages)/,
    '    with connect() as conn:\n        return conn.execute("SELECT id, product, version, language, metadata FROM documents WHERE product = %s AND version = %s ORDER BY id LIMIT 5", (product, version)).fetchall()\n\n\n')
const FINAL_APP = base.replaceAll('question, product, version, language):', 'question, product, version, language, audience=None):')
  .replace('d.language = %s AND c.embedding', 'd.language = %s AND d.metadata @> %s AND c.embedding')
  .replace('(embedding, product, version, language, embedding, embedding)', '(embedding, product, version, language, Jsonb({"audience": audience}), embedding, embedding)')
  .replace('retrieve_passages(question, product, version, language)', 'retrieve_passages(question, product, version, language, audience)')
const CLIENTS = POSTGRES_POOL_CLIENTS.replace('port=5432', 'port=6432')
const DEPLOYMENT = POSTGRES_INDEPENDENT_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:pg-independent')
const args = question => [question.text, question.product, question.version, question.language, question.audience]
const retrievalSteps = SUPPORT_V3_QUESTIONS.map(question => ({ route: 'GET /retrieve', args: args(question) }))
const metadataSteps = SUPPORT_V3_QUESTIONS.map(question => ({ route: 'GET /documents',
  args: [question.product, question.version, { product: question.product, version: question.version, language: question.language, audience: question.audience }] }))
const deploy = [file('app.py', FINAL_APP), file('clients.py', CLIENTS),
  command(`az acr build --registry ${PG_REGISTRY} --image assistant:pg-independent .`),
  file('k8s/deployment.yaml', DEPLOYMENT), command('kubectl apply -f k8s/deployment.yaml'),
  command('kubectl rollout restart deployment/assistant-api -n assistant'),
  command('kubectl scale deployment/assistant-api -n assistant --replicas 6')]
const parameter = (name, value) => command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name ${PG_SERVER} --name ${name} --value ${value}`)
const ready = [command(pgSqlCommand('-f load-v3.sql')),
  command(`az postgres flexible-server update -g ${PG_GROUP} -n ${PG_SERVER} --tier GeneralPurpose --sku-name Standard_D2ds_v5`),
  parameter('maintenance_work_mem', 65536), parameter('max_connections', 50), parameter('pgbouncer.enabled', 'true'), parameter('pgbouncer.default_pool_size', 20),
  sql(PG_HNSW_SQL), sql('CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops)'), ...deploy]
const server = context => context.sandbox.postgresServers?.find(item => item.name === PG_SERVER && item.resourceGroup === PG_GROUP)
const database = context => server(context)?.databases.find(item => item.name === PG_DATABASE)
const proof = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]?.measurements
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
function learnerDeployed(context, names) {
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  const first = Object.values(context.artifacts.buildsById).sort((left, right) => Number(left.id.slice(6)) - Number(right.id.slice(6)))[0]
  return !!artifact && artifact.id !== first?.id
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_INDEPENDENT_MANIFEST))
    && pgDeployedFunctionsCurrent(context, [...names, 'connect'])
}
function groundedStep(measurements, stepIndex, ids) {
  const value = measurements?.values?.[stepIndex]
  const calls = (measurements?.calls ?? []).filter(call => call.stepIndex === stepIndex)
  // Additional successful SQL is allowed. Ground the response in a SELECT
  // from this request step, retaining every call for errors/latency/load mode.
  const selects = calls.filter(call => call.plan && same(call.rows, value))
  return measurements?.status === 200 && Array.isArray(value) && same(value.map(row => row.id), ids)
    && selects.length > 0 && calls.every(call => !call.error)
    ? { value, calls, selects } : null
}
function v3Retrieval(context) {
  const m = proof(context, 'v3-retrieval')
  return learnerDeployed(context, ['retrieve_passages']) && SUPPORT_V3_QUESTIONS.every((question, stepIndex) => {
    const step = groundedStep(m, stepIndex, question.expectedChunkIds)
    return !!step && step.value.every(row => row.product === question.product && row.version === question.version
      && row.language === question.language && row.metadata?.audience === question.audience)
      && step.selects.some(select => select.plan.recall >= 0.95)
      && step.calls.reduce((sum, call) => sum + call.latencyMs, 0) <= 20
  })
}
function audienceIndexed(context) {
  const m = proof(context, 'audience-indexed')
  return learnerDeployed(context, ['search_by_metadata']) && SUPPORT_V3_QUESTIONS.every((question, stepIndex) => {
    const step = groundedStep(m, stepIndex, [17 + stepIndex])
    if (!step || !step.value.every(row => row.metadata?.audience === question.audience && row.language === question.language
      && row.product === question.product && row.version === question.version)) return false
    const audienceExpr = expression => expression?.kind === 'column' && expression.name === 'audience'
      || expression?.kind === 'json-extract' && expression.key === 'audience' && expression.column?.name === 'metadata'
    return step.selects.some(select => {
      const index = database(context)?.indexes.find(index => index.name === select.plan.index && index.table === 'documents')
      const parsed = parsePgSql(select.sql)
      if (!index || parsed.error) return false
      return parsed.statements.some(stmt => stmt.kind === 'select' && (
        index.method === 'gin' && index.columns.some(column => column.name === 'metadata')
          && stmt.where.some(condition => condition.operator === '@>' && condition.expression?.name === 'metadata')
        || index.method === 'btree' && audienceExpr(index.columns[0].expression ?? { kind: 'column', name: index.columns[0].name })
          && stmt.where.some(condition => condition.operator === '=' && audienceExpr(condition.expression))))
    })
  })
}
function scaleStable(context) {
  const m = proof(context, 'scale-stable')
  const step = groundedStep(m, 0, SUPPORT_V3_QUESTIONS[0].expectedChunkIds)
  if (!learnerDeployed(context, ['retrieve_passages']) || !step || m.replicas !== 6 || m.failed !== 0
    || m.errors.length || m.throughputRps < 1000 || m.served !== 30000) return false
  const port = pgDsnPort(pgDeployedArtifact(context, PG_TARGET)?.appSpec)
  const calls = step.calls.filter(call => typeof call.sql === 'string')
  const pooled = calls.every(call => call.poolLifetime === 'module' && call.poolMaxSize === m.poolMaxSize)
  return port === 5432 && m.mode === 'pool' && pooled && calls.every(call => call.connection === 'pooled')
    || port === 6432 && m.mode === 'pgbouncer' && server(context).parameters['pgbouncer.enabled'] === 'true'
      && calls.every(call => call.connection === 'bouncer') && pooled
}
const tables = ['pg:table:chunks', 'pg:table:documents', 'pg:rows:chunks', 'pg:rows:documents']
const connection = ['images:assistant-api', 'code:assistant-api:connect', 'dsnPort:assistant-api', 'pg:param:pgbouncer.enabled']
const retrieval = [...tables, ...connection, 'code:assistant-api:retrieve_passages', 'pg:index:chunks', 'pg:sku', 'pg:param:hnsw.ef_search', 'pg:param:hnsw.iterative_scan', 'pg:param:ivfflat.probes']
const metadata = ['pg:table:documents', 'pg:rows:documents', ...connection, 'code:assistant-api:search_by_metadata', 'pg:index:documents']

export const postgresIndependentLab = {
  id: 'data-postgres-independent', title: 'Independent: Onboard PostgreSQL v3 audiences',
  brief: 'Onboard contoso-support v3 in German and English with metadata audience admin or user. Retrieval for each product/version/language/audience combination must return the expected chunks with recall at least 0.95 and p95 at most 20ms. Metadata lookups by audience must use an index. Six replicas must sustain 1000 requests/second with zero failures. The independent seed reproduces the Lab 7 base state and supplies protected load-v3.sql; v3 onboarding and audience handling remain unfinished. ' + PG_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 9,
  labMode: 'independent', skillAreaId: 'data', service: 'postgresql', status: 'available', manifestId: POSTGRES_INDEPENDENT_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true }, dataTarget: PG_DATA_TARGET,
  initialProjectFiles: { ...POSTGRES_INDEPENDENT_FILES, 'app.py': STARTER_APP, 'clients.py': CLIENTS, 'schema.sql': PG_SCHEMA_SQL },
  solutionFiles: { ...POSTGRES_INDEPENDENT_FILES, 'app.py': FINAL_APP, 'clients.py': CLIENTS, 'schema.sql': PG_SCHEMA_SQL, 'k8s/deployment.yaml': DEPLOYMENT },
  initializeSimulation: seedPostgresIndependent,
  stages: [{ id: 'retrieval', title: 'Onboard v3 retrieval', taskIds: ['v3-retrieval'] },
    { id: 'metadata', title: 'Index audience lookups', taskIds: ['audience-indexed'] },
    { id: 'load', title: 'Sustain six-replica throughput', taskIds: ['scale-stable'] }],
  scenarios: { 'v3-retrieval': pgRequestScenario(retrievalSteps), 'audience-indexed': pgRequestScenario(metadataSteps),
    'load-1000rps': pgLoadScenario({ args: args(SUPPORT_V3_QUESTIONS[0]), requestsPerSecond: 1000 }) },
  tasks: [
    pgTask({ id: 'v3-retrieval', stageId: 'retrieval', text: 'Retrieve the expected v3 chunks for all four audience/language combinations, recall ≥0.95 and p95 ≤20ms.',
      explanation: 'The check compares each actual SQL result with its returned rows and declared expected IDs. Any supported indexing and tuning design that meets the thresholds passes. The Solution is one valid HNSW/iterative-scan design. ' + PG_ESTIMATE_LABEL,
      hints: ['Inspect the supplied v3 fixtures and deployed request evidence.'], examNote: 'Metadata filtering must preserve the intended audience and language.',
      fields: retrieval, verification: { scenarioId: 'v3-retrieval', scenarioVersion: 1 }, check: v3Retrieval,
      solution: { steps: [...ready, scenario('v3-retrieval')] } }),
    pgTask({ id: 'audience-indexed', stageId: 'metadata', text: 'Make actual audience metadata lookups use an index.',
      explanation: 'A B-tree on an audience column/expression or a GIN on metadata can meet this outcome. The Solution binds JSON containment and uses the supplied metadata GIN; index names are unrestricted.',
      hints: ['Read the lookup rows and selected SQL plan.'], examNote: 'Index the predicate the application actually executes.',
      fields: metadata, verification: { scenarioId: 'audience-indexed', scenarioVersion: 1 }, check: audienceIndexed,
      solution: { steps: [...ready, scenario('v3-retrieval'), scenario('audience-indexed')] } }),
    pgTask({ id: 'scale-stable', stageId: 'load', text: 'Sustain 1000rps at six explicit replicas with zero failures.',
      explanation: 'Measured load must come from the deployed module pool or PgBouncer connection used by actual SQL. The Solution applies a two-replica manifest, then explicitly scales to six and refreshes earlier proofs. ' + PG_ESTIMATE_LABEL,
      hints: ['Compare replica count, served throughput, failures and captured connection mode.'], examNote: 'Size connection capacity across every replica.',
      fields: [...retrieval, 'replicas:assistant-api', 'pg:param:max_connections', 'pg:param:pgbouncer.default_pool_size'],
      verification: { scenarioId: 'load-1000rps', scenarioVersion: 1 }, check: scaleStable,
      solution: { steps: [...ready, scenario('v3-retrieval'), scenario('audience-indexed'), scenario('load-1000rps')] } }),
  ],
}

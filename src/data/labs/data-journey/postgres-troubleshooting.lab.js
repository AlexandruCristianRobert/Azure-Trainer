import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES, POSTGRES_NAIVE_CLIENTS, POSTGRES_POOL_CLIENTS } from '../../templates/data-python/postgres.js'
import { corpusQuestions } from '../../fixtures/data/corpus.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { parsePgSql } from '../../../lib/data/pg-sql.js'
import { seedPostgresTroubleshooting } from './postgres-seeds.js'
import { PG_GROUP, PG_SERVER, PG_DATABASE, PG_REGISTRY, PG_TARGET, PG_DATA_TARGET, PG_SCHEMA_SQL, PG_HNSW_SQL,
  PG_ESTIMATE_LABEL, pgSqlCommand, pgVectorAppSource, pgRequestScenario, pgLoadScenario, pgTask,
  pgDeployedArtifact, pgDeployedFunctionsCurrent, pgDsnPort } from './postgres-helpers.js'

const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const sql = text => command(pgSqlCommand(`-c "${text}"`))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const QUESTION = corpusQuestions()[0]
const QUOTED = "What's the retention window?"
const LOW_APP = pgVectorAppSource({ efSearch: 4, iterativeScan: 'off' })
const FINAL_APP = pgVectorAppSource()
// Only the retrieval edit zone is faulty: its SQL interpolates user text.
// The exclusion is otherwise harmless for the authored question corpus.
const start = LOW_APP.indexOf('def retrieve_passages(')
const end = LOW_APP.indexOf('def build_context(')
const FAULTY_APP = LOW_APP.slice(0, start) + LOW_APP.slice(start, end)
  .replaceAll('conn.execute("SELECT', 'conn.execute(f"SELECT')
  .replaceAll('WHERE ', "WHERE c.content <> '{question}' AND ") + LOW_APP.slice(end)
const BOUNCER_CLIENTS = POSTGRES_POOL_CLIENTS.replace('port=5432', 'port=6432')
const DEPLOYMENT = POSTGRES_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:pg-troubleshooting')
const scale = command('kubectl scale deployment/assistant-api -n assistant --replicas 6')
const parameter = (name, value) => command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name ${PG_SERVER} --name ${name} --value ${value}`)
const sizing = [command(`az postgres flexible-server update -g ${PG_GROUP} -n ${PG_SERVER} --tier GeneralPurpose --sku-name Standard_D2ds_v5`), parameter('maintenance_work_mem', 65536)]
const dropIndex = sql('DROP INDEX IF EXISTS chunks_embedding_hnsw')
const ready = [...sizing, dropIndex, sql(PG_HNSW_SQL)]
const maintenanceIncident = [dropIndex, command(`az postgres flexible-server update -g ${PG_GROUP} -n ${PG_SERVER} --tier Burstable --sku-name Standard_B1ms`), parameter('maintenance_work_mem', 1024)]
const deploy = (app, clients = POSTGRES_NAIVE_CLIENTS) => [file('app.py', app), file('clients.py', clients),
  command(`az acr build --registry ${PG_REGISTRY} --image assistant:pg-troubleshooting .`),
  file('k8s/deployment.yaml', DEPLOYMENT), command('kubectl apply -f k8s/deployment.yaml'),
  command('kubectl rollout restart deployment/assistant-api -n assistant'), scale]
const refresh = [scenario('question-with-quote'), scenario('retrieve-latency'), scenario('index-rebuilt')]
const server = context => context.sandbox.postgresServers?.find(item => item.name === PG_SERVER && item.resourceGroup === PG_GROUP)
const database = context => server(context)?.databases.find(item => item.name === PG_DATABASE)
const proof = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]?.measurements
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const selects = measurements => (measurements?.calls ?? []).filter(call => call.plan)
function learnerDeployed(context) {
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  const seedArtifact = Object.values(context.artifacts.buildsById).sort((left, right) => Number(left.id.slice(6)) - Number(right.id.slice(6)))[0]
  return !!artifact && artifact.id !== seedArtifact?.id
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_MANIFEST))
    && pgDeployedFunctionsCurrent(context, ['retrieve_passages', 'connect'])
}
function actualRows(context, id, expected, ann = true) {
  const m = proof(context, id)
  const calls = selects(m)
  const index = database(context)?.indexes.find(index => index.name === calls[0]?.plan.index)
  return learnerDeployed(context) && m?.status === 200 && Array.isArray(m.value)
    && same(m.value.map(row => row.id), expected) && calls.length === 1
    && same(calls[0].rows, m.value) && (m.calls ?? []).every(call => !call.error)
    && (!ann || index?.method === 'hnsw' && index.table === 'chunks' && index.columns.length === 1
      && index.columns[0].name === 'embedding' && index.columns[0].opclass === 'vector_cosine_ops')
}
function quoteSafe(context) {
  // The unknown quote-bearing question has a zero fixture vector and no
  // matching rows. A successful actual SQL execution must vouch for [].
  return actualRows(context, 'quote-safe', [], false)
}
function latencyRestored(context) {
  const m = proof(context, 'latency-restored')
  return actualRows(context, 'latency-restored', [17, 9])
    && m.calls.reduce((sum, call) => sum + call.latencyMs, 0) < 100
}
function indexRebuilt(context) {
  const chunks = database(context)?.tables.find(table => table.name === 'chunks')
  const dimensions = chunks?.columns.find(column => column.name === 'embedding')?.dimensions
  return actualRows(context, 'index-rebuilt', [17, 9]) && ['GeneralPurpose', 'MemoryOptimized'].includes(server(context)?.tier)
    && server(context).vCores >= 2 && Number(server(context).parameters.maintenance_work_mem) >= chunks.logicalRows * dimensions * 4 * 1.6 / 1024
}
function filteredComplete(context) {
  const m = proof(context, 'filtered-complete')
  return actualRows(context, 'filtered-complete', [1, 2])
    && m.value.every(row => row.product === QUESTION.product && row.version === QUESTION.version && row.language === QUESTION.language)
    && m.calls.some(call => {
      const parsed = parsePgSql(call.sql)
      return !parsed.error && parsed.statements.some(stmt => stmt.kind === 'set' && stmt.name === 'hnsw.iterative_scan'
        && ['strict_order', 'relaxed_order'].includes(stmt.value))
    })
}
function loadStable(context) {
  const m = proof(context, 'load-stable')
  const calls = (m?.calls ?? []).filter(call => typeof call.sql === 'string')
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  const port = pgDsnPort(artifact?.appSpec)
  const k = m?.poolMaxSize
  return actualRows(context, 'load-stable', [1, 2]) && m.replicas === 6 && m.failed === 0 && m.errors.length === 0 && m.p95Ms <= 12
    && Number(server(context)?.parameters.max_connections) === 50 && Number.isInteger(k) && k > 0 && 6 * k <= 47
    && calls.length > 0 && calls.every(call => call.poolLifetime === 'module' && call.poolMaxSize === k)
    && (port === 5432 && m.mode === 'pool' && calls.every(call => call.connection === 'pooled')
      || port === 6432 && m.mode === 'pgbouncer' && server(context).parameters['pgbouncer.enabled'] === 'true'
      && calls.every(call => call.connection === 'bouncer'))
}
const tables = ['pg:table:chunks', 'pg:table:documents']
const retrieval = [...tables, 'code:assistant-api:retrieve_passages', 'pg:index:chunks']
const request = args => pgRequestScenario([{ route: 'GET /retrieve', args }])
const filteredArgs = [QUESTION.text, QUESTION.product, QUESTION.version, QUESTION.language]

export const postgresTroubleshootingLab = {
  id: 'data-postgres-troubleshooting', title: 'Troubleshooting: Recover PostgreSQL retrieval',
  brief: 'An independently supplied Knowledge Assistant has five incident reports: a question containing an apostrophe returns a SQL syntax error; retrieval exceeds the 100ms budget; a later maintenance rebuild cannot finish; filtered retrieval can return fewer than two passages; and load-600rps reports too many clients. Diagnose from deployed code, SQL rows/plans and server settings. Investigate the latency incident first. The separate maintenance stage enacts its incident using visible Cloud Shell commands, then asks you to recover; it is not simultaneously the latency incident. No verification evidence is supplied. ' + PG_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 8,
  labMode: 'troubleshooting', skillAreaId: 'data', service: 'postgresql', status: 'available', manifestId: POSTGRES_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true }, dataTarget: PG_DATA_TARGET,
  initialProjectFiles: { ...POSTGRES_STARTER_FILES, 'app.py': FAULTY_APP, 'clients.py': POSTGRES_NAIVE_CLIENTS, 'schema.sql': PG_SCHEMA_SQL },
  solutionFiles: { ...POSTGRES_STARTER_FILES, 'app.py': FINAL_APP, 'clients.py': BOUNCER_CLIENTS, 'schema.sql': PG_SCHEMA_SQL, 'k8s/deployment.yaml': DEPLOYMENT },
  initializeSimulation: seedPostgresTroubleshooting,
  stages: [
    { id: 'quote', title: 'Recover quote-bearing questions', taskIds: ['quote-safe'] },
    { id: 'latency', title: 'Restore retrieval latency', taskIds: ['latency-restored'] },
    { id: 'maintenance', title: 'Enact the separate maintenance incident and rebuild', taskIds: ['index-rebuilt'] },
    { id: 'filters', title: 'Recover complete filtered retrieval', taskIds: ['filtered-complete'] },
    { id: 'load', title: 'Recover six-replica load', taskIds: ['load-stable'] },
  ],
  scenarios: {
    'question-with-quote': request([QUOTED, QUESTION.product, QUESTION.version, QUESTION.language]),
    'retrieve-latency': request([QUESTION.text, null, null, null]),
    'index-rebuilt': request([QUESTION.text, null, null, null]),
    'retrieve-filtered': request(filteredArgs),
    'load-600rps': pgLoadScenario({ args: filteredArgs, requestsPerSecond: 600 }),
  },
  tasks: [
    pgTask({ id: 'quote-safe', stageId: 'quote', text: 'Make question-with-quote succeed with actual SQL retrieval.',
      explanation: 'The deployed retrieval interpolates the question into an f-string SQL exclusion. An apostrophe terminates the SQL string. Remove that unnecessary exclusion and bind vectors/filters with psycopg parameters. The quote-bearing question is unknown to the fixed fixture, so successful retrieval returns an empty list rather than a fabricated answer.',
      hints: ['Inspect retrieve_passages and the SQL error reported by question-with-quote.', 'Use %s placeholders with separate arguments. Build/deploy the repaired app before verification.'],
      examNote: 'Bind SQL parameters separately; string interpolation is unsafe and breaks on quoted user text.',
      fields: [...tables, 'code:assistant-api:retrieve_passages'], verification: { scenarioId: 'question-with-quote', scenarioVersion: 1 }, check: quoteSafe,
      solution: { steps: [...deploy(LOW_APP), scenario('question-with-quote')] } }),
    pgTask({ id: 'latency-restored', stageId: 'latency', text: 'Restore retrieve-latency to cosine HNSW and total latency below 100ms.',
      explanation: 'The existing index uses vector_l2_ops but the app orders with <=>, so PostgreSQL cannot use it for cosine search. Inspect the plan, restore compute/build memory, drop the mismatched index and create vector_cosine_ops. Verify actual global rows [17,9]. This repair does not yet fix the low candidate budget used for metadata filtering. ' + PG_ESTIMATE_LABEL,
      hints: ['Match <=> with vector_cosine_ops; CREATE IF NOT EXISTS cannot replace an existing L2 definition.', 'Use GeneralPurpose Standard_D2ds_v5 and maintenance_work_mem=65536 kB before rebuilding.'],
      examNote: 'An ANN index opclass must match the query distance operator.',
      fields: [...retrieval, 'images:assistant-api', 'dsnPort:assistant-api', 'pg:param:pgbouncer.enabled'],
      verification: { scenarioId: 'retrieve-latency', scenarioVersion: 1 }, check: latencyRestored,
      solution: { steps: [...ready, ...deploy(LOW_APP), scenario('question-with-quote'), scenario('retrieve-latency')] } }),
    pgTask({ id: 'index-rebuilt', stageId: 'maintenance', text: 'Enact the maintenance incident, then restore a working cosine HNSW index.',
      explanation: 'This separate stage starts with visible commands: DROP INDEX IF EXISTS chunks_embedding_hnsw; scale to Burstable Standard_B1ms; set maintenance_work_mem=1024 kB. Try CREATE INDEX to observe the build-budget error. Recover with GeneralPurpose (at least two vCores), enough build memory, and a cosine HNSW index. The graph needs 12,500 kB under the declared formula. The Solution includes incident enactment and recovery; no hidden state switch is used. ' + PG_ESTIMATE_LABEL,
      hints: ['Run the three maintenance commands described above after diagnosing latency; the two incidents occur at different times.', 'Restore Standard_D2ds_v5 and maintenance_work_mem=65536, create cosine HNSW, then run index-rebuilt and refresh retrieval proofs.'],
      examNote: 'HNSW builds need sufficient maintenance_work_mem and sustained compute.',
      fields: [...retrieval, 'pg:sku', 'pg:param:maintenance_work_mem'], verification: { scenarioId: 'index-rebuilt', scenarioVersion: 1 }, check: indexRebuilt,
      solution: { steps: [...maintenanceIncident, ...ready, ...deploy(LOW_APP), ...refresh] } }),
    pgTask({ id: 'filtered-complete', stageId: 'filters', text: 'Make retrieve-filtered return both matching passages [1,2].',
      explanation: 'After cosine HNSW is available, ef_search=4 with iterative_scan=off can under-fill the SQL LIMIT after product/version/language filtering. Increase the candidate budget and enable iterative scans within every retrieval transaction. Join documents for metadata filters and return the SQL-produced rows. Refresh earlier verifications after editing shared retrieval. ' + PG_ESTIMATE_LABEL,
      hints: ['Inspect the actual filtered rows after the latency repair.', 'Use hnsw.ef_search=50 and hnsw.iterative_scan=relaxed_order (strict_order also works).'],
      examNote: 'Iterative ANN scans expand candidates until filtered LIMIT is filled; partial indexes require same-table predicates.',
      fields: retrieval, verification: { scenarioId: 'retrieve-filtered', scenarioVersion: 1 }, check: filteredComplete,
      solution: { steps: [...ready, ...deploy(FINAL_APP), ...refresh, scenario('retrieve-filtered')] } }),
    pgTask({ id: 'load-stable', stageId: 'load', text: 'Recover load-600rps at six replicas: zero failures and p95 at most 12ms.',
      explanation: 'clients.py opens a new connection per request. At six replicas the declared cold-burst model exceeds 47 available slots of max_connections=50. Deploy a module pool with max_size=5; the actual retrieval must use that pool. The complete Solution also enables built-in PgBouncer with default_pool_size=20 and port 6432. Applying YAML resets replicas to two, so scale to six after apply. Refresh every request proof after the final build. ' + PG_ESTIMATE_LABEL,
      hints: ['Use one module-level ConnectionPool and return pool.connection() from connect(). Six times max_size must fit within 47 slots.', 'PgBouncer requires GeneralPurpose or MemoryOptimized, pgbouncer.enabled=true and DSN port=6432.'],
      examNote: 'Reuse connections and size pools per replica; PgBouncer multiplexes clients onto fewer server connections.',
      fields: [...retrieval, 'images:assistant-api', 'code:assistant-api:connect', 'replicas:assistant-api', 'dsnPort:assistant-api', 'pg:sku', 'pg:param:max_connections', 'pg:param:pgbouncer.enabled', 'pg:param:pgbouncer.default_pool_size'],
      verification: { scenarioId: 'load-600rps', scenarioVersion: 1 }, check: loadStable,
      solution: { steps: [...ready, parameter('max_connections', 50), parameter('pgbouncer.enabled', 'true'), parameter('pgbouncer.default_pool_size', 20),
        ...deploy(FINAL_APP, BOUNCER_CLIENTS), ...refresh, scenario('retrieve-filtered'), scenario('load-600rps')] } }),
  ],
}

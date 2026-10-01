import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES, POSTGRES_NAIVE_CLIENTS, POSTGRES_POOL_CLIENTS } from '../../templates/data-python/postgres.js'
import { corpusQuestions } from '../../fixtures/data/corpus.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { seedPostgresPoolingGuided } from './postgres-seeds.js'
import { PG_GROUP, PG_SERVER, PG_REGISTRY, PG_TARGET, PG_DATA_TARGET, PG_SCHEMA_SQL, PG_ESTIMATE_LABEL,
  pgVectorAppSource, pgTask, pgLoadScenario, pgDependencies, pgDeployedArtifact, pgDsnPort, pgDeployedFunctionsCurrent } from './postgres-helpers.js'

const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const QUESTION = corpusQuestions()[0]
const APP = pgVectorAppSource()
const BOUNCER_CLIENTS = POSTGRES_POOL_CLIENTS.replace('port=5432', 'port=6432')
const DEPLOYMENT = POSTGRES_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:pg-pooling')
const scale = replicas => command(`kubectl scale deployment/assistant-api -n assistant --replicas ${replicas}`)
const parameter = (name, value) => command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name ${PG_SERVER} --name ${name} --value ${value}`)
const directReady = [parameter('max_connections', 50), parameter('pgbouncer.enabled', 'false')]
const bouncerReady = [parameter('max_connections', 50), parameter('pgbouncer.enabled', 'true'), parameter('pgbouncer.default_pool_size', 20)]
const deploy = clients => [file('clients.py', clients), command(`az acr build --registry ${PG_REGISTRY} --image assistant:pg-pooling .`),
  file('k8s/deployment.yaml', DEPLOYMENT), command('kubectl apply -f k8s/deployment.yaml'),
  command('kubectl rollout restart deployment/assistant-api -n assistant')]
const naiveSteps = [...directReady, ...deploy(POSTGRES_NAIVE_CLIENTS), scale(2), scenario('load-600rps-naive')]
const server = context => context.sandbox.postgresServers?.find(item => item.name === PG_SERVER && item.resourceGroup === PG_GROUP)
const proof = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]?.measurements
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
// Both overload observations are historical: later replicas/images/DSN/pools
// must not invalidate the independently captured two- and six-replica modes.
const baselineFields = ['pg:table:chunks', 'pg:table:documents', 'pg:index:chunks', 'pg:param:max_connections']
const currentFields = [...baselineFields, 'images:assistant-api', 'code:assistant-api:retrieve_passages',
  'code:assistant-api:connect', 'replicas:assistant-api', 'dsnPort:assistant-api',
  'pg:param:pgbouncer.enabled', 'pg:param:pgbouncer.default_pool_size', 'pg:sku']
const currentDependencies = pgDependencies(PG_TARGET, currentFields)
function currentProof(context, id) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]
  return !!record && Object.entries(currentDependencies).every(([key, selector]) => same(record.dependencyValues[key], selector(context)))
}
function representative(measurements, mode, poolMaxSize = null) {
  const calls = (measurements?.calls ?? []).filter(call => typeof call.sql === 'string')
  const selects = calls.filter(call => call.plan)
  return calls.length > 0 && calls.every(call => !call.error && call.connection === mode
    && (poolMaxSize === null || call.poolLifetime === 'module' && call.poolMaxSize === poolMaxSize))
    && selects.length === 1 && same(selects[0].rows.map(row => row.id), [1, 2])
    && same(selects[0].rows, measurements.value)
}
function naive(context) {
  const m = proof(context, 'naive-load')
  return m?.status === 200 && m.mode === 'per-request' && m.replicas === 2 && m.failed === 0
    && m.p95Ms >= 25 && representative(m, 'new')
}
function exhaustion(context) {
  const m = proof(context, 'exhaust')
  return naive(context) && m?.status === 503 && m.mode === 'per-request' && m.replicas === 6 && m.failed > 0
    && m.errors.some(error => error.includes('too many clients already')) && representative(m, 'new')
}
function modulePool(context) {
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  const pools = Object.values(artifact?.appSpec?.data?.postgres?.globals ?? {}).filter(expr =>
    expr.kind === 'call-sdk' && expr.call === 'postgres.pool.ConnectionPool' && expr.lifetime === 'module')
  const k = pools[0]?.args?.max_size
  const m = proof(context, 'pooled-load')
  const port = pgDsnPort(artifact?.appSpec)
  return pools.length === 1 && k?.kind === 'literal' && Number.isInteger(k.value) && k.value > 0 && 6 * k.value <= 47
    && Number(server(context)?.parameters.max_connections) === 50
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_MANIFEST))
    && pgDeployedFunctionsCurrent(context, ['connect', 'retrieve_passages']) && currentProof(context, 'pooled-load')
    && m?.replicas === 6 && m.poolMaxSize === k.value
    && (port === 5432 && m.mode === 'pool' && representative(m, 'pooled', k.value)
      || port === 6432 && bouncer(context) && m.mode === 'pgbouncer' && representative(m, 'bouncer', k.value))
}
function pooled(context) {
  const m = proof(context, 'pooled-load')
  return modulePool(context) && naive(context) && m.status === 200 && m.failed === 0
    && m.errors.length === 0 && m.p95Ms <= proof(context, 'naive-load').p95Ms * 0.4
}
function bouncer(context) {
  return ['GeneralPurpose', 'MemoryOptimized'].includes(server(context)?.tier)
    && server(context).parameters['pgbouncer.enabled'] === 'true'
}
function bouncerLoad(context) {
  const m = proof(context, 'bouncer-load')
  return pooled(context) && bouncer(context) && currentProof(context, 'bouncer-load')
    && pgDsnPort(pgDeployedArtifact(context, PG_TARGET)?.appSpec) === 6432
    && m?.status === 200 && m.mode === 'pgbouncer' && m.replicas === 6 && m.failed === 0 && m.errors.length === 0
    && m.poolMaxSize === proof(context, 'pooled-load').poolMaxSize && representative(m, 'bouncer', m.poolMaxSize)
    && m.peakServerConnections <= Number(server(context).parameters['pgbouncer.default_pool_size'])
}
const load = (requestsPerSecond, expectedError) => pgLoadScenario({ args: [QUESTION.text, QUESTION.product, QUESTION.version, QUESTION.language], requestsPerSecond, expectedError })

export const postgresPoolingGuidedLab = {
  id: 'data-postgres-pooling-guided', title: 'Guided: Optimize PostgreSQL connections',
  brief: 'An independently supplied optimized Lab 6 app has cosine HNSW and filtered RAG on GeneralPurpose Standard_D2ds_v5, with maintenance_work_mem=65536 kB and max_connections=50. Its clients.py opens a fresh psycopg connection on each connect() call; assistant-api starts at two replicas. Observe setup cost and six-replica exhaustion, deploy a reusable module pool, then enable Azure built-in PgBouncer and use port 6432. The declared load model reserves six overlapping cold connections per replica in addition to RPS × 29ms demand; pools remove these cold bursts. ' + PG_ESTIMATE_LABEL,
  minutes: 45, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 7,
  labMode: 'guided', skillAreaId: 'data', service: 'postgresql', status: 'available', manifestId: POSTGRES_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true }, dataTarget: PG_DATA_TARGET,
  initialProjectFiles: { ...POSTGRES_STARTER_FILES, 'app.py': APP, 'clients.py': POSTGRES_NAIVE_CLIENTS, 'schema.sql': PG_SCHEMA_SQL },
  solutionFiles: { ...POSTGRES_STARTER_FILES, 'app.py': APP, 'clients.py': BOUNCER_CLIENTS, 'schema.sql': PG_SCHEMA_SQL, 'k8s/deployment.yaml': DEPLOYMENT },
  initializeSimulation: seedPostgresPoolingGuided,
  stages: [
    { id: 'baseline', title: 'Observe connection cost and exhaustion', taskIds: ['naive-load', 'exhaust'] },
    { id: 'pool', title: 'Reuse an application pool', taskIds: ['app-pool', 'pooled-load'] },
    { id: 'bouncer', title: 'Multiplex with PgBouncer', taskIds: ['pgbouncer', 'bouncer-load'] },
  ],
  scenarios: {
    'load-600rps-naive': load(600),
    'load-600rps-exhaust': load(600, 'too many clients already'),
    'load-600rps-pooled': load(600),
    'load-1200rps': load(1200),
  },
  tasks: [
    pgTask({ id: 'naive-load', stageId: 'baseline', text: 'Run load-600rps-naive with two naive replicas to record connection setup cost.',
      explanation: 'Every request opens a connection. The model charges 25ms setup plus 4ms query time, so the 29ms p95 is dominated by setup. Record this historical baseline before changing clients.py. ' + PG_ESTIMATE_LABEL,
      hints: ['Start with two assistant-api replicas and the supplied naive clients.py.', 'The load scenario executes a representative recognized SQL request from the deployed image.'],
      examNote: 'Opening a connection costs a TLS handshake and authentication on every request.', fields: baselineFields,
      verification: { scenarioId: 'load-600rps-naive', scenarioVersion: 1 }, check: naive,
      solution: { steps: naiveSteps } }),
    pgTask({ id: 'exhaust', stageId: 'baseline', text: 'Scale the naive Deployment to six replicas and run load-600rps-exhaust.',
      explanation: 'This observation expects actual too-many-clients errors: the six cold reservations per replica raise peak demand to 54, above 47 available server slots. The captured load remains HTTP 503 with failed requests; observing the expected error completes this exercise. ' + PG_ESTIMATE_LABEL,
      hints: ['kubectl scale deployment/assistant-api -n assistant --replicas 6', 'Use the exhaust observation scenario while clients.py still opens new connections.'],
      examNote: 'Each connection is a server process; max_connections caps them and some slots are reserved.', fields: baselineFields,
      verification: { scenarioId: 'load-600rps-exhaust', scenarioVersion: 1 }, check: exhaustion,
      solution: { steps: [...naiveSteps, scale(6), scenario('load-600rps-exhaust')] } }),
    pgTask({ id: 'app-pool', stageId: 'pool', text: 'Deploy a module-level ConnectionPool with six replicas and 6 × max_size ≤47.',
      explanation: 'Change only clients.py: create ConnectionPool(DSN, max_size=5) once at module scope and have connect() return pool.connection(). Existing with connect() as conn blocks now check out reusable connections. Build/apply the learner image, scale back to six after applying the two-replica manifest, and run the pooled scenario to establish the actual deployed mode.',
      hints: ['Import ConnectionPool from psycopg_pool and dict_row from psycopg.rows; use kwargs={"row_factory": dict_row}.', 'One module pool per replica: six × five=30 connections, under the 47 available slots.'],
      examNote: 'Size the pool per replica: replicas × max_size must fit under max_connections.', fields: currentFields, check: modulePool,
      solution: { steps: [...directReady, ...deploy(POSTGRES_POOL_CLIENTS), scale(6), scenario('load-600rps-pooled')] } }),
    pgTask({ id: 'pooled-load', stageId: 'pool', text: 'Run load-600rps-pooled at six replicas: zero failures and p95 ≤40% of the naive baseline.',
      explanation: 'The current deployed module pool must serve real retrieval SQL. Reused connections remove setup cost; the model estimates 5ms p95. A module pool also remains reusable when later pointed to PgBouncer; refresh this proof after changing its DSN. ' + PG_ESTIMATE_LABEL,
      hints: ['Build/deploy clients.py and scale to six before running load.', 'Keep the historical two-replica naive proof; rerun the pooled proof whenever image, DSN or pool configuration changes.'],
      examNote: 'A client-side pool reuses connections across requests.', fields: currentFields,
      verification: { scenarioId: 'load-600rps-pooled', scenarioVersion: 1 }, check: pooled,
      solution: { steps: [...naiveSteps, ...deploy(POSTGRES_POOL_CLIENTS), scale(6), scenario('load-600rps-pooled')] } }),
    pgTask({ id: 'pgbouncer', stageId: 'bouncer', text: 'Enable built-in PgBouncer on GeneralPurpose or MemoryOptimized.',
      explanation: 'Set pgbouncer.enabled=true and choose pgbouncer.default_pool_size=20. Azure built-in PgBouncer listens on 6432 and is unavailable on Burstable. The application DSN change is verified in the next task.',
      hints: ['az postgres flexible-server parameter set -g rg-assistant --server-name pg-assistant --name pgbouncer.enabled --value true', 'Set pgbouncer.default_pool_size to 20 to demonstrate 30 app connections multiplexed onto at most 20 server connections.'],
      examNote: "Azure's built-in PgBouncer runs on port 6432; it isn't available on Burstable.", fields: ['pg:sku', 'pg:param:pgbouncer.enabled'], check: bouncer,
      // Enabling/changing bouncer parameters invalidates current pooled proof.
      solution: { steps: [...bouncerReady, ...deploy(POSTGRES_POOL_CLIENTS), scale(6), scenario('load-600rps-pooled')] } }),
    pgTask({ id: 'bouncer-load', stageId: 'bouncer', text: 'Deploy DSN port=6432 and run load-1200rps at six replicas with zero failures.',
      explanation: 'Keep the module pool and switch its DSN to port=6432. Refresh 600-RPS evidence, then verify the current 1200-RPS load has zero failures and peak server connections no higher than default_pool_size. Use transaction pooling: apply query settings within every request transaction and rely on no session state across requests. This supplied retrieval reapplies hnsw settings inside each with connect() block. In production, SET LOCAL in an explicit transaction is appropriate for transaction-local settings; it is outside this simulator SQL subset. ' + PG_ESTIMATE_LABEL,
      hints: ['Change DSN in clients.py, build the image, edit/apply the Deployment, restart when reusing a tag, and explicitly scale to six.', 'Run load-600rps-pooled again after the image/DSN changes, then load-1200rps.'],
      examNote: 'PgBouncer multiplexes many client connections onto fewer server connections; use transaction pooling with no session-level state across transactions.', fields: currentFields,
      verification: { scenarioId: 'load-1200rps', scenarioVersion: 1 }, check: bouncerLoad,
      solution: { steps: [...naiveSteps, ...bouncerReady, ...deploy(BOUNCER_CLIENTS), scale(6), scenario('load-600rps-pooled'), scenario('load-1200rps')] } }),
  ],
}

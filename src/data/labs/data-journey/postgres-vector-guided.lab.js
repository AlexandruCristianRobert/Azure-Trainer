import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES, POSTGRES_NAIVE_CLIENTS } from '../../templates/data-python/postgres.js'
import { CORPUS, corpusQuestions } from '../../fixtures/data/corpus.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { parsePgSql } from '../../../lib/data/pg-sql.js'
import { seedPostgresVectorGuided } from './postgres-seeds.js'
import { PG_GROUP, PG_SERVER, PG_DATABASE, PG_REGISTRY, PG_TARGET, PG_DATA_TARGET,
  PG_SCHEMA_SQL, PG_HNSW_SQL, PG_ESTIMATE_LABEL, pgSqlCommand, pgConnectAppSource,
  pgVectorAppSource, pgTask, pgRequestScenario, pgDeployedArtifact, pgDeployedFunctionsCurrent } from './postgres-helpers.js'

const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const sql = text => command(pgSqlCommand(`-c "${text}"`))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const QUESTION = corpusQuestions()[0]
const UNKNOWN = 'Can Contoso Backup teleport a snapshot to the moon?'
// Global ranking is deliberately different from the question's filtered IDs.
const cosine = vector => 1 - vector.reduce((sum, value, i) => sum + value * QUESTION.vector[i], 0)
  / Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0) * QUESTION.vector.reduce((sum, value) => sum + value * value, 0))
const GLOBAL_IDS = [...CORPUS.chunks].sort((a, b) => cosine(a.embedding) - cosine(b.embedding) || a.id - b.id).slice(0, 2).map(row => row.id)
const STARTER_APP = pgConnectAppSource()
const TUNED_APP = pgVectorAppSource({ iterativeScan: 'off', rag: false })
const EXPLORATORY_APP = pgVectorAppSource({ efSearch: 4, iterativeScan: 'off', rag: false })
const FILTERED_APP = pgVectorAppSource({ rag: false })
const FINAL_APP = pgVectorAppSource()
const DEPLOYMENT = POSTGRES_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:pg-vector')
const deploy = app => [file('app.py', app), file('clients.py', POSTGRES_NAIVE_CLIENTS), command(`az acr build --registry ${PG_REGISTRY} --image assistant:pg-vector .`),
  file('k8s/deployment.yaml', DEPLOYMENT), command('kubectl apply -f k8s/deployment.yaml'),
  command('kubectl rollout restart deployment/assistant-api -n assistant')]
const SCALE = command(`az postgres flexible-server update -g ${PG_GROUP} -n ${PG_SERVER} --tier GeneralPurpose --sku-name Standard_D2ds_v5`)
const MEMORY = command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name ${PG_SERVER} --name maintenance_work_mem --value 65536`)
const INDEX = sql(PG_HNSW_SQL)
const server = context => context.sandbox.postgresServers?.find(item => item.name === PG_SERVER && item.resourceGroup === PG_GROUP)
const database = context => server(context)?.databases.find(item => item.name === PG_DATABASE)
const proof = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]?.measurements
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const selects = measurements => (measurements?.calls ?? []).filter(call => call.plan)
const latency = measurements => (measurements?.calls ?? []).reduce((total, call) => total + call.latencyMs, 0)
function learnerDeployed(context, names) {
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  return artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_MANIFEST))
    && pgDeployedFunctionsCurrent(context, names)
}
function hnsw(context) {
  return database(context)?.indexes.some(index => index.table === 'chunks' && index.method === 'hnsw'
    && index.columns.length === 1 && index.columns[0].name === 'embedding' && index.columns[0].opclass === 'vector_cosine_ops') === true
}
function hasSetting(measurements, name, check) {
  return measurements?.calls.some(call => {
    const parsed = parsePgSql(call.sql)
    return !parsed.error && parsed.statements.some(stmt => stmt.kind === 'set' && stmt.name === name && check(stmt.value))
  }) === true
}
function rowsProof(context, id, expected, ann) {
  const measurements = proof(context, id)
  const calls = selects(measurements)
  return measurements?.status === 200 && Array.isArray(measurements.value)
    && same(measurements.value.map(row => row.id), expected) && calls.length === 1
    && same(calls[0].rows, measurements.value) && !calls[0].error
    && (ann ? hnsw(context) && database(context).indexes.some(index => index.name === calls[0].plan.index && index.method === 'hnsw' && index.columns[0].opclass === 'vector_cosine_ops')
      : calls[0].plan.node === 'Seq Scan')
}
function tuned(context) {
  const measurements = proof(context, 'tuned')
  return learnerDeployed(context, ['retrieve_passages']) && rowsProof(context, 'tuned', GLOBAL_IDS, true)
    && hasSetting(measurements, 'hnsw.ef_search', value => Number(value) >= 45)
    && selects(measurements)[0].recall >= 0.98 && latency(measurements) < latency(proof(context, 'exact-knn')) * 0.25
}
function filtered(context) {
  const measurements = proof(context, 'filtered')
  return learnerDeployed(context, ['retrieve_passages']) && rowsProof(context, 'filtered', QUESTION.expectedChunkIds, true)
    && measurements.value.every(row => row.product === QUESTION.product && row.version === QUESTION.version && row.language === QUESTION.language)
    && hasSetting(measurements, 'hnsw.iterative_scan', value => value === 'relaxed_order')
}
function answered(context) {
  const measurements = proof(context, 'answer')
  const calls = selects(measurements)
  const knownCalls = calls.filter(call => call.stepIndex === 0)
  const unknownCalls = calls.filter(call => call.stepIndex === 1)
  const training = measurements?.trainingCalls ?? []
  const builders = training.filter(call => call.stepIndex === 0 && call.functionName === 'build_context')
  const helpers = training.filter(call => call.stepIndex === 0 && call.functionName === 'training_answer')
  return learnerDeployed(context, ['retrieve_passages', 'build_context', 'answer']) && filtered(context)
    && measurements?.status === 200 && same(measurements.values, [
      { answer: QUESTION.answer, sources: QUESTION.expectedChunkIds },
      { answer: "I couldn't find that in the documentation.", sources: [] },
    ]) && calls.length === 2 && knownCalls.length === 1 && unknownCalls.length === 1
    && same(knownCalls[0].rows.map(row => row.id), QUESTION.expectedChunkIds) && same(unknownCalls[0].rows, [])
    && measurements.trainingTraceTruncated === false
    && builders.some(builder => same(builder.args, [knownCalls[0].rows])
      && same(builder.result?.sources, knownCalls[0].rows.map(row => row.id))
      && typeof builder.result?.passages === 'string'
      && knownCalls[0].rows.every(row => builder.result.passages.includes(row.content))
      && helpers.some(helper => same(helper.args, [QUESTION.text, builder.result])
        && helper.result === measurements.values[0].answer
        && same(builder.result.sources, measurements.values[0].sources)))
    && !training.some(call => call.stepIndex === 1 && call.functionName === 'training_answer')
}
const retrievalFields = ['code:assistant-api:retrieve_passages', 'pg:table:chunks', 'pg:table:documents', 'pg:index:chunks',
  'images:assistant-api', 'code:assistant-api:connect', 'dsnPort:assistant-api', 'pg:param:pgbouncer.enabled']
const readySteps = [SCALE, MEMORY, INDEX]

export const postgresVectorGuidedLab = {
  id: 'data-postgres-vector-guided', title: 'Guided: Size pgvector and build filtered RAG',
  brief: 'Continue from an independently supplied Lab 5 corpus, B-tree and GIN indexes on a Burstable Standard_B1ms server. This exercise explicitly seeds maintenance_work_mem at 1024 kB; the simulator default is 65536 kB. Record the fixed exact-search baseline, resize compute and build memory, create cosine HNSW, implement ANN retrieval, repair filtered candidate under-fill, and construct grounded answers. The protected /baseline/exact route works while retrieval/context/answer remain starters. Visible fixtures contain 16 documents and 32 chunks; logical sizes are 20,000 and 250,000. ' + PG_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 6,
  labMode: 'guided', skillAreaId: 'data', service: 'postgresql', status: 'available', manifestId: POSTGRES_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true }, dataTarget: PG_DATA_TARGET,
  initialProjectFiles: { ...POSTGRES_STARTER_FILES, 'app.py': STARTER_APP, 'schema.sql': PG_SCHEMA_SQL },
  solutionFiles: { ...POSTGRES_STARTER_FILES, 'app.py': FINAL_APP, 'clients.py': POSTGRES_NAIVE_CLIENTS, 'schema.sql': PG_SCHEMA_SQL, 'k8s/deployment.yaml': DEPLOYMENT },
  initializeSimulation: seedPostgresVectorGuided,
  stages: [
    { id: 'exact', title: 'Record exact search', taskIds: ['exact-knn'] },
    { id: 'size', title: 'Size compute and build memory', taskIds: ['scale-up', 'build-memory'] },
    { id: 'index', title: 'Build and tune cosine HNSW', taskIds: ['hnsw', 'tuned'] },
    { id: 'rag', title: 'Repair filters and construct grounded answers', taskIds: ['filtered', 'answer'] },
  ],
  scenarios: {
    'retrieve-exact': pgRequestScenario([{ route: 'GET /baseline/exact', args: [QUESTION.text] }]),
    'retrieve-unfiltered': pgRequestScenario([{ route: 'GET /retrieve', args: [QUESTION.text, null, null, null] }]),
    'retrieve-wrong-product-question': pgRequestScenario([{ route: 'GET /retrieve', args: [QUESTION.text, QUESTION.product, QUESTION.version, QUESTION.language] }]),
    // One verification records both known and unknown outcomes in values order.
    'answer-known': pgRequestScenario([
      { route: 'GET /answer', args: [QUESTION.text, QUESTION.product, QUESTION.version, QUESTION.language] },
      { route: 'GET /answer', args: [UNKNOWN, QUESTION.product, QUESTION.version, QUESTION.language] },
    ]),
  },
  tasks: [
    pgTask({ id: 'exact-knn', stageId: 'exact', text: 'Run retrieve-exact to record exhaustive top-2 rows and baseline latency.',
      explanation: 'The supplied fixed GET /baseline/exact route ranks the whole corpus and returns IDs 17 and 9, including a deliberately misleading Support passage. This historical Seq Scan baseline survives later compute, index and app changes. ' + PG_ESTIMATE_LABEL,
      hints: ['Run the retrieve-exact scenario before adding a vector index.', 'Exact search scans every chunk; metadata filtering will be added to your own retrieval later.'],
      examNote: 'Exact kNN has perfect recall and scan cost grows with table size.', fields: ['pg:table:chunks', 'pg:table:documents'],
      verification: { scenarioId: 'retrieve-exact', scenarioVersion: 1 }, check: context => rowsProof(context, 'exact-knn', GLOBAL_IDS, false),
      solution: { steps: [scenario('retrieve-exact')] } }),
    pgTask({ id: 'scale-up', stageId: 'size', text: 'Scale pg-assistant to GeneralPurpose or MemoryOptimized with at least 2 vCores.',
      explanation: 'Burstable is a development starting point; sustained vector builds/searches benefit from CPU and memory.',
      hints: ['Use az postgres flexible-server update with a matching tier/SKU pair.', 'Choose --tier GeneralPurpose --sku-name Standard_D2ds_v5.'],
      examNote: 'Burstable suits dev/test; GeneralPurpose and MemoryOptimized support sustained workloads.',
      check: context => ['GeneralPurpose', 'MemoryOptimized'].includes(server(context)?.tier) && server(context).vCores >= 2,
      solution: { steps: [SCALE] } }),
    pgTask({ id: 'build-memory', stageId: 'size', text: 'Raise maintenance_work_mem enough for the HNSW graph.',
      explanation: 'The unchanged teaching formula is rows × dimensions × 4 bytes × 1.6 / 1024: 250,000 × 8 requires 12,500 kB. The seeded 1024 kB fails the simulated build budget. 65536 kB fits the graph. ' + PG_ESTIMATE_LABEL,
      hints: ['Server parameters use integer kB; set maintenance_work_mem with az postgres flexible-server parameter set.', 'Use --name maintenance_work_mem --value 65536 after scaling compute.'],
      examNote: 'HNSW builds fastest when its graph fits in maintenance_work_mem; halfvec halves vector storage at reduced precision and is optional here.',
      check: context => {
        const chunks = database(context)?.tables.find(table => table.name === 'chunks')
        return !!chunks && Number(server(context).parameters.maintenance_work_mem) >= chunks.logicalRows * chunks.columns.find(column => column.name === 'embedding').dimensions * 4 * 1.6 / 1024
      }, solution: { steps: [SCALE, MEMORY] } }),
    pgTask({ id: 'hnsw', stageId: 'index', text: 'Create HNSW on chunks.embedding with vector_cosine_ops.',
      explanation: 'The app orders ascending cosine distance with <=> and LIMIT 2. An L2 opclass cannot serve that query.',
      hints: ['Create the index after sizing compute/build memory.', 'CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops).'],
      examNote: 'Match opclass to operator: <=> cosine, <-> L2, <#> inner product. IVFFlat is optional: lists partitions training data; ivfflat.probes searches more lists for better recall.',
      check: hnsw, solution: { steps: readySteps } }),
    pgTask({ id: 'tuned', stageId: 'index', text: 'Implement unfiltered ANN retrieval, SET hnsw.ef_search ≥45 in app code, build/deploy and run retrieve-unfiltered.',
      explanation: 'Use product=None to select the global branch. Return actual IDs 17 and 9 with recall ≥0.98 and latency below 25% of the recorded exact baseline. Bind vectors separately, register_vector and use a single ascending distance ORDER BY. ' + PG_ESTIMATE_LABEL,
      hints: ['SET hnsw.ef_search = 50 inside the connection; retain LIMIT 2.', 'Build with az acr build, edit the Deployment image, apply it, and restart the Deployment when reusing a tag. IVFFlat probes/lists is an optional alternative lesson, not this task.'],
      examNote: 'Higher ef_search improves recall at additional latency; it must be at least LIMIT.', fields: retrievalFields,
      verification: { scenarioId: 'retrieve-unfiltered', scenarioVersion: 1 }, check: tuned,
      solution: { steps: [scenario('retrieve-exact'), ...readySteps, ...deploy(TUNED_APP), scenario('retrieve-unfiltered')] } }),
    pgTask({ id: 'filtered', stageId: 'rag', text: 'Explore ef_search=4 under-fill, then repair product/version/language retrieval with relaxed_order iterative scans.',
      explanation: 'Metadata is on documents: JOIN chunks c to documents d on document_id=id and bind all three filters in SQL. The misleading global passage belongs to another product. At ef_search=4 the modeled candidate budget can under-fill; inspect actual returned rows rather than assuming failure. Restore ef_search=50 and SET hnsw.iterative_scan = relaxed_order, then verify two rows [1,2]. Refresh unfiltered proof after editing shared retrieval. ' + PG_ESTIMATE_LABEL,
      hints: ['Try SET hnsw.ef_search = 4 and iterative_scan = off, deploy and run the filtered scenario to inspect candidate loss.', 'Final repair: SET hnsw.iterative_scan = relaxed_order with ef_search=50. A partial index on chunks cannot refer to joined documents metadata; denormalized same-table fields would be required.'],
      examNote: 'ANN metadata filtering can under-fill LIMIT; iterative scans expand candidates. Partial indexes need same-table predicates. halfvec storage and IVFFlat tuning are optional here.',
      fields: retrievalFields, verification: { scenarioId: 'retrieve-wrong-product-question', scenarioVersion: 1 }, check: filtered,
      solution: { steps: [...readySteps, ...deploy(EXPLORATORY_APP), scenario('retrieve-wrong-product-question'),
        ...deploy(FILTERED_APP), scenario('retrieve-unfiltered'), scenario('retrieve-wrong-product-question')] } }),
    pgTask({ id: 'answer', stageId: 'rag', text: 'Implement build_context and answer, then run answer-known to verify known and unknown questions.',
      explanation: 'Build context from the returned content and source IDs, then pass that context to training_answer. Reject unknown zero-vector matches with the distance threshold <0.2. Before calling training_answer, handle empty rows with the declared response: {answer: "I couldn\'t find that in the documentation.", sources: []}. This scenario also checks the unknown question; refresh retrieval proofs after the final build.',
      hints: ['Append row["id"] and row["content"] to lists; return sources and joined passages from build_context.', 'answer calls retrieve_passages, returns the empty fallback for len(rows)==0, otherwise calls training_answer(question, build_context(rows)) and returns context sources.'],
      examNote: 'RAG retrieves relevant passages and builds prompt context from those passages; source IDs and a no-match outcome prevent unsupported answers.',
      fields: [...retrievalFields, 'code:assistant-api:build_context', 'code:assistant-api:answer'],
      verification: { scenarioId: 'answer-known', scenarioVersion: 1 }, check: answered,
      solution: { steps: [...readySteps, ...deploy(FINAL_APP), scenario('retrieve-unfiltered'), scenario('retrieve-wrong-product-question'), scenario('answer-known')] } }),
  ],
}

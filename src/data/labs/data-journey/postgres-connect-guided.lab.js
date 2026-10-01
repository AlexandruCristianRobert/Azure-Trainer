import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES } from '../../templates/data-python/postgres.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { parsePgSql, bindParams } from '../../../lib/data/pg-sql.js'
import { runDataFunction } from '../../../lib/data/runtime.js'
import { seedPostgresConnectGuided } from './postgres-seeds.js'
import { PG_GROUP, PG_SERVER, PG_DATABASE, PG_REGISTRY, PG_TARGET, PG_DATA_TARGET,
  PG_SERVER_COMMAND, PG_ALLOW_VECTOR_COMMAND, PG_DATABASE_COMMAND, PG_SCHEMA_SQL,
  PG_ESTIMATE_LABEL, pgSqlCommand, pgConnectAppSource, pgTask, pgRequestScenario,
  pgDeployedArtifact, pgDeployedFunctionsCurrent } from './postgres-helpers.js'

const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const sql = text => command(pgSqlCommand(`-c "${text}"`))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const IMAGE = `${PG_REGISTRY}.azurecr.io/assistant:pg-connect`
const APP = pgConnectAppSource()
const DEPLOYMENT = POSTGRES_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:pg-connect')
const BUILD = command(`az acr build --registry ${PG_REGISTRY} --image assistant:pg-connect .`)
const APPLY = command('kubectl apply -f k8s/deployment.yaml')
const DEPLOY_STEPS = [BUILD, file('k8s/deployment.yaml', DEPLOYMENT), APPLY]
const PRODUCT_SQL = "SELECT id, product, version, language, metadata FROM documents WHERE product = 'contoso-backup' AND version = 'v2' ORDER BY id LIMIT 5"
const METADATA_SQL = "SELECT id, product, version, language, metadata FROM documents WHERE metadata @> '{\"product\":\"contoso-backup\",\"version\":\"v1\",\"language\":\"en\"}' ORDER BY id LIMIT 5"
const explainMetadata = command(pgSqlCommand(`-c "EXPLAIN ANALYZE ${METADATA_SQL.replaceAll('"', '\\"')}"`))
const explainProduct = sql(`EXPLAIN ANALYZE ${PRODUCT_SQL}`)
const server = context => context.sandbox.postgresServers?.find(item => item.name === PG_SERVER && item.resourceGroup === PG_GROUP)
const database = context => server(context)?.databases.find(item => item.name === PG_DATABASE)
const table = (context, name) => database(context)?.tables.find(item => item.name === name)
const parsed = context => parsePythonProject(context.project.savedFiles, POSTGRES_MANIFEST)

function hasFormatting(value, functions, visited = new Set()) {
  if (!value || typeof value !== 'object') return false
  if (value.kind === 'fstring') return true
  if (value.kind === 'call-local' && !visited.has(value.name)) {
    visited.add(value.name)
    if (hasFormatting(functions[value.name]?.body, functions, visited)) return true
  }
  return Object.values(value).some(child => hasFormatting(child, functions, visited))
}
function safeQueries(context) {
  const current = parsed(context)
  if (current.diagnostics.length) return false
  const functions = current.appSpec.data.functions
  return [
    ['get_document', [1]],
    ['search_by_metadata', ['contoso-backup', 'v2', null]],
    ['search_by_metadata', ['contoso-backup', 'v1', { product: 'contoso-backup', version: 'v1', language: 'en' }]],
  ].every(([functionName, args]) => {
    if (hasFormatting(functions[functionName]?.body, functions)) return false
    // Interpret supported ops only, against a discarded sandbox copy. The
    // shared runtime/SQL binder validates actual separate params, including
    // local SQL/tuple variables and Jsonb, without executing learner Python.
    const result = runDataFunction({ appSpec: current.appSpec,
      sandbox: JSON.parse(JSON.stringify(context.sandbox)), dataTarget: PG_DATA_TARGET,
      functionName, args, nowMs: context.runtime.simTimeMs })
    if (result.status !== 200) return false
    const calls = result.calls.filter(call => typeof call.sql === 'string')
    return calls.length > 0 && calls.every(call => {
      const sql = parsePgSql(call.sql)
      // An already-successful bound call must still contain real AST params;
      // quoted '%s' or comment text alone is not a parameter placeholder.
      return !call.error && !sql.error && sql.statements.length > 0
        && sql.statements.every(statement => !!bindParams(statement, undefined).error)
    })
  })
}
function learnerBuildCurrent(context) {
  const hash = projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_MANIFEST))
  return Object.values(context.artifacts.buildsById).some(artifact => artifact.sourceHash === hash)
}
function deployed(context) {
  const artifact = pgDeployedArtifact(context, PG_TARGET)
  return safeQueries(context) && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, POSTGRES_MANIFEST))
}
const column = (columns, name, type) => columns?.some(item => item.name === name && item.type === type)
function tablesReady(context) {
  const docs = table(context, 'documents'), chunks = table(context, 'chunks')
  if (!docs || !chunks) return false
  const docId = docs.columns.find(item => item.name === 'id')
  const chunkId = chunks.columns.find(item => item.name === 'id')
  const fk = chunks.columns.find(item => item.name === 'document_id')
  const embedding = chunks.columns.find(item => item.name === 'embedding')
  const saved = parsePgSql(context.project.savedFiles['schema.sql'])
  return !saved.error && ['documents', 'chunks'].every(name => {
    const authored = saved.statements.find(statement => statement.kind === 'create-table' && statement.name === name)
    const stored = table(context, name)
    return authored && JSON.stringify(authored.columns) === JSON.stringify(stored.columns)
      && JSON.stringify(authored.primaryKey) === JSON.stringify(stored.primaryKey)
  }) && context.history.some(line => /^psql\s/.test(line) && /-f\s+schema\.sql(?:\s|$)/.test(line))
    && docId?.type === 'bigint' && (docId.identity || docId.primaryKey || docs.primaryKey.includes('id'))
    && ['product', 'version', 'language', 'body'].every(name => column(docs.columns, name, 'text'))
    && column(docs.columns, 'metadata', 'jsonb') && column(docs.columns, 'updated_at', 'timestamptz')
    && ['bigint', 'int', 'integer'].includes(chunkId?.type)
    && ['bigint', 'int', 'integer'].includes(fk?.type) && fk.references?.table === 'documents' && fk.references.column === 'id'
    && (column(chunks.columns, 'chunk_index', 'integer') || column(chunks.columns, 'chunk_index', 'int'))
    && column(chunks.columns, 'content', 'text') && embedding?.type === 'vector' && embedding.dimensions === 8
}
const record = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]
function indexProof(context, id, expected, node, method) {
  if (!safeQueries(context) || !learnerBuildCurrent(context)
    || !pgDeployedFunctionsCurrent(context, ['search_by_metadata'])) return false
  const measurements = record(context, id)?.measurements
  if (measurements?.status !== 200 || !Array.isArray(measurements.value)
    || JSON.stringify(measurements.value.map(row => row.id)) !== JSON.stringify(expected)) return false
  const calls = measurements.calls.filter(call => typeof call.sql === 'string' && call.plan)
  return calls.length === 1 && calls[0].plan.node === node
    && JSON.stringify(calls[0].rows) === JSON.stringify(measurements.value)
    && database(context)?.indexes.some(index => index.name === calls[0].plan.index && index.method === method
      && index.table === 'documents' && (method === 'btree'
        ? index.columns.map(item => item.name).join(',') === 'product,version'
        : index.columns.some(item => item.name === 'metadata')))
}

export const postgresConnectGuidedLab = {
  id: 'data-postgres-connect-guided', title: 'Guided: Store the document corpus in PostgreSQL',
  brief: 'Provision PostgreSQL Flexible Server, author schema.sql and bound psycopg queries, deploy the assistant API, and compare EXPLAIN ANALYZE before and after B-tree and GIN indexes. Cloud Shell psql is one-shot: use a complete DSN with -c or -f on each line. The fixed load.sql marker -- simulator:load-corpus stands in for bulk COPY. Visible fixtures are small; logical corpus sizes are 20,000 documents and 250,000 chunks. ' + PG_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 5,
  labMode: 'guided', skillAreaId: 'data', service: 'postgresql', status: 'available', manifestId: POSTGRES_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true },
  dataTarget: { kind: 'postgres', resourceGroup: PG_GROUP, server: PG_SERVER, database: PG_DATABASE },
  initialProjectFiles: { ...POSTGRES_STARTER_FILES, 'schema.sql': '-- Author documents and chunks with jsonb metadata and vector(8).\n' },
  solutionFiles: { ...POSTGRES_STARTER_FILES, 'app.py': APP, 'schema.sql': PG_SCHEMA_SQL, 'k8s/deployment.yaml': DEPLOYMENT },
  initializeSimulation: seedPostgresConnectGuided,
  stages: [
    { id: 'provision', title: 'Provision Flexible Server', taskIds: ['server', 'allow-vector', 'database'] },
    { id: 'schema', title: 'Author and load the corpus schema', taskIds: ['extension', 'tables', 'loaded'] },
    { id: 'code', title: 'Implement bound SQL queries', taskIds: ['code-queries'] },
    { id: 'deploy', title: 'Build and deploy current sources', taskIds: ['deployed'] },
    { id: 'indexes', title: 'Compare query plans and verify indexes', taskIds: ['btree', 'gin'] },
  ],
  scenarios: {
    'docs-by-product': pgRequestScenario([{ route: 'GET /documents', args: ['contoso-backup', 'v2', null] }]),
    'docs-by-metadata': pgRequestScenario([{ route: 'GET /documents', args: ['contoso-backup', 'v1', { product: 'contoso-backup', version: 'v1', language: 'en' }] }]),
  },
  tasks: [
    pgTask({ id: 'server', stageId: 'provision', text: 'Create pg-assistant in rg-assistant: GeneralPurpose, Standard_D2ds_v5, at least 32 GiB storage, PostgreSQL 16.',
      explanation: 'Use the supplied fictional training credentials and direct port 5432. Public access None is a local simulator setting.',
      hints: ['Use az postgres flexible-server create.', 'Specify --tier GeneralPurpose --sku-name Standard_D2ds_v5 --storage-size 32 --version 16.'],
      examNote: 'Flexible server is the current deployment option; tier sets vCores/memory and the default max_connections.',
      check: context => server(context)?.tier === 'GeneralPurpose' && server(context).skuName === 'Standard_D2ds_v5' && server(context).storageSizeGb >= 32 && server(context).version === '16',
      solution: { steps: [command(PG_SERVER_COMMAND)] } }),
    pgTask({ id: 'allow-vector', stageId: 'provision', text: 'Allow-list vector in the azure.extensions server parameter.',
      explanation: 'Installing an extension in a database requires this server-level permission first.',
      hints: ['Use az postgres flexible-server parameter set.', 'Set --name azure.extensions --value VECTOR on pg-assistant.'],
      examNote: 'Extensions must be allow-listed with azure.extensions before CREATE EXTENSION.',
      check: context => !!server(context)?.parameters['azure.extensions'].split(',').includes('vector'),
      solution: { steps: [command(PG_ALLOW_VECTOR_COMMAND)] } }),
    pgTask({ id: 'database', stageId: 'provision', text: 'Create the knowledge database on pg-assistant.',
      explanation: 'A server hosts databases; this application connects to knowledge.',
      hints: ['Use az postgres flexible-server db create.', 'Pass --server-name pg-assistant --database-name knowledge and the resource group.'],
      examNote: 'A database is a namespace for its own tables and installed extensions.', check: context => !!database(context),
      solution: { steps: [command(PG_DATABASE_COMMAND)] } }),
    pgTask({ id: 'extension', stageId: 'schema', text: 'Install vector in knowledge using a one-shot psql command.',
      explanation: 'Use host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin in the DSN.',
      hints: ['Use psql "<dsn>" -c "CREATE EXTENSION vector".', 'Installing vector in another database does not install it in knowledge.'],
      examNote: 'CREATE EXTENSION vector installs pgvector types and operators in that database.',
      check: context => !!database(context)?.extensions.includes('vector'), solution: { steps: [sql('CREATE EXTENSION IF NOT EXISTS vector')] } }),
    pgTask({ id: 'tables', stageId: 'schema', text: 'Edit schema.sql to create documents and chunks, then run psql -f schema.sql.',
      explanation: 'documents needs a bigint identity or primary key, product/version/language text, metadata jsonb, body text and updated_at timestamptz. chunks needs id, document_id referencing documents(id), chunk_index integer, content text and embedding vector(8).',
      hints: ['Use bigint PRIMARY KEY for document IDs and a REFERENCES documents(id) foreign key.', 'Use metadata jsonb and embedding vector(8); the supplied model uses eight dimensions.'],
      examNote: 'Use jsonb (not json) for queryable metadata and vector(n) with the model dimension count.',
      check: tablesReady, solution: { steps: [file('schema.sql', PG_SCHEMA_SQL), command(pgSqlCommand('-f schema.sql'))] } }),
    pgTask({ id: 'loaded', stageId: 'schema', text: 'Load the corpus using the supplied fixed load.sql file.',
      explanation: 'The -- simulator:load-corpus directive is a bulk COPY stand-in, preserving real visible samples and declared logical row counts. ' + PG_ESTIMATE_LABEL,
      hints: ['Run psql "<dsn>" -f load.sql.', 'Create both tables before loading; do not replace the supplied marker.'],
      examNote: 'Bulk COPY loads data after the schema and foreign-key targets exist.',
      check: context => table(context, 'documents')?.logicalRows === 20000 && table(context, 'documents').rows.length === 16 && table(context, 'chunks')?.logicalRows === 250000 && table(context, 'chunks').rows.length === 32,
      solution: { steps: [command(pgSqlCommand('-f load.sql'))] } }),
    pgTask({ id: 'code-queries', stageId: 'code', text: 'Implement get_document and search_by_metadata with execute(sql, params), then build the current sources.',
      explanation: 'Bind %s parameters separately. The metadata branch must adapt the object with psycopg.types.json.Jsonb and use metadata @> %s; the other branch uses product/version equality. Keep retrieval, context and answer as later Lab starters.',
      hints: ['Use conn.execute("... WHERE id = %s", (document_id,)).fetchall().', 'For metadata use (Jsonb(metadata),); for equality use (product, version). Avoid f-strings and concatenated SQL.'],
      examNote: 'psycopg sends parameters separately from SQL text, preventing SQL injection.',
      check: context => safeQueries(context) && learnerBuildCurrent(context), solution: { steps: [file('app.py', APP), BUILD] } }),
    pgTask({ id: 'deployed', stageId: 'deploy', text: `Deploy assistant-api using ${IMAGE}, built from your current sources.`,
      explanation: 'Edit the image in k8s/deployment.yaml and apply that file after the ACR build.',
      hints: ['Run az acr build --registry acrassistant --image assistant:pg-connect .', 'Set the Deployment image to acrassistant.azurecr.io/assistant:pg-connect, then kubectl apply -f k8s/deployment.yaml.'],
      examNote: 'Running Pods use an immutable build snapshot; saved code alone does not change the app.',
      check: deployed, solution: { steps: DEPLOY_STEPS } }),
    pgTask({ id: 'btree', stageId: 'indexes', text: 'Compare EXPLAIN ANALYZE before/after a B-tree on (product, version), then run docs-by-product.',
      explanation: 'The equality query must return document IDs 5, 6, 7, 8 with a recorded Index Scan. A Seq Scan does not pass. ' + PG_ESTIMATE_LABEL,
      hints: ['Run EXPLAIN ANALYZE SELECT id FROM documents WHERE product = \'contoso-backup\' AND version = \'v2\' before indexing.', 'CREATE INDEX docs_product_version ON documents (product, version); rerun EXPLAIN ANALYZE and the app scenario.'],
      examNote: 'A multicolumn B-tree serves equality on its leading columns.',
      fields: ['code:assistant-api:search_by_metadata', 'pg:table:documents', 'pg:index:documents'],
      verification: { scenarioId: 'docs-by-product', scenarioVersion: 1 }, check: context => indexProof(context, 'btree', [5, 6, 7, 8], 'Index Scan', 'btree'),
      solution: { steps: [...DEPLOY_STEPS, explainProduct, sql('CREATE INDEX IF NOT EXISTS docs_product_version ON documents (product, version)'), explainProduct, scenario('docs-by-product')] } }),
    pgTask({ id: 'gin', stageId: 'indexes', text: 'Compare EXPLAIN ANALYZE before/after a GIN on metadata, then run docs-by-metadata.',
      explanation: 'JSON containment must return document IDs 1, 2 with a recorded Bitmap Heap Scan. Rerun docs-by-product after adding this index to refresh its plan proof. ' + PG_ESTIMATE_LABEL,
      hints: ['Use CREATE INDEX docs_metadata ON documents USING gin (metadata jsonb_path_ops).', 'Run EXPLAIN ANALYZE for metadata @> the JSON filter before and after, then refresh both app scenarios.'],
      examNote: 'GIN indexes make jsonb containment (@>) fast; jsonb_path_ops is smaller but supports fewer operators.',
      fields: ['code:assistant-api:search_by_metadata', 'pg:table:documents', 'pg:index:documents'],
      verification: { scenarioId: 'docs-by-metadata', scenarioVersion: 1 }, check: context => indexProof(context, 'gin', [1, 2], 'Bitmap Heap Scan', 'gin'),
      solution: { steps: [...DEPLOY_STEPS, explainMetadata, sql('CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops)'), explainMetadata, scenario('docs-by-product'), scenario('docs-by-metadata')] } }),
  ],
}

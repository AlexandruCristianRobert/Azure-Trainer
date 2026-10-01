import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { PG_GROUP, PG_CLUSTER, PG_REGISTRY, PG_NAMESPACE, PG_CLUSTER_ID, PG_DATA_TARGET,
  PG_SERVER_COMMAND, PG_ALLOW_VECTOR_COMMAND, PG_DATABASE_COMMAND, PG_SCHEMA_SQL, PG_HNSW_SQL, pgSqlCommand } from './postgres-helpers.js'

// Common state recipes import no sibling Lab. Later Labs can reproduce prior
// schema/corpus state while building only their own starter/faulty sources.
export function applyPostgresSeedActions(run, actions) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: run.project.manifestId, dataTarget: PG_DATA_TARGET,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, dataPostgres: true } }
  let seeded = run
  for (const action of actions) {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) {
      throw new Error(`PostgreSQL seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`)
    }
    seeded = result.run
  }
  return seeded
}
const command = line => ({ type: 'command', line })
const initialized = run => ({ sandbox: run.sandbox, artifacts: run.artifacts, runtime: run.runtime, nextSequence: run.nextSequence })

export function seedPostgresConnectGuided(run) {
  let seeded = applyPostgresSeedActions(run, [
    command(`az group create -n ${PG_GROUP} -l eastus`),
    command(`az acr create -g ${PG_GROUP} -n ${PG_REGISTRY} --sku Basic`),
    command(`az aks create -g ${PG_GROUP} -n ${PG_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${PG_REGISTRY}`),
    command(`az aks get-credentials -g ${PG_GROUP} -n ${PG_CLUSTER}`),
  ])
  // Fixture-only namespace, following the AKS/Data prerequisite convention.
  seeded.runtime.kubernetes.clusters[PG_CLUSTER_ID].resources[`Namespace//${PG_NAMESPACE}`] = {
    apiVersion: 'v1', kind: 'Namespace', metadata: { name: PG_NAMESPACE,
      uid: `fixture-${PG_CLUSTER_ID}-${PG_NAMESPACE}-namespace`, resourceVersion: '1' },
  }
  seeded = applyPostgresSeedActions(seeded, [command('kubectl apply -f k8s/service.yaml')])
  return initialized(seeded)
}

export function seedPostgresSchema(run) {
  const infrastructure = { ...run, ...seedPostgresConnectGuided(run) }
  // Scratch schema is only a prerequisite recipe; learner files are retained.
  const seeded = applyPostgresSeedActions(infrastructure, [
    command(PG_SERVER_COMMAND), command(PG_ALLOW_VECTOR_COMMAND), command(PG_DATABASE_COMMAND),
    { type: 'save-file', path: 'schema.sql', text: PG_SCHEMA_SQL },
    command(pgSqlCommand('-f schema.sql')), command(pgSqlCommand('-f load.sql')),
  ])
  return initialized(seeded)
}

export function seedPostgresApp(run, { imageTag = 'seed', commands = [] } = {}) {
  // Builds the caller's initial sources, never substitutes solved edit zones,
  // and records no verification evidence. Index/session recipes are optional.
  const seeded = { ...run, ...seedPostgresSchema(run) }
  const deployment = run.project.savedFiles['k8s/deployment.yaml'].replace(/assistant:[A-Za-z0-9_.-]+/g, `assistant:${imageTag}`)
  return initialized(applyPostgresSeedActions(seeded, [
    ...commands.map(command), command(`az acr build --registry ${PG_REGISTRY} --image assistant:${imageTag} .`),
    { type: 'save-file', path: 'k8s/deployment.yaml', text: deployment },
    command('kubectl apply -f k8s/deployment.yaml'),
  ]))
}

export function seedPostgresVectorGuided(run) {
  return seedPostgresApp(run, { imageTag: 'pg-vector-seed', commands: [
    `az postgres flexible-server update -g ${PG_GROUP} -n pg-assistant --tier Burstable --sku-name Standard_B1ms`,
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name maintenance_work_mem --value 1024`,
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_product_version ON documents (product, version)"'),
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops)"'),
  ] })
}

export function seedPostgresPoolingGuided(run) {
  return seedPostgresApp(run, { imageTag: 'pg-pooling-seed', commands: [
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name maintenance_work_mem --value 65536`,
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name max_connections --value 50`,
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_product_version ON documents (product, version)"'),
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops)"'),
    pgSqlCommand(`-c "${PG_HNSW_SQL}"`),
  ] })
}

export function seedPostgresIndependent(run) {
  // Reproduce Lab 7's optimized base state independently. The caller's
  // unfinished audience edit zones are built, and supplied v3 is not loaded.
  const seeded = { ...run, ...seedPostgresPoolingGuided(run) }
  return initialized(applyPostgresSeedActions(seeded, [
    command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name pgbouncer.enabled --value true`),
    command(`az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name pgbouncer.default_pool_size --value 20`),
    command('kubectl scale deployment/assistant-api -n assistant --replicas 6'),
  ]))
}

export function seedPostgresTroubleshooting(run) {
  // The incompatible distance index was built before the compute downgrade.
  // A later, visible maintenance stage drops it; no hidden incident flags.
  const seeded = { ...run, ...seedPostgresApp(run, { imageTag: 'pg-troubleshooting-seed', commands: [
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name maintenance_work_mem --value 65536`,
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name max_connections --value 50`,
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_product_version ON documents (product, version)"'),
    pgSqlCommand('-c "CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops)"'),
    pgSqlCommand('-c "CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_l2_ops)"'),
    `az postgres flexible-server update -g ${PG_GROUP} -n pg-assistant --tier Burstable --sku-name Standard_B1ms`,
    `az postgres flexible-server parameter set -g ${PG_GROUP} --server-name pg-assistant --name maintenance_work_mem --value 1024`,
  ] }) }
  return initialized(applyPostgresSeedActions(seeded, [command('kubectl scale deployment/assistant-api -n assistant --replicas 6')]))
}

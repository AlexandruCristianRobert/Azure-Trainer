import { EXAM_OBJECTIVES } from './taxonomy.js'

// Authored guidance only. These reference IDs are required in the published bank.
// Lab and Task IDs are catalog identifiers, never inferred from file names.
const definitions = [
  ['containers.image-identity', 'containers.registry-images', 'Image identity and registry access', 'Trace the image name, immutable version and runtime pull identity from build to deployment.', 'aca-deploy-guided', ['registry', 'identity', 'image']],
  ['containers.registry-automation', 'containers.registry-tasks', 'Registry build automation', 'Documentation-only: compare ACR Task triggers, credentials and build steps; no dedicated deeper ACR Tasks Lab is available.', null, []],
  ['containers.appservice-hosting', 'containers.appservice-container', 'App Service container hosting', 'Documentation-only: review container startup, configuration, registry access and logging in App Service; no App Service Lab is available.', null, []],
  ['containers.revision-release', 'containers.containerapps-revisions', 'Container Apps revision releases', 'Review revision configuration, traffic allocation and recovery; use the deployment Lab for deployment fundamentals.', 'aca-deploy-guided', ['deployment', 'response']],
  ['containers.scale-signals', 'containers.containerapps-keda', 'Container Apps scaling signals', 'Relate the scaling signal, replica limits and observed workload before choosing a scaling rule.', 'containerapps-keda', ['replica-limits', 'http-scaling']],
  ['containers.workload-manifests', 'containers.aks-manifests', 'AKS workload manifests', 'Trace image, pod configuration, deployment and registry access through the workload manifests.', 'aks-deploy-guided', ['registry-access', 'deployment']],
  ['containers.failure-layers', 'containers.container-diagnostics', 'Container failure diagnosis', 'Locate the failing layer using lifecycle, routing and dependency evidence before changing configuration.', 'aks-diagnosis-guided', ['logging', 'observe-selector', 'observe-lifecycle']],
  ['data.cosmos-history', 'data.cosmos-query', 'Partitioned conversation history', 'Compare point reads and partition-scoped queries for conversation history, including ordering and consistency requirements.', 'data-cosmos-sdk-guided', ['point-read', 'cross-partition', 'ordered']],
  ['data.cosmos-request-cost', 'data.cosmos-cost', 'Cosmos DB request cost', 'Inspect query scope and indexing choices alongside request cost; verify both reads and writes.', 'data-cosmos-troubleshooting', ['session-budget', 'write-cost']],
  ['data.cosmos-vector-search', 'data.cosmos-vector', 'Cosmos DB vector retrieval', 'Match vector policy and indexing to the embedding dimensions, distance function and query filters.', 'data-cosmos-vector-guided', ['qa-container', 'code-vectors', 'similar']],
  ['data.cosmos-feed-processing', 'data.cosmos-change-feed', 'Change feed processing', 'Trace lease ownership, checkpoints and repeat processing through a change feed worker.', 'data-cosmos-vector-guided', ['leases', 'code-feed', 'no-miss']],
  ['data.postgres-parameters', 'data.postgres-query', 'Parameterized PostgreSQL queries', 'Keep query parameters separate from SQL syntax and verify results for unusual input.', 'data-postgres-troubleshooting', ['quote-safe']],
  ['data.postgres-model', 'data.postgres-schema', 'PostgreSQL document schema', 'Relate tables, column types, constraints and extensions to the retrieval requirements.', 'data-postgres-connect-guided', ['extension', 'tables']],
  ['data.postgres-index-choice', 'data.postgres-index', 'PostgreSQL index selection', 'Choose indexes from actual predicates and inspect query plans rather than indexing every column.', 'data-postgres-connect-guided', ['btree', 'gin']],
  ['data.postgres-sizing', 'data.postgres-capacity', 'PostgreSQL resource sizing', 'Separate compute capacity, index build memory and query workload when investigating performance.', 'data-postgres-vector-guided', ['scale-up', 'build-memory']],
  ['data.postgres-filtered-rag', 'data.postgres-rag', 'Filtered PostgreSQL vector retrieval', 'Compare exact and approximate retrieval, then verify filtering, recall and returned context.', 'data-postgres-vector-guided', ['exact-knn', 'hnsw', 'filtered', 'answer']],
  ['data.postgres-pooling', 'data.postgres-connections', 'PostgreSQL connection pooling', 'Trace connection ownership and pool limits under concurrent load, including the application pool and PgBouncer.', 'data-postgres-pooling-guided', ['exhaust', 'app-pool', 'pgbouncer']],
  ['data.redis-cache', 'data.redis-cache', 'Redis cache freshness', 'Review cache keys, expiration and invalidation together; verify freshness after the source data changes.', 'data-redis-cache-guided', ['cache-expiry', 'stale-before-invalidate', 'fresh-after-invalidate']],
  ['data.redis-vector-search', 'data.redis-vector', 'Redis vector search isolation', 'Check index schema, embedding dimensions, distance settings and tenant filters against retrieved results.', 'data-redis-cache-guided', ['index', 'semantic-near-miss', 'filter-isolation']],
  ['connect.queue-acceptance', 'connect.servicebus', 'Reliable queue acceptance and settlement', 'Trace send acceptance, receive locks, settlement and duplicate handling through the order workflow.', 'messaging-send', ['send-order']],
  ['connect.event-routing', 'connect.eventgrid', 'Event filtering and delivery', 'Separate event publication, subscription filters and delivery recovery; inspect which consumer receives each event.', 'messaging-event-filters', ['filter-order-notifications', 'handle-filtered-event']],
  ['connect.http-validation', 'connect.functions-api', 'HTTP request validation and acceptance', 'Trace request validation, durable queue acceptance and the returned HTTP response through an order API.', 'http-functions-enqueue', ['enqueue-before-acknowledgement']],
  ['connect.host-configuration', 'connect.functions-host', 'Functions host configuration', 'Review deployed app settings, host configuration and trigger or binding settings as distinct concerns.', 'messaging-functions-servicebus', ['python-host-settings', 'servicebus-function']],
  ['secure.secret-lifecycle', 'secure.vault', 'Identity and secret lifecycle', 'Trace the runtime identity, vault authorization, secret version and consumer refresh during rotation.', 'security-rotation', ['create-key-version', 'consume-rotated-key']],
  ['secure.configuration-refresh', 'secure.appconfig', 'Configuration selection and refresh', 'Check label selection, vault references and refresh behavior at the running configuration provider.', 'security-refresh', ['refresh-existing-provider']],
  ['secure.trace-context', 'secure.otel', 'OpenTelemetry context and spans', 'Follow trace context across service boundaries and relate spans, logs and metrics to the same operation.', 'observability-context', ['construct-context']],
  ['secure.failure-query', 'secure.kql', 'KQL failure investigation', 'Choose telemetry tables and correlation fields, then filter and summarize the operation being investigated.', 'observability-failure-query', ['construct-failure-query']],
]

export const EXAM_CONCEPTS = Object.freeze(definitions.map(([id, objectiveId, title, advice, labId, tasks]) => Object.freeze({
  id, objectiveId, title, advice,
  referenceIds: Object.freeze([`ref-${objectiveId}`]),
  labIds: Object.freeze(labId ? [labId] : []),
  taskIds: Object.freeze(tasks.map(taskId => Object.freeze({ labId, taskId }))),
})))

// Keep the authoring contract complete when objectives are intentionally extended.
if (EXAM_OBJECTIVES.some(o => !EXAM_CONCEPTS.some(c => c.objectiveId === o.id))) throw new Error('Missing authored exam concept')

// Shared SDK call catalog (ADR-0003): every learner-facing SDK call the Data
// journey recognizes is declared once here, with its receiver, its Python
// parameter names (positional args bind to these in order) and which of them
// are required. The Python recognizer (python-sdk.js) is the only consumer;
// it never executes Python (ADR-0002/0003), it only looks calls up here.

export const SDK_CALLS = {
  'postgres.module.connect': { kind: 'constructor', params: ['conninfo', 'autocommit', 'row_factory'], required: ['conninfo'], keywordOnly: ['autocommit', 'row_factory'], returns: 'pg-connection' },
  'postgres.pool.ConnectionPool': { kind: 'constructor', params: ['conninfo', 'min_size', 'max_size', 'open', 'kwargs'], required: ['conninfo'], keywordOnly: ['min_size', 'max_size', 'open', 'kwargs'], returns: 'pg-pool' },
  'postgres.pool.connection': { kind: 'method', receiver: 'pg-pool', params: [], required: [], returns: 'pg-connection' },
  'postgres.connection.execute': { kind: 'method', receiver: 'pg-connection', params: ['query', 'params'], required: ['query'], returns: 'pg-cursor' },
  'postgres.connection.cursor': { kind: 'method', receiver: 'pg-connection', params: ['row_factory'], required: [], keywordOnly: ['row_factory'], returns: 'pg-cursor' },
  'postgres.cursor.execute': { kind: 'method', receiver: 'pg-cursor', params: ['query', 'params'], required: ['query'], returns: 'pg-cursor' },
  'postgres.cursor.fetchall': { kind: 'method', receiver: 'pg-cursor', params: [], required: [] },
  'postgres.cursor.fetchone': { kind: 'method', receiver: 'pg-cursor', params: [], required: [] },
  'postgres.connection.close': { kind: 'method', receiver: 'pg-connection', params: [], required: [] },
  'postgres.cursor.close': { kind: 'method', receiver: 'pg-cursor', params: [], required: [] },
  'postgres.register_vector': { kind: 'wiring', params: ['conn'], required: ['conn'] },
  'postgres.Jsonb': { kind: 'constructor', params: ['obj'], required: ['obj'] },
  'cosmos.CosmosClient': { kind: 'constructor', params: ['url', 'credential', 'consistency_level'], required: ['url', 'credential'] },
  'cosmos.client.get_database_client': { kind: 'wiring', receiver: 'cosmos-client', params: ['id'], required: ['id'] },
  'cosmos.database.get_container_client': { kind: 'wiring', receiver: 'cosmos-database', params: ['id'], required: ['id'] },
  'cosmos.container.read_item': { kind: 'method', receiver: 'cosmos-container', params: ['item', 'partition_key'], required: ['item', 'partition_key'] },
  'cosmos.container.query_items': { kind: 'method', receiver: 'cosmos-container', params: ['query', 'parameters', 'partition_key', 'enable_cross_partition_query', 'max_item_count'], required: ['query'] },
  'cosmos.container.upsert_item': { kind: 'method', receiver: 'cosmos-container', params: ['body'], required: ['body'] },
  'cosmos.container.create_item': { kind: 'method', receiver: 'cosmos-container', params: ['body'], required: ['body'] },
  'cosmos.container.delete_item': { kind: 'method', receiver: 'cosmos-container', params: ['item', 'partition_key'], required: ['item', 'partition_key'] },
  'cosmos.container.query_items_change_feed': { kind: 'method', receiver: 'cosmos-container', params: ['start_time', 'continuation', 'partition_key', 'max_item_count'], required: [], keywordOnly: ['start_time'] },
  'cosmos.container.last_continuation': { kind: 'attribute', receiver: 'cosmos-container', path: 'client_connection.last_response_headers["etag"]' },
}

// receiverType is a manifest.receivers value (e.g. 'cosmos-container'); name is
// the Python attribute/method name (e.g. 'read_item'). Returns the catalog
// entry augmented with its dotted `key` (e.g. 'cosmos.container.read_item'),
// or undefined when no such call is in the catalog.
export function lookupCall(receiverType, name) {
  const prefix = receiverType.startsWith('pg-') ? `postgres.${receiverType.slice(3)}` : receiverType.replace(/-/g, '.')
  const key = `${prefix}.${name}`
  const entry = SDK_CALLS[key]
  return entry ? { key, ...entry } : undefined
}

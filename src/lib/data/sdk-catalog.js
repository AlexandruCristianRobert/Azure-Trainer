// Shared SDK call catalog (ADR-0003): every learner-facing SDK call the Data
// journey recognizes is declared once here, with its receiver, its Python
// parameter names (positional args bind to these in order) and which of them
// are required. The Python recognizer (python-sdk.js) is the only consumer;
// it never executes Python (ADR-0002/0003), it only looks calls up here.

export const SDK_CALLS = {
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
  const key = `${receiverType.replace(/-/g, '.')}.${name}`
  const entry = SDK_CALLS[key]
  return entry ? { key, ...entry } : undefined
}

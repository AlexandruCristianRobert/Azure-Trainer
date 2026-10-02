import { POSTGRES_SOLUTION_FUNCTIONS, POSTGRES_NAIVE_CLIENTS } from './postgres.js'
import { REDIS_SOLUTION_FUNCTIONS } from './redis.js'
import { CAPSTONE_RUNTIME_MANIFEST, CAPSTONE_HELPER_FILES } from './capstone-runtime.js'

export const DATA_CAPSTONE_TARGET = Object.freeze({
  kind: 'composite',
  postgres: Object.freeze({ kind: 'postgres', resourceGroup: 'rg-data-capstone', server: 'pg-assistant', database: 'knowledge', port: 5432 }),
  cosmos: Object.freeze({ account: 'cosmos-assistant', database: 'knowledge' }),
  redis: Object.freeze({ kind: 'redis', resourceGroup: 'rg-data-capstone', cluster: 'redis-assistant' }),
})
const CLIENTS = `${POSTGRES_NAIVE_CLIENTS}
from azure.cosmos import CosmosClient
import redis

# Fictional training-only credentials; never use outside this Lab.
cache = redis.Redis(host="redis-assistant.eastus.redis.training.invalid", port=10000, password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)
client = CosmosClient("https://cosmos-assistant.documents.azure.com:443/", credential="training-only-key", consistency_level="Session")
db = client.get_database_client("knowledge")
sessions = db.get_container_client("sessions")
qa_history = db.get_container_client("qa_history")
events = db.get_container_client("events")
leases = db.get_container_client("leases")
`
// Incident replacement accepts these complete authored client variants only.
const pooledClients = (port, size) => CLIENTS.replace(POSTGRES_NAIVE_CLIENTS,
  `from psycopg_pool import ConnectionPool\nfrom psycopg.rows import dict_row\n\nDSN = "host=pg-assistant.postgres.database.azure.com port=${port} dbname=knowledge user=assistant_admin password=Training-Only-Pa55! sslmode=require"\npool = ConnectionPool(DSN, min_size=1, max_size=${size}, kwargs={"row_factory": dict_row})\n\ndef connect():\n    return pool.connection()\n`)
export const DATA_CAPSTONE_CLIENT_VARIANTS = Object.freeze({ naive: CLIENTS, pooled: pooledClients(5432, 5), fault: pooledClients(5432, 12), fixed: pooledClients(6432, 4) })
export const DATA_CAPSTONE_FAULTY_PROCESS_CHANGES = `def process_changes():
    # Incident: ignores the durable lease and starts after pending events.
    changes = list(events.query_items_change_feed(start_time="Now"))
    for item in changes:
        apply_change(item)
    # Incident: no durable checkpoint is saved.
    return len(changes)
`
const APP_HEADER = `"""Fictional Knowledge Assistant: PG sources, Redis caches, Cosmos history."""
from clients import connect, cache, sessions, qa_history, events
from pgvector.psycopg import register_vector
from training_runtime import embed, training_answer, training_no_match, response_key, semantic_key, encode_answer, decode_answer, pack_embedding, decode_search

`
// This wrapper is ordinary parsed Python, so hits retain real Redis origins.
const CACHE_LOOKUP = `def cache_lookup(question, product, version, language):
    value = cache.get(response_key(question, product, version, language))
    if value is not None:
        return decode_answer(value)
    return semantic_lookup(question, product, version, language, 0.05)
`
const RAG_ROUTE = `def rag_route(question, product, version, language):
    return rag_answer(question, product, version, language)
`
const WORKER_HEADER = `"""Pull-model worker; this lease is an application checkpoint, not a managed
Cosmos change-feed processor lease. The separate worker_server.py polls it."""
from clients import events, leases
from app import invalidate_product

`
export const DATA_CAPSTONE_SOLUTION_FUNCTIONS = Object.freeze({
  retrieve_passages: POSTGRES_SOLUTION_FUNCTIONS.retrieve_passages.replace('SET hnsw.iterative_scan', 'SET LOCAL hnsw.iterative_scan'),
  build_context: POSTGRES_SOLUTION_FUNCTIONS.build_context,
  rag_answer: `def rag_answer(question, product, version, language):
    rows = retrieve_passages(question, product, version, language)
    if len(rows) == 0:
        return {"answer": training_no_match(rows), "sources": rows, "product": product, "version": version, "language": language}
    context = build_context(rows)
    return {"answer": training_answer(question, context), "sources": context["sources"], "product": product, "version": version, "language": language}
`,
  cached_answer: `def cached_answer(question, product, version, language, ttl):
    key = response_key(question, product, version, language)
    value = cache.get(key)
    if value is not None:
        return decode_answer(value)
    result = rag_answer(question, product, version, language)
    cache.set(key, encode_answer(result), ex=ttl)
    return result
`,
  semantic_lookup: REDIS_SOLUTION_FUNCTIONS.semantic_lookup.replace('    query =', '    if embed(question) == [0, 0, 0, 0, 0, 0, 0, 0]:\n        return None\n    query ='),
  remember_semantic: REDIS_SOLUTION_FUNCTIONS.remember_semantic.replace('    key =', '    if embed(question) == [0, 0, 0, 0, 0, 0, 0, 0]:\n        return None\n    key ='),
  invalidate_product: REDIS_SOLUTION_FUNCTIONS.invalidate_product,
  answer: `def answer(question, product, version, language, session_id, message_id):
    result = cache_lookup(question, product, version, language)
    if result is None:
        result = cached_answer(question, product, version, language, 60)
        remember_semantic(question, product, version, language, result, 60)
    save_message(session_id, message_id, question, product, version, language, result)
    remember_answer(session_id, message_id, question, product, version, language, result)
    return result
`,
  save_message: `def save_message(session_id, message_id, question, product, version, language, result):
    return sessions.upsert_item({"id": message_id, "sessionId": session_id, "question": question, "product": product, "version": version, "language": language, "answer": result["answer"], "sources": result["sources"]})
`,
  get_session: `def get_session(session_id, message_id):
    return sessions.read_item(item=message_id, partition_key=session_id)
`,
  remember_answer: `def remember_answer(session_id, message_id, question, product, version, language, result):
    return qa_history.upsert_item({"id": session_id + ":" + message_id, "sessionId": session_id, "messageId": message_id, "product": product, "version": version, "language": language, "question": question, "answer": result["answer"], "sources": result["sources"], "embedding": embed(question)})
`,
  find_similar_questions: `def find_similar_questions(question, product, version, language):
    # The shared Cosmos cosine score is similarity: >= 0.95 is distance <= 0.05.
    # https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance
    return list(qa_history.query_items(query="SELECT TOP 3 c.id, c.question, c.answer, c.sources, c.product, c.version, c.language, VectorDistance(c.embedding, @embedding) AS score FROM c WHERE c.product = @product AND c.version = @version AND c.language = @language AND VectorDistance(c.embedding, @embedding) >= 0.95 ORDER BY VectorDistance(c.embedding, @embedding)", parameters=[{"name": "@product", "value": product}, {"name": "@version", "value": version}, {"name": "@language", "value": language}, {"name": "@embedding", "value": embed(question)}], partition_key=product))
`,
  submit_feedback: `def submit_feedback(event_id, product, positive):
    event_type = "negative-feedback"
    if positive == True:
        event_type = "positive-feedback"
    return events.create_item({"id": event_id, "product": product, "type": event_type})
`,
  read_lease: `def read_lease():
    # Empty query works for both the real SDK and bounded first-batch runtime.
    rows = leases.query_items(query="SELECT * FROM c WHERE c.id = @id", parameters=[{"name": "@id", "value": "feedback-worker"}], partition_key="feedback-worker")
    return next(iter(rows), None)
`,
  save_lease: `def save_lease(continuation):
    return leases.upsert_item({"id": "feedback-worker", "continuation": continuation})
`,
  apply_change: `def apply_change(item):
    if item["type"] == "negative-feedback":
        invalidate_product(item["product"])
    if item["type"] == "document-update":
        invalidate_product(item["product"])
    return item["id"]
`,
  process_changes: `def process_changes():
    lease = read_lease()
    continuation = None
    start_time = "Beginning"
    if lease is not None:
        continuation = lease.get("continuation")
        start_time = None
    changes = list(events.query_items_change_feed(start_time=start_time, continuation=continuation))
    for item in changes:
        apply_change(item)
    # Failure stops before this durable checkpoint; retry replays the batch.
    new_continuation = events.client_connection.last_response_headers["etag"]
    save_lease(new_continuation)
    return len(changes)
`,
})
const SERVER = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import app

ROUTES = {
    ("GET", "/rag"): (app.rag_route, ["question", "product", "version", "language"]),
    ("GET", "/answer"): (app.answer, ["question", "product", "version", "language", "session_id", "message_id"]),
    ("GET", "/sessions"): (app.get_session, ["session_id", "message_id"]),
    ("GET", "/similar"): (app.find_similar_questions, ["question", "product", "version", "language"]),
    ("POST", "/feedback"): (app.submit_feedback, ["event_id", "product", "positive"]),
}

class Handler(BaseHTTPRequestHandler):
    def _dispatch(self, method):
        route = ROUTES.get((method, self.path.split("?", 1)[0]))
        if route is None:
            self.send_error(404)
            return
        handler, names = route
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 65536:
                raise ValueError("bounded request body required")
            payload = json.loads(self.rfile.read(size) or b"{}")
            args = [payload[name] for name in names]
            for name, value in zip(names, args):
                if name == "positive":
                    if not isinstance(value, bool):
                        raise ValueError("positive must be boolean")
                elif not isinstance(value, str) or not value or len(value) > 8192:
                    raise ValueError("non-empty bounded string required")
        except (ValueError, KeyError, TypeError, UnicodeDecodeError):
            self.send_error(400)
            return
        body = json.dumps(handler(*args), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
`
const WORKER_SERVER = `"""Real Python host polls batches. Simulator controls execute one batch."""
import time
import worker

while True:
    try:
        worker.process_changes()
    except Exception as error:
        # The last durable lease stays unchanged when a batch fails.
        print("Worker batch failed:", type(error).__name__, flush=True)
    time.sleep(5)
`
export const DATA_CAPSTONE_SCHEMA = `CREATE TABLE IF NOT EXISTS documents (
    id bigint PRIMARY KEY,
    product text,
    version text,
    language text,
    metadata jsonb,
    body text,
    updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS chunks (
    id bigint PRIMARY KEY,
    document_id bigint REFERENCES documents(id),
    chunk_index integer,
    content text,
    embedding vector(8)
);
-- simulator:load-capstone-corpus
`
const deployment = (name, worker = false) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: assistant
spec:
  replicas: ${worker ? 1 : 2}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
        - name: ${worker ? 'worker' : 'api'}
          image: acrassistant.azurecr.io/assistant:v1
          imagePullPolicy: Always
${worker ? '          command: ["python", "worker_server.py"]\n' : ''}          ports:
            - name: http
              containerPort: 8080
`
const SERVICE = `apiVersion: v1
kind: Service
metadata:
  name: assistant-api
  namespace: assistant
spec:
  type: ClusterIP
  selector:
    app: assistant-api
  ports:
    - port: 80
      targetPort: http
`
export const DATA_CAPSTONE_POLICIES = Object.freeze({
  'policies/qa-vector.json': JSON.stringify({ vectorEmbeddings: [{ path: '/embedding', dataType: 'float32', dimensions: 8, distanceFunction: 'cosine' }] }),
  'policies/qa-indexing.json': JSON.stringify({ indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [{ path: '/embedding/*' }], vectorIndexes: [{ path: '/embedding', type: 'quantizedFlat' }] }),
  'policies/sessions-indexing.json': JSON.stringify({ indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] }),
})
const COMMON_FILES = {
  ...CAPSTONE_HELPER_FILES, ...DATA_CAPSTONE_POLICIES,
  'clients.py': CLIENTS, 'server.py': SERVER, 'worker_server.py': WORKER_SERVER,
  Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nRUN pip install azure-cosmos "psycopg[binary]" psycopg_pool pgvector redis\nCOPY app.py worker.py clients.py training_runtime.py server.py worker_server.py ./\nEXPOSE 8080\nCMD ["python", "server.py"]\n',
  'schema.sql': DATA_CAPSTONE_SCHEMA,
  'indexes.sql': '',
  'k8s/deployment.yaml': deployment('assistant-api'), 'k8s/worker.yaml': deployment('feedback-worker', true), 'k8s/service.yaml': SERVICE,
}
const workerNames = ['read_lease', 'save_lease', 'apply_change', 'process_changes']
const appNames = Object.keys(DATA_CAPSTONE_SOLUTION_FUNCTIONS).filter(name => !workerNames.includes(name))
const starter = name => `${DATA_CAPSTONE_SOLUTION_FUNCTIONS[name].split('\n')[0]}\n    raise NotImplementedError("Lab task")\n`
export const DATA_CAPSTONE_STARTER_FILES = Object.freeze({ ...COMMON_FILES,
  'app.py': APP_HEADER + CACHE_LOOKUP + '\n' + RAG_ROUTE + '\n' + appNames.map(starter).join('\n'),
  'worker.py': WORKER_HEADER + workerNames.map(starter).join('\n'),
})
export const DATA_CAPSTONE_SOLUTION_FILES = Object.freeze({ ...COMMON_FILES,
  'app.py': APP_HEADER + CACHE_LOOKUP + '\n' + RAG_ROUTE + '\n' + appNames.map(name => DATA_CAPSTONE_SOLUTION_FUNCTIONS[name]).join('\n'),
  'worker.py': WORKER_HEADER + workerNames.map(name => DATA_CAPSTONE_SOLUTION_FUNCTIONS[name]).join('\n'),
})
export const DATA_CAPSTONE_ROUTES = Object.freeze({ 'GET /rag': 'rag_route', 'GET /answer': 'answer', 'GET /sessions': 'get_session', 'GET /similar': 'find_similar_questions', 'POST /feedback': 'submit_feedback', 'worker:batch': 'process_changes', 'worker:item': 'apply_change' })
export const DATA_CAPSTONE_ROUTE_ARGS = Object.freeze({ 'GET /rag': ['question', 'product', 'version', 'language'], 'GET /answer': ['question', 'product', 'version', 'language', 'session_id', 'message_id'], 'GET /sessions': ['session_id', 'message_id'], 'GET /similar': ['question', 'product', 'version', 'language'], 'POST /feedback': ['event_id', 'product', 'positive'], 'worker:batch': [], 'worker:item': ['item'] })
export const DATA_CAPSTONE_EDIT_ZONES = Object.freeze(Object.keys(DATA_CAPSTONE_SOLUTION_FUNCTIONS))
const BUILD_FILES = Object.freeze(['app.py', 'worker.py', 'clients.py', 'training_runtime.py', 'server.py', 'worker_server.py', 'Dockerfile'])
const KUBERNETES_FILES = Object.freeze(['k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/worker.yaml'])
export const DATA_CAPSTONE_MANIFEST = Object.freeze({
  id: 'data-python-capstone-v1', language: 'python', runtimeFamily: 'aks', dataApp: true, dataBackend: 'composite', dataTarget: DATA_CAPSTONE_TARGET,
  ...CAPSTONE_RUNTIME_MANIFEST,
  files: Object.freeze(Object.keys(DATA_CAPSTONE_STARTER_FILES)), buildFiles: BUILD_FILES, kubernetesFiles: KUBERNETES_FILES,
  pythonInstallInstruction: 'RUN pip install azure-cosmos "psycopg[binary]" psycopg_pool pgvector redis',
  fixedFiles: Object.freeze({ ...CAPSTONE_HELPER_FILES, ...DATA_CAPSTONE_POLICIES, 'server.py': SERVER, 'worker_server.py': WORKER_SERVER, 'schema.sql': DATA_CAPSTONE_SCHEMA }),
  fixedFunctions: Object.freeze({ 'app.py': Object.freeze({ cache_lookup: CACHE_LOOKUP, rag_route: RAG_ROUTE }) }),
  editZones: DATA_CAPSTONE_EDIT_ZONES, receivers: Object.freeze({ sessions: 'cosmos-container', qa_history: 'cosmos-container', events: 'cosmos-container', leases: 'cosmos-container' }),
  routes: DATA_CAPSTONE_ROUTES, routeArgs: DATA_CAPSTONE_ROUTE_ARGS,
  maxFiles: 20, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})

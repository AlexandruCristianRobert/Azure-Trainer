import { CORPUS, corpusQuestions } from '../../fixtures/data/corpus.js'

// Imports use canonical SDK names understood by the bounded recognizer.
export const POSTGRES_DSN = 'host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin password=Training-Only-Pa55! sslmode=require'
export const POSTGRES_POOL_CLIENTS = `from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

DSN = "${POSTGRES_DSN}"
pool = ConnectionPool(DSN, min_size=1, max_size=5, kwargs={"row_factory": dict_row})

def connect():
    return pool.connection()
`
// Lab 7 swaps only clients.py: every app query keeps importing connect().
export const POSTGRES_NAIVE_CLIENTS = `import psycopg
from psycopg.rows import dict_row

DSN = "${POSTGRES_DSN}"

def connect():
    return psycopg.connect(DSN, row_factory=dict_row)
`

const HEADER = `"""Fictional Knowledge Assistant. SQL executes through psycopg; the supplied
training helper provides authored vectors and source-grounded fixture answers.
"""
from clients import connect
from pgvector.psycopg import register_vector
from psycopg.types.json import Jsonb
from training_runtime import embed, training_answer

`
export const POSTGRES_SOLUTION_FUNCTIONS = Object.freeze({
  get_document: `def get_document(document_id):
    with connect() as conn:
        return conn.execute("SELECT id, product, version, language, metadata, body FROM documents WHERE id = %s", (document_id,)).fetchall()
`,
  search_by_metadata: `def search_by_metadata(product, version, metadata=None):
    # Route args: [product, version] for B-tree equality, or
    # [product, version, {"language": "en"}] for JSON containment.
    with connect() as conn:
        if metadata is not None:
            return conn.execute("SELECT id, product, version, language, metadata FROM documents WHERE metadata @> %s ORDER BY id LIMIT 5", (Jsonb(metadata),)).fetchall()
        return conn.execute("SELECT id, product, version, language, metadata FROM documents WHERE product = %s AND version = %s ORDER BY id LIMIT 5", (product, version)).fetchall()
`,
  retrieve_passages: `def retrieve_passages(question, product, version, language):
    embedding = embed(question)
    with connect() as conn:
        register_vector(conn)
        conn.execute("SET hnsw.iterative_scan = strict_order")
        return conn.execute("SELECT c.id, c.document_id, c.content, d.product, d.version, d.language, d.metadata, c.embedding <=> %s::vector AS distance FROM chunks c JOIN documents d ON c.document_id = d.id WHERE d.product = %s AND d.version = %s AND d.language = %s AND c.embedding <=> %s::vector < 0.2 ORDER BY c.embedding <=> %s::vector LIMIT 2", (embedding, product, version, language, embedding, embedding)).fetchall()
`,
  build_context: `def build_context(rows):
    sources = []
    passages = []
    for row in rows:
        sources.append(row["id"])
        passages.append(row["content"])
    return {"sources": sources, "passages": "\\n\\n".join(passages)}
`,
  answer: `def answer(question, product, version, language):
    rows = retrieve_passages(question, product, version, language)
    if len(rows) == 0:
        return {"answer": "I couldn't find that in the documentation.", "sources": []}
    context = build_context(rows)
    return {"answer": training_answer(question, context), "sources": context["sources"]}
`,
})

const BASELINE = `"""Fixed exact-search baseline: independent of unfinished retrieval/context edits.
The secondary ID sort makes this an exhaustive route in the bounded simulator.
"""
from clients import connect
from pgvector.psycopg import register_vector
from training_runtime import embed

def exact_baseline(question):
    embedding = embed(question)
    with connect() as conn:
        register_vector(conn)
        return conn.execute("SELECT c.id, c.document_id, c.content, d.product, d.version, d.language, d.metadata, c.embedding <=> %s::vector AS distance FROM chunks c JOIN documents d ON c.document_id = d.id ORDER BY c.embedding <=> %s::vector, c.id LIMIT 2", (embedding, embedding)).fetchall()
`

// Valid Python, with the very same authored mapping used by runtime.js. This
// module is protected scaffold; it declares fixture behavior, never executes.
const TRAINING_RUNTIME = `"""Authored local training fixtures; no model or network call."""
QUESTIONS = ${JSON.stringify(corpusQuestions())}
CHUNKS = ${JSON.stringify(CORPUS.chunks)}

def embed(question):
    for entry in QUESTIONS:
        if entry["text"] == question:
            return list(entry["vector"])
    return [0.0] * 8

def training_answer(question, context):
    sources = context.get("sources", [])
    passages = context.get("passages", "")
    if not sources or not isinstance(passages, str) or not passages:
        return "I could not find a relevant passage in the supplied sources."
    for chunk in CHUNKS:
        if chunk["id"] == sources[0] and chunk["content"] in passages:
            for entry in QUESTIONS:
                if sources[0] in entry["expectedChunkIds"]:
                    return entry["answer"]
            return chunk["content"]
    return "I could not find a relevant passage in the supplied sources."
`

const SERVER = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import app
from baseline import exact_baseline

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        value = lambda key: query.get(key, [""])[0]
        if url.path.startswith("/documents/"):
            result = app.get_document(int(url.path.rsplit("/", 1)[1]))
        elif url.path == "/documents":
            metadata = json.loads(value("metadata")) if value("metadata") else None
            result = app.search_by_metadata(value("product"), value("version"), metadata)
        elif url.path == "/baseline/exact":
            result = exact_baseline(value("question"))
        elif url.path in ("/retrieve", "/answer"):
            handler = app.retrieve_passages if url.path == "/retrieve" else app.answer
            result = handler(value("question"), value("product"), value("version"), value("language"))
        else:
            self.send_error(404)
            return
        body = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
`
const SCHEMA = `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
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
`
const DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant-api
  namespace: assistant
spec:
  replicas: 2
  selector:
    matchLabels:
      app: assistant-api
  template:
    metadata:
      labels:
        app: assistant-api
    spec:
      containers:
        - name: api
          image: acrassistant.azurecr.io/assistant:v1
          imagePullPolicy: Always
          ports:
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
export const POSTGRES_EDIT_ZONES = Object.freeze(Object.keys(POSTGRES_SOLUTION_FUNCTIONS))
export const POSTGRES_ROUTES = Object.freeze({ 'GET /documents/{id}': 'get_document', 'GET /documents': 'search_by_metadata', 'GET /retrieve': 'retrieve_passages', 'GET /answer': 'answer', 'GET /baseline/exact': 'exact_baseline' })
export const POSTGRES_BUILD_FILES = Object.freeze(['app.py', 'clients.py', 'baseline.py', 'training_runtime.py', 'server.py', 'Dockerfile'])
export const POSTGRES_KUBERNETES_FILES = Object.freeze(['k8s/deployment.yaml', 'k8s/service.yaml'])
export const POSTGRES_FILES = Object.freeze([...POSTGRES_BUILD_FILES, 'schema.sql', 'load.sql', ...POSTGRES_KUBERNETES_FILES])
export const POSTGRES_MANIFEST = Object.freeze({
  id: 'data-python-postgres-v1', language: 'python', runtimeFamily: 'aks', dataApp: true,
  files: POSTGRES_FILES, buildFiles: POSTGRES_BUILD_FILES, kubernetesFiles: POSTGRES_KUBERNETES_FILES,
  fixedFiles: Object.freeze({ 'server.py': SERVER, 'training_runtime.py': TRAINING_RUNTIME, 'baseline.py': BASELINE }),
  editZones: POSTGRES_EDIT_ZONES, runtimeFiles: Object.freeze(['baseline.py']), runtimeFunctions: Object.freeze(['exact_baseline']),
  receivers: Object.freeze({ pool: 'pg-pool' }), routes: POSTGRES_ROUTES,
  maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})
const COMMON_FILES = {
  'clients.py': POSTGRES_POOL_CLIENTS, 'baseline.py': BASELINE, 'training_runtime.py': TRAINING_RUNTIME, 'server.py': SERVER,
  'schema.sql': SCHEMA, 'load.sql': '-- simulator:load-corpus\n',
  Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nRUN pip install "psycopg[binary]" psycopg_pool pgvector\nCOPY app.py clients.py baseline.py training_runtime.py server.py ./\nEXPOSE 8080\nCMD ["python", "server.py"]\n',
  'k8s/deployment.yaml': DEPLOYMENT, 'k8s/service.yaml': SERVICE,
}
const STARTER_SIGNATURES = ['get_document(document_id)', 'search_by_metadata(product, version, metadata=None)', 'retrieve_passages(question, product, version, language)', 'build_context(rows)', 'answer(question, product, version, language)']
export const POSTGRES_STARTER_FILES = Object.freeze({ ...COMMON_FILES, 'app.py': HEADER + STARTER_SIGNATURES.map(signature => `def ${signature}:\n    raise NotImplementedError("Lab task")\n`).join('\n\n') })
export const POSTGRES_SOLUTION_FILES = Object.freeze({ ...COMMON_FILES, 'app.py': HEADER + Object.values(POSTGRES_SOLUTION_FUNCTIONS).join('\n\n') })

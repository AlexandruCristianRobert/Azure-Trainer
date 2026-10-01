// Cosmos Knowledge Assistant template (ADR-0002/0003, Task 7): the Data
// journey's AKS app. Mirrors the style of
// src/data/templates/aks-python/integration.js, but its app.py/worker.py
// edit zones are lowered by parseDataApp (python-sdk.js), not
// parsePythonProject's teaching subset - the simulator serves recognized
// Cosmos SDK calls from the Sandbox (runtime.js) instead of executing Python.

const CLIENTS_PY = `from azure.cosmos import CosmosClient

COSMOS_URL = "https://cosmos-assistant.documents.azure.com:443/"
COSMOS_KEY = "training-only-key"

client = CosmosClient(COSMOS_URL, credential=COSMOS_KEY, consistency_level="Session")
db = client.get_database_client("assistant")
sessions = db.get_container_client("sessions")
qa_history = db.get_container_client("qa_history")
feedback = db.get_container_client("feedback")
leases = db.get_container_client("leases")
tally = db.get_container_client("tally")
`

const APP_PY_HEADER = `"""Knowledge Assistant API: conversation history and Q&A memory, backed by
Cosmos DB for NoSQL. Route handlers dispatched by server.py (fixed) via
COSMOS_MANIFEST.routes. Container clients (sessions, qa_history, feedback,
leases, tally) live in clients.py.
"""
from clients import feedback, qa_history, sessions

`

const APP_PY_SOLUTION_BODY = `def save_message(message):
    # POST /messages: append one conversation turn. message is a dict with
    # id, sessionId, userId, role, text, createdAt. Partition key: /sessionId.
    return sessions.upsert_item(message)


def get_session(message_id, session_id):
    # GET /sessions/{id}: point read one stored message by id and session id.
    return sessions.read_item(item=message_id, partition_key=session_id)


def recent_sessions_for_user(user_id):
    # GET /users/{id}/sessions: every stored message for one user.
    return sessions.query_items(
        query="SELECT * FROM c WHERE c.userId = @userId ORDER BY c.userId ASC, c.createdAt DESC",
        parameters=[{"name": "@userId", "value": user_id}],
        enable_cross_partition_query=True,
    )


def remember_answer(entry):
    # POST /answers: store one answered question with its embedding. entry is
    # a dict with id, product, question, answer, embedding, createdAt.
    # Partition key: /product.
    return qa_history.upsert_item(entry)


def find_similar_questions(product, embedding, k):
    # GET /similar: the k closest stored questions for one product, ranked by
    # cosine similarity to the supplied embedding. A similarity floor (0.9)
    # keeps a merely-related question from being returned as if it answered
    # the one actually asked.
    return qa_history.query_items(
        query="SELECT TOP @k c.id, c.question, c.answer, VectorDistance(c.embedding, @embedding) AS score FROM c WHERE c.product = @product AND VectorDistance(c.embedding, @embedding) >= 0.9 ORDER BY VectorDistance(c.embedding, @embedding)",
        parameters=[
            {"name": "@product", "value": product},
            {"name": "@embedding", "value": embedding},
            {"name": "@k", "value": k},
        ],
    )


def question_feedback(question_id):
    # GET /questions/{id}/feedback: every feedback item stored for one
    # question. Partition key: /questionId.
    return feedback.query_items(
        query="SELECT * FROM c WHERE c.questionId = @questionId",
        parameters=[{"name": "@questionId", "value": question_id}],
        partition_key=question_id,
    )
`

const APP_PY_STARTER_BODY = `def save_message(message):
    raise NotImplementedError("Lab task")


def get_session(message_id, session_id):
    raise NotImplementedError("Lab task")


def recent_sessions_for_user(user_id):
    raise NotImplementedError("Lab task")


def remember_answer(entry):
    raise NotImplementedError("Lab task")


def find_similar_questions(product, embedding, k):
    raise NotImplementedError("Lab task")


def question_feedback(question_id):
    raise NotImplementedError("Lab task")
`

const WORKER_PY_HEADER = `"""Feedback worker: processes the feedback container's change feed and keeps
a per-question tally of positive feedback. Runs as its own Pod
(feedback-worker Deployment), separate from the assistant API, via
\`command: ["python", "worker.py"]\` overriding the shared image's default
entrypoint (\`python server.py\`).
"""
from clients import feedback, leases, tally


def read_lease():
    # Fixed by the scaffold. Simulator-only: this read_item call returns None
    # on a missing lease instead of raising, so "no checkpoint yet" behaves
    # like an empty result here. Against the real SDK, catch the not-found
    # error instead:
    #   try:
    #       return leases.read_item(item="feedback-worker", partition_key="feedback-worker")
    #   except CosmosResourceNotFoundError:
    #       return None
    return leases.read_item(item="feedback-worker", partition_key="feedback-worker")


`

const WORKER_PY_SOLUTION_BODY = `def save_lease(continuation):
    # Persist the worker's change feed checkpoint so a restarted Pod resumes
    # from here instead of missing or replaying everything.
    return leases.upsert_item({"id": "feedback-worker", "continuation": continuation})


def process_changes():
    lease = read_lease()
    continuation = None
    start_time = "Beginning"
    if lease is not None:
        continuation = lease.get("continuation")
        start_time = None
    # The change feed result is an iterator against the real SDK, so collect
    # it before counting - len() on the iterator itself would fail.
    changes = list(feedback.query_items_change_feed(start_time=start_time, continuation=continuation))
    for change in changes:
        apply_feedback(change)
    new_continuation = feedback.client_connection.last_response_headers["etag"]
    save_lease(new_continuation)
    return len(changes)


def apply_feedback(item):
    # Idempotent: keyed by the feedback item's own id, so at-least-once
    # redelivery re-writes the same tally row instead of double-counting.
    row = {"id": item["id"], "questionId": item["questionId"], "positive": item["positive"]}
    return tally.upsert_item(row)
`

const WORKER_PY_STARTER_BODY = `def save_lease(continuation):
    raise NotImplementedError("Lab task")


def process_changes():
    raise NotImplementedError("Lab task")


def apply_feedback(item):
    raise NotImplementedError("Lab task")
`

const SERVER_PY = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import app

ROUTES = {
    ("POST", "/messages"): app.save_message,
    ("GET", "/sessions"): app.get_session,
    ("GET", "/users"): app.recent_sessions_for_user,
    ("POST", "/answers"): app.remember_answer,
    ("GET", "/similar"): app.find_similar_questions,
    ("GET", "/questions"): app.question_feedback,
}
PORT = 8080

class Handler(BaseHTTPRequestHandler):
    def _route(self):
        first = self.path.split("?", 1)[0].strip("/").split("/")
        return first[0] if first else ""

    def _dispatch(self, method):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except (ValueError, UnicodeDecodeError):
            payload = {}
        handler = ROUTES.get((method, self._route()))
        if handler is None:
            self.send_error(404)
            return
        body = json.dumps(handler(payload)).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
`

const DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
COPY app.py worker.py clients.py server.py ./
EXPOSE 8080
CMD ["python", "server.py"]
`

const DEPLOYMENT_YAML = `apiVersion: apps/v1
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

const WORKER_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: feedback-worker
  namespace: assistant
spec:
  replicas: 1
  selector:
    matchLabels:
      app: feedback-worker
  template:
    metadata:
      labels:
        app: feedback-worker
    spec:
      containers:
        - name: worker
          image: acrassistant.azurecr.io/assistant:v1
          imagePullPolicy: Always
          command: ["python", "worker.py"]
          ports:
            - name: http
              containerPort: 8080
`

const SERVICE_YAML = `apiVersion: v1
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

export const COSMOS_FILES = Object.freeze(['app.py', 'worker.py', 'clients.py', 'server.py', 'Dockerfile', 'k8s/deployment.yaml', 'k8s/worker.yaml', 'k8s/service.yaml'])
export const COSMOS_BUILD_FILES = Object.freeze(['app.py', 'worker.py', 'clients.py', 'server.py', 'Dockerfile'])
export const COSMOS_KUBERNETES_FILES = Object.freeze(['k8s/deployment.yaml', 'k8s/worker.yaml', 'k8s/service.yaml'])
export const COSMOS_EDIT_ZONES = Object.freeze(['save_message', 'get_session', 'recent_sessions_for_user', 'remember_answer', 'find_similar_questions', 'question_feedback', 'save_lease', 'process_changes', 'apply_feedback'])
export const COSMOS_ROUTES = Object.freeze({ 'POST /messages': 'save_message', 'GET /sessions/{id}': 'get_session', 'GET /users/{id}/sessions': 'recent_sessions_for_user', 'POST /answers': 'remember_answer', 'GET /similar': 'find_similar_questions', 'GET /questions/{id}/feedback': 'question_feedback', 'worker:batch': 'process_changes' })

export const COSMOS_MANIFEST = Object.freeze({
  id: 'data-python-cosmos-v1', language: 'python', runtimeFamily: 'aks', dataApp: true,
  files: COSMOS_FILES, buildFiles: COSMOS_BUILD_FILES, kubernetesFiles: COSMOS_KUBERNETES_FILES,
  fixedFiles: Object.freeze({ 'server.py': SERVER_PY }),
  editZones: COSMOS_EDIT_ZONES,
  receivers: Object.freeze({ sessions: 'cosmos-container', qa_history: 'cosmos-container', feedback: 'cosmos-container', leases: 'cosmos-container', tally: 'cosmos-container' }),
  routes: COSMOS_ROUTES,
  maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})

export const COSMOS_STARTER_FILES = Object.freeze({
  'app.py': APP_PY_HEADER + APP_PY_STARTER_BODY,
  'worker.py': WORKER_PY_HEADER + WORKER_PY_STARTER_BODY,
  'clients.py': CLIENTS_PY,
  'server.py': SERVER_PY,
  Dockerfile: DOCKERFILE,
  'k8s/deployment.yaml': DEPLOYMENT_YAML,
  'k8s/worker.yaml': WORKER_YAML,
  'k8s/service.yaml': SERVICE_YAML,
})

export const COSMOS_SOLUTION_FILES = Object.freeze({
  'app.py': APP_PY_HEADER + APP_PY_SOLUTION_BODY,
  'worker.py': WORKER_PY_HEADER + WORKER_PY_SOLUTION_BODY,
  'clients.py': CLIENTS_PY,
  'server.py': SERVER_PY,
  Dockerfile: DOCKERFILE,
  'k8s/deployment.yaml': DEPLOYMENT_YAML,
  'k8s/worker.yaml': WORKER_YAML,
  'k8s/service.yaml': SERVICE_YAML,
})

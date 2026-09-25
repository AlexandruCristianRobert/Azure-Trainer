import { TRAINING_CLIENTS_SOURCE } from './integration-clients.js'

export const INTEGRATION_SERVER_SOURCE = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import app

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/info":
            self.send_error(404)
            return
        body = json.dumps(app.info()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/ask":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, UnicodeDecodeError):
            request = None
        if not isinstance(request, dict) or not isinstance(request.get("question"), str):
            response = {"status": 400, "body": {"error": "A JSON object with a question string is required."}}
        else:
            response = app.answer(request["question"])
        body = json.dumps(response["body"]).encode("utf-8")
        self.send_response(response["status"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()
`

const app = `import os
from pathlib import Path
from training_clients import (
    EmbeddingClient, AnswerClient, PgClient, RetryPolicy,
    RequestBudget, DependencyError, as_vector,
)

SERVICE_NAME = "knowledge-assistant"
SERVICE_VERSION = "2.0"
PORT = 8080
SQL = Path("retrieval.sql").read_text()

def settings():
    return {
        "environment": os.environ.get("APP_ENV", "development"),
        "ai_endpoint": os.environ.get("AI_ENDPOINT", ""),
        "embedding_deployment": os.environ.get("EMBEDDING_DEPLOYMENT", ""),
        "answer_deployment": os.environ.get("ANSWER_DEPLOYMENT", ""),
        "pg_host": os.environ.get("PGHOST", ""),
        "pg_database": os.environ.get("PGDATABASE", ""),
        "pg_user": os.environ.get("PGUSER", ""),
        "pg_password": os.environ.get("PGPASSWORD", ""),
        "collection": os.environ.get("COLLECTION", ""),
        "audience": os.environ.get("AUDIENCE", ""),
    }

def info():
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "environment": os.environ.get("APP_ENV", "development")}

def answer(question):
    question = question.strip()
    if not question:
        return {"status": 400, "body": {"error": "Question is required."}}
    cfg = settings()
    policy = RetryPolicy(max_attempts=3, retryable_codes=("THROTTLED", "UNAVAILABLE", "TIMEOUT"), base_delay_ms=100, max_delay_ms=200, attempt_timeout_ms=200)
    budget = RequestBudget(total_ms=1000)
    embedding_client = EmbeddingClient(endpoint=cfg["ai_endpoint"], sdk_retries=0)
    database = PgClient(host=cfg["pg_host"], database=cfg["pg_database"],
                        user=cfg["pg_user"], password=cfg["pg_password"], sdk_retries=0)
    answer_client = AnswerClient(endpoint=cfg["ai_endpoint"], sdk_retries=0)
    try:
        vector = budget.invoke(
            embedding_client.embed, policy,
            question=question, deployment=cfg["embedding_deployment"],
        )
        rows = budget.invoke(
            database.execute, policy, sql=SQL,
            params={
                "collection": cfg["collection"],
                "audience": cfg["audience"],
                "published": True,
                "embedding": as_vector(vector),
                "max_distance": 0.2,
                "limit": 1,
            },
        )
        if not rows:
            return {"status": 200, "body": {
                "answer": "No matching documents.", "sources": [],
                "environment": cfg["environment"],
            }}
        context = [{"id": row["id"], "content": row["content"]} for row in rows]
        result = budget.invoke(
            answer_client.generate, policy, question=question, context=context,
            deployment=cfg["answer_deployment"],
        )
        return {"status": 200, "body": {
            "answer": result["answer"], "sources": [row["id"] for row in rows],
            "environment": cfg["environment"],
        }}
    except DependencyError as error:
        return {"status": error.http_status, "body": {
            "error": error.public_message, "code": error.code,
        }}
`
const sql = `SELECT id, content
FROM documents
WHERE collection = %(collection)s
  AND audience = %(audience)s
  AND published = %(published)s
  AND (embedding <=> %(embedding)s::vector) <= %(max_distance)s
ORDER BY embedding <=> %(embedding)s::vector ASC, id ASC
LIMIT %(limit)s;
`
const dockerfile = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py training_clients.py retrieval.sql ./
EXPOSE 8080
CMD ["python", "server.py"]
`
const schema = `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE documents (
    id text PRIMARY KEY,
    content text NOT NULL,
    collection text NOT NULL,
    audience text NOT NULL,
    published boolean NOT NULL,
    embedding vector(3) NOT NULL
);
`
const config = `apiVersion: v1
kind: ConfigMap
metadata:
  name: assistant-config
  namespace: assistant
data:
  APP_ENV: training
  AI_ENDPOINT: https://ai-training.example
  ANSWER_DEPLOYMENT: answers-v1
  EMBEDDING_DEPLOYMENT: embeddings-v1
  PGHOST: pg-training.example
  PGDATABASE: knowledge
  PGUSER: assistant_training
  COLLECTION: training
  AUDIENCE: employee
`
const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant
  namespace: assistant
spec:
  replicas: 2
  selector:
    matchLabels:
      app: assistant
  template:
    metadata:
      labels:
        app: assistant
    spec:
      containers:
        - name: api
          image: acraksintegration.azurecr.io/assistant:integration-v1
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              valueFrom: {configMapKeyRef: {name: assistant-config, key: APP_ENV}}
            - name: AI_ENDPOINT
              valueFrom: {configMapKeyRef: {name: assistant-config, key: AI_ENDPOINT}}
            - name: ANSWER_DEPLOYMENT
              valueFrom: {configMapKeyRef: {name: assistant-config, key: ANSWER_DEPLOYMENT}}
            - name: EMBEDDING_DEPLOYMENT
              valueFrom: {configMapKeyRef: {name: assistant-config, key: EMBEDDING_DEPLOYMENT}}
            - name: PGHOST
              valueFrom: {configMapKeyRef: {name: assistant-config, key: PGHOST}}
            - name: PGDATABASE
              valueFrom: {configMapKeyRef: {name: assistant-config, key: PGDATABASE}}
            - name: PGUSER
              valueFrom: {configMapKeyRef: {name: assistant-config, key: PGUSER}}
            - name: COLLECTION
              valueFrom: {configMapKeyRef: {name: assistant-config, key: COLLECTION}}
            - name: AUDIENCE
              valueFrom: {configMapKeyRef: {name: assistant-config, key: AUDIENCE}}
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: assistant-credentials
                  key: PGPASSWORD
`
export const INTEGRATION_FILES = Object.freeze(['app.py', 'server.py', 'training_clients.py', 'retrieval.sql', 'schema.sql', 'Dockerfile', 'k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml'])
export const INTEGRATION_MANIFEST = Object.freeze({ id: 'aks-python-integration-v1', language: 'python', runtimeFamily: 'aks', integration: true,
  integrationVersion: 1, files: INTEGRATION_FILES,
  buildFiles: ['app.py', 'server.py', 'training_clients.py', 'retrieval.sql', 'Dockerfile'], kubernetesFiles: ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml'],
  fixedFiles: Object.freeze({ 'server.py': INTEGRATION_SERVER_SOURCE, 'training_clients.py': TRAINING_CLIENTS_SOURCE, 'schema.sql': schema }), maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000 })
export const INTEGRATION_SOLUTION_FILES = Object.freeze({ 'app.py': app, 'server.py': INTEGRATION_SERVER_SOURCE, 'training_clients.py': TRAINING_CLIENTS_SOURCE, 'retrieval.sql': sql, 'schema.sql': INTEGRATION_MANIFEST.fixedFiles['schema.sql'], Dockerfile: dockerfile,
  'k8s/namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: assistant\n', 'k8s/configmap.yaml': config, 'k8s/secret.yaml': 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: assistant-credentials\n  namespace: assistant\ntype: Opaque\nstringData:\n  PGPASSWORD: training-only-password\n', 'k8s/deployment.yaml': deployment, 'k8s/service-internal.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-internal\n  namespace: assistant\nspec:\n  type: ClusterIP\n  selector:\n    app: assistant\n  ports:\n    - port: 80\n      targetPort: http\n', 'k8s/service-external.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-public\n  namespace: assistant\nspec:\n  type: LoadBalancer\n  selector:\n    app: assistant\n  ports:\n    - port: 80\n      targetPort: http\n' })
export const INTEGRATION_QUERY_SOURCE = sql

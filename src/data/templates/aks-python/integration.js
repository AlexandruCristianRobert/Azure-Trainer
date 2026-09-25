import { SERVER_SOURCE } from './server.js'
import { INTEGRATION_CLIENTS_SOURCE } from './integration-clients.js'

const app = `import os
import json
from pathlib import Path
from integration_clients import AnswerClient, EmbeddingClient, QueryClient, RetryPolicy, as_vector

SERVICE_NAME = "knowledge-assistant"
SERVICE_VERSION = "integration-v1"
PORT = 8080
QUERY_SOURCE = Path("/app/retrieval.sql").read_text()

def settings():
    display = json.loads(Path("/etc/assistant/settings.json").read_text())
    return {"environment": os.environ.get("APP_ENV", "development"), "embedding_deployment": os.environ.get("EMBEDDING_DEPLOYMENT", ""), "answer_deployment": os.environ.get("ANSWER_DEPLOYMENT", ""), "collection": os.environ.get("COLLECTION", ""), "audience": os.environ.get("AUDIENCE", ""), "display_name": display["display_name"]}

def info():
    return {"service": SERVICE_NAME, "version": SERVICE_VERSION, "environment": os.environ.get("APP_ENV", "development")}

def answer(question):
    question = question.strip()
    if not question:
        return {"status": 400, "body": {"error": "A question string is required."}}
    cfg = settings()
    embeddings = EmbeddingClient()
    vector = embeddings.embed(question, cfg["embedding_deployment"])
    query = QueryClient()
    rows = query.query(as_vector(vector), QUERY_SOURCE, {"collection": cfg["collection"], "audience": cfg["audience"], "published": True, "embedding": as_vector(vector), "cutoff": 0.2, "limit": 1})
    context = [{"id": row["id"], "content": row["content"]} for row in rows]
    if not context:
        return {"status": 200, "body": {"answer": "No matching documents.", "sources": []}}
    answers = AnswerClient()
    text = answers.answer(question, context, cfg["answer_deployment"])
    return {"status": 200, "body": {"answer": text, "sources": [row["id"] for row in rows]}}
`
const sql = `SELECT id, content
FROM documents
WHERE collection = %(collection)s
  AND audience = %(audience)s
  AND published = %(published)s
  AND (embedding <=> %(embedding)s::vector) <= %(cutoff)s
ORDER BY embedding <=> %(embedding)s::vector ASC, id ASC
LIMIT %(limit)s;
`
const dockerfile = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py integration_clients.py retrieval.sql ./
EXPOSE 8080
CMD ["python", "server.py"]
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
  settings.json: |\n    {"display_name":"Training assistant"}
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
export const INTEGRATION_MANIFEST = Object.freeze({ id: 'aks-python-integration-v1', language: 'python', runtimeFamily: 'aks', integration: true,
  files: ['app.py', 'server.py', 'integration_clients.py', 'retrieval.sql', 'Dockerfile', 'k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'],
  buildFiles: ['app.py', 'server.py', 'integration_clients.py', 'retrieval.sql', 'Dockerfile'], kubernetesFiles: ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'],
  fixedFiles: Object.freeze({ 'server.py': SERVER_SOURCE, 'integration_clients.py': INTEGRATION_CLIENTS_SOURCE }), maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000 })
export const INTEGRATION_SOLUTION_FILES = Object.freeze({ 'app.py': app, 'server.py': SERVER_SOURCE, 'integration_clients.py': INTEGRATION_CLIENTS_SOURCE, 'retrieval.sql': sql, Dockerfile: dockerfile,
  'k8s/namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: assistant\n', 'k8s/configmap.yaml': config, 'k8s/secret.yaml': 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: assistant-credentials\n  namespace: assistant\ntype: Opaque\nstringData:\n  PGPASSWORD: training-only-password\n', 'k8s/deployment.yaml': deployment, 'k8s/service.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant\n  namespace: assistant\nspec:\n  selector:\n    app: assistant\n  ports:\n    - port: 80\n      targetPort: http\n' })
export const INTEGRATION_QUERY_SOURCE = sql

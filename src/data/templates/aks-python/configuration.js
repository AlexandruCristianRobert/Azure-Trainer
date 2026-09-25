import { SERVER_SOURCE } from './server.js'
import { renderKnowledgeHelper, KNOWLEDGE_FIXTURES } from '../../fixtures/aks/knowledge.js'

const app = `import os
import json
from pathlib import Path
import training_runtime

SERVICE_NAME = "knowledge-assistant"
SERVICE_VERSION = "1.0"
PORT = 8080

def info():
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "environment": os.environ.get("APP_ENV", "development"),
    }

def settings():
    display = json.loads(Path("/etc/assistant/settings.json").read_text())
    return {
        "environment": os.environ.get("APP_ENV", "development"),
        "ai_endpoint": os.environ.get("AI_ENDPOINT", ""),
        "answer_deployment": os.environ.get("ANSWER_DEPLOYMENT", ""),
        "embedding_deployment": os.environ.get("EMBEDDING_DEPLOYMENT", ""),
        "pg_host": os.environ.get("POSTGRES_HOST", ""),
        "pg_database": os.environ.get("PGDATABASE", ""),
        "pg_user": os.environ.get("PGUSER", ""),
        "pg_password": os.environ.get("PGPASSWORD", ""),
        "collection": os.environ.get("COLLECTION", ""),
        "display_name": display["display_name"],
        "response_prefix": display["response_prefix"],
    }

def answer(question):
    return training_runtime.answer(question, settings())
`
const dockerfile = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py training_runtime.py ./
EXPOSE 8080
CMD ["python", "server.py"]
`
const helper = renderKnowledgeHelper(KNOWLEDGE_FIXTURES)
const configMap = `apiVersion: v1
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
  settings.json: |
    {"display_name":"Training assistant","response_prefix":""}
`
const secret = `apiVersion: v1
kind: Secret
metadata:
  name: assistant-credentials
  namespace: assistant
type: Opaque
stringData:
  PGPASSWORD: training-only-password
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
          image: acraksconfigguided.azurecr.io/assistant:starter
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: APP_ENV
            - name: AI_ENDPOINT
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: AI_ENDPOINT
            - name: ANSWER_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: ANSWER_DEPLOYMENT
            - name: EMBEDDING_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: EMBEDDING_DEPLOYMENT
            - name: PGHOST
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: PGHOST
            - name: PGDATABASE
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: PGDATABASE
            - name: PGUSER
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: PGUSER
            - name: COLLECTION
              valueFrom:
                configMapKeyRef:
                  name: assistant-config
                  key: COLLECTION
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: assistant-credentials
                  key: PGPASSWORD
          volumeMounts:
            - name: assistant-settings
              mountPath: /etc/assistant
              readOnly: true
      volumes:
        - name: assistant-settings
          configMap:
            name: assistant-config
            items:
              - key: settings.json
                path: settings.json
`
const service = `apiVersion: v1
kind: Service
metadata:
  name: assistant
  namespace: assistant
spec:
  type: LoadBalancer
  selector:
    app: assistant
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
`

export const CONFIG_MANIFEST = Object.freeze({
  id: 'aks-python-config-v1', language: 'python', runtimeFamily: 'aks', assistant: true,
  files: ['app.py', 'server.py', 'training_runtime.py', 'Dockerfile', 'k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml'],
  buildFiles: ['app.py', 'server.py', 'training_runtime.py', 'Dockerfile'],
  kubernetesFiles: ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'],
  fixedFiles: Object.freeze({ 'server.py': SERVER_SOURCE, 'training_runtime.py': helper }),
  maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})
export const CONFIG_FILES = Object.freeze({
  'app.py': app, 'server.py': SERVER_SOURCE, 'training_runtime.py': helper, Dockerfile: dockerfile,
  'k8s/namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: assistant\n',
  'k8s/configmap.yaml': configMap, 'k8s/secret.yaml': secret, 'k8s/deployment.yaml': deployment, 'k8s/service.yaml': service,
})
export const CONFIG_SOLUTION_FILES = Object.freeze({ ...CONFIG_FILES, 'app.py': app.replace('POSTGRES_HOST', 'PGHOST') })

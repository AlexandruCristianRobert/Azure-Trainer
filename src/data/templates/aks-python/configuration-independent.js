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
        "pg_host": os.environ.get("PGHOST", ""),
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
const primaryConfigMap = `apiVersion: v1
kind: ConfigMap
metadata:
  name: assistant-config
  namespace: primary
data:
  APP_ENV: production
  AI_ENDPOINT: https://ai-training.example
  ANSWER_DEPLOYMENT: answers-v1
  EMBEDDING_DEPLOYMENT: embeddings-v1
  PGHOST: pg-training.example
  PGDATABASE: knowledge
  PGUSER: assistant_training
  COLLECTION: training
  settings.json: |
    {"display_name":"Primary assistant","response_prefix":""}
`
const primarySecret = `apiVersion: v1
kind: Secret
metadata:
  name: assistant-credentials
  namespace: primary
type: Opaque
stringData:
  PGPASSWORD: training-only-password
`
const reviewConfigMap = `# Configure the independent review profile.
apiVersion: v1
kind: ConfigMap
metadata:
  name: review-config
  namespace: review
data:
  APP_ENV: review
  AI_ENDPOINT: https://ai-review.example
  ANSWER_DEPLOYMENT: answers-v1
  EMBEDDING_DEPLOYMENT: embeddings-v1
  PGHOST: pg-review.example
  PGDATABASE: knowledge
  PGUSER: assistant_review
  COLLECTION: review
  settings.json: |
    {"display_name":"Review assistant","response_prefix":"[Review] "}
`
const reviewSecret = `# Store the supplied fictional review credential here.
apiVersion: v1
kind: Secret
metadata:
  name: review-credentials
  namespace: review
type: Opaque
stringData:
  PGPASSWORD: review-only-password
`
const configuration = (name, namespace, image, configName, secretName, label) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ${label}
  template:
    metadata:
      labels:
        app: ${label}
    spec:
      containers:
        - name: api
          image: ${image}
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: APP_ENV
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: APP_ENV
            - name: AI_ENDPOINT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: AI_ENDPOINT
            - name: ANSWER_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: ANSWER_DEPLOYMENT
            - name: EMBEDDING_DEPLOYMENT
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: EMBEDDING_DEPLOYMENT
            - name: PGHOST
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGHOST
            - name: PGDATABASE
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGDATABASE
            - name: PGUSER
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: PGUSER
            - name: COLLECTION
              valueFrom:
                configMapKeyRef:
                  name: ${configName}
                  key: COLLECTION
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${secretName}
                  key: PGPASSWORD
          volumeMounts:
            - name: settings
              mountPath: /etc/assistant
              readOnly: true
      volumes:
        - name: settings
          configMap:
            name: ${configName}
            items:
              - key: settings.json
                path: settings.json
`
const service = (name, namespace, label) => `apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${namespace}
spec:
  type: LoadBalancer
  selector:
    app: ${label}
  ports:
    - port: 80
      targetPort: http
      protocol: TCP
`

export const CONFIG_INDEPENDENT_MANIFEST = Object.freeze({
  id: 'aks-python-config-independent-v1', language: 'python', runtimeFamily: 'aks', assistant: true,
  files: ['app.py', 'server.py', 'training_runtime.py', 'Dockerfile', 'k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml', 'k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml', 'k8s/review-deployment.yaml', 'k8s/review-service.yaml'],
  buildFiles: ['app.py', 'server.py', 'training_runtime.py', 'Dockerfile'],
  kubernetesFiles: ['k8s/primary-namespace.yaml', 'k8s/primary-configmap.yaml', 'k8s/primary-secret.yaml', 'k8s/primary-deployment.yaml', 'k8s/primary-service.yaml', 'k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml', 'k8s/review-deployment.yaml', 'k8s/review-service.yaml'],
  fixedFiles: Object.freeze({ 'server.py': SERVER_SOURCE, 'training_runtime.py': renderKnowledgeHelper(KNOWLEDGE_FIXTURES) }),
  maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})
export const CONFIG_INDEPENDENT_FILES = Object.freeze({
  'app.py': app, 'server.py': SERVER_SOURCE, 'training_runtime.py': renderKnowledgeHelper(KNOWLEDGE_FIXTURES), Dockerfile: dockerfile,
  'k8s/primary-namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: primary\n',
  'k8s/primary-configmap.yaml': primaryConfigMap, 'k8s/primary-secret.yaml': primarySecret,
  'k8s/primary-deployment.yaml': configuration('assistant', 'primary', 'acraksconfigindependent.azurecr.io/assistant:shared', 'assistant-config', 'assistant-credentials', 'assistant'),
  'k8s/primary-service.yaml': service('assistant', 'primary', 'assistant'),
  'k8s/review-namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: review\n',
  'k8s/review-configmap.yaml': '# Add the review ConfigMap.\n', 'k8s/review-secret.yaml': '# Add the review Secret.\n',
  'k8s/review-deployment.yaml': '# Add the review Deployment.\n', 'k8s/review-service.yaml': '# Add the review Service.\n',
})
export const CONFIG_INDEPENDENT_SOLUTION_FILES = Object.freeze({ ...CONFIG_INDEPENDENT_FILES,
  'k8s/review-configmap.yaml': reviewConfigMap, 'k8s/review-secret.yaml': reviewSecret,
  'k8s/review-deployment.yaml': configuration('review-assistant', 'review', 'acraksconfigindependent.azurecr.io/assistant:shared', 'review-config', 'review-credentials', 'review-assistant'),
  'k8s/review-service.yaml': service('review-assistant', 'review', 'review-assistant'),
})

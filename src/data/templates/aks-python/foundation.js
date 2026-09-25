import { SERVER_SOURCE } from './server.js'

const app = `import os

SERVICE_NAME = "knowledge-assistant"
SERVICE_VERSION = "0.1"
PORT = 8080

def info():
    return {
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "environment": os.environ.get("APP_ENV", "development"),
    }
`
const dockerfile = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py ./
EXPOSE 8080
CMD ["python", "server.py"]
`

export const FOUNDATION_MANIFEST = Object.freeze({
  id: 'aks-python-foundation-v1', language: 'python', runtimeFamily: 'aks',
  files: ['app.py', 'server.py', 'Dockerfile', 'k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'],
  buildFiles: ['app.py', 'server.py', 'Dockerfile'], kubernetesFiles: ['k8s/namespace.yaml', 'k8s/deployment.yaml', 'k8s/service.yaml'],
  fixedFiles: Object.freeze({ 'server.py': SERVER_SOURCE }), maxFiles: 16, maxFileBytes: 64 * 1024, maxTotalBytes: 256 * 1024, maxTokens: 20_000,
})
export const FOUNDATION_FILES = Object.freeze({
  'app.py': app, 'server.py': SERVER_SOURCE, Dockerfile: dockerfile,
  'k8s/namespace.yaml': 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: assistant\n',
  'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: assistant\n  namespace: assistant\nspec:\n  replicas: 1\n  selector:\n    matchLabels:\n      app: assistant\n  template:\n    metadata:\n      labels:\n        app: assistant\n    spec:\n      containers:\n        - name: api\n          image: acraksguided.azurecr.io/assistant:starter\n          imagePullPolicy: Always\n          ports:\n            - name: http\n              containerPort: 8080\n          env:\n            - name: APP_ENV\n              value: development\n',
  'k8s/service.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant\n  namespace: assistant\nspec:\n  type: LoadBalancer\n  selector:\n    app: assistant\n  ports:\n    - port: 80\n      targetPort: http\n      protocol: TCP\n',
})
export const FOUNDATION_SOLUTION_FILES = Object.freeze({ ...FOUNDATION_FILES, 'app.py': app.replace('"0.1"', '"1.0"'),
  'k8s/deployment.yaml': FOUNDATION_FILES['k8s/deployment.yaml'].replace('replicas: 1', 'replicas: 2').replace(':starter', ':v1').replace('value: development', 'value: training') })

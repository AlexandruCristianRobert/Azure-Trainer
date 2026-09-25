import { INTEGRATION_FILES, INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from './integration.js'
import { HEALTH_RUNTIME_SOURCE } from './health-runtime.js'

const source = `
from training_health import initialized, accepting_requests, postgres_available, ai_available

def startup():
    return {"status": 200 if initialized() else 503, "body": {"check": "startup"}}

def ready():
    return {"status": 200 if initialized() and accepting_requests() else 503, "body": {"check": "readiness"}}

def live():
    return {"status": 200, "body": {"check": "liveness"}}
`
const starterHealthSource = `
from training_health import initialized, accepting_requests, postgres_available, ai_available

def startup():
    return {"status": 503, "body": {"check": "startup"}}

def ready():
    return {"status": 503, "body": {"check": "readiness"}}

def live():
    return {"status": 503, "body": {"check": "liveness"}}
`
const integrationApp = INTEGRATION_SOLUTION_FILES['app.py']
const deployment = INTEGRATION_SOLUTION_FILES['k8s/deployment.yaml'].replace('          ports:', '          imagePullPolicy: Always\n          ports:')
const probeFields = `          startupProbe:
            httpGet: {path: /health/startup, port: http}
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 1
            failureThreshold: 6
            successThreshold: 1
          readinessProbe:
            httpGet: {path: /health/ready, port: http}
            initialDelaySeconds: 0
            periodSeconds: 2
            timeoutSeconds: 1
            failureThreshold: 1
            successThreshold: 1
          livenessProbe:
            httpGet: {path: /health/live, port: http}
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 1
            failureThreshold: 2
            successThreshold: 1
`
const fixedServer = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
import app

HEALTH_ROUTES = {"/health/startup": app.startup, "/health/ready": app.ready, "/health/live": app.live}

class Handler(BaseHTTPRequestHandler):
    def _send(self, response):
        body = json.dumps(response["body"]).encode("utf-8")
        self.send_response(response["status"])
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        health = HEALTH_ROUTES.get(self.path)
        if health:
            self._send(health())
            return
        if self.path == "/api/info":
            self._send({"status": 200, "body": app.info()})
            return
        self.send_error(404)

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
        self._send(response)

# The browser simulator gates dispatch on container lifecycle state.
HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()
`
const dockerfile = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py training_clients.py training_health.py retrieval.sql ./
EXPOSE 8080
CMD ["python", "server.py"]
`
const baseFiles = {
  ...INTEGRATION_SOLUTION_FILES,
  'server.py': fixedServer,
  'training_health.py': HEALTH_RUNTIME_SOURCE,
  Dockerfile: dockerfile,
  'k8s/deployment.yaml': deployment.replace('acraksintegration', 'acraksprobesguided').replace('assistant:integration-v1', 'assistant:starter'),
}
export const HEALTH_FILES = Object.freeze({
  ...baseFiles,
  'app.py': integrationApp + starterHealthSource,
})
export const HEALTH_SOLUTION_FILES = Object.freeze({
  ...baseFiles,
  'app.py': integrationApp + source,
  'k8s/deployment.yaml': deployment.replace('acraksintegration', 'acraksprobesguided').replace('assistant:integration-v1', 'assistant:health-v1')
    .replace('          ports:\n            - name: http\n              containerPort: 8080\n', `          ports:
            - name: http
              containerPort: 8080
${probeFields}`)
    .replace('      containers:\n', '      terminationGracePeriodSeconds: 1\n      containers:\n'),
})
export const HEALTH_MANIFEST = Object.freeze({
  ...INTEGRATION_MANIFEST,
  id: 'aks-python-health-v1', healthVersion: 1,
  files: Object.freeze([...INTEGRATION_FILES, 'training_health.py']),
  buildFiles: Object.freeze(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'retrieval.sql', 'Dockerfile']),
  fixedFiles: Object.freeze({ ...INTEGRATION_MANIFEST.fixedFiles, 'server.py': fixedServer, 'training_health.py': HEALTH_RUNTIME_SOURCE }),
  maxFiles: 16,
})

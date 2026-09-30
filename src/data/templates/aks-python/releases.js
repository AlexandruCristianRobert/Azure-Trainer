import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from './health.js'

const successReturn = `return {"status": 200, "body": {
            "answer": result["answer"], "sources": [row["id"] for row in rows],
            "environment": cfg["environment"],
        }}`
const formatter = `def format_answer(answer_text, rows, environment):
    return {
        "answer": answer_text,
        "sources": [row["id"] for row in rows],
        "environment": environment,
    }

`
const starterApp = HEALTH_SOLUTION_FILES['app.py']
  .replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "1.0"')
  .replace('def answer(question):', formatter + 'def answer(question):')
  .replace(successReturn, 'return {"status": 200, "body": format_answer(result["answer"], rows, cfg["environment"])}')
const releaseApp = starterApp.replace('SERVICE_VERSION = "1.0"', 'SERVICE_VERSION = "2.0"')
  .replace('"environment": environment,', '"environment": environment,\n        "release": SERVICE_VERSION,')
const deployment = HEALTH_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('  name: assistant\n  namespace: assistant', '  name: assistant-api\n  namespace: assistant')
  .replace('acraksprobesguided.azurecr.io/assistant:health-v1', 'acraksreleasesguided.azurecr.io/assistant:release-v1')
  .replace('spec:\n  replicas: 2', `spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  minReadySeconds: 5
  progressDeadlineSeconds: 60
  revisionHistoryLimit: 3`)
  .replace('          env:', `          resources:
            requests:
              cpu: "250m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          env:`)

export const RELEASE_FILES = Object.freeze({ ...HEALTH_SOLUTION_FILES, 'app.py': starterApp, 'k8s/deployment.yaml': deployment })
export const RELEASE_SOLUTION_FILES = Object.freeze({ ...RELEASE_FILES, 'app.py': releaseApp, 'k8s/deployment.yaml': deployment.replace('release-v1', 'release-v2') })
export const RELEASE_MANIFEST = Object.freeze({ ...HEALTH_MANIFEST, id: 'aks-python-releases-v1', releaseVersion: 1,
  files: Object.freeze([...HEALTH_MANIFEST.files]),
  buildFiles: Object.freeze(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'retrieval.sql', 'Dockerfile']),
  maxFiles: 16,
})

import { HEALTH_FILES, HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from './health.js'

const starterApp = HEALTH_FILES['app.py'].replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "1.0"')
const releaseApp = HEALTH_SOLUTION_FILES['app.py'].replaceAll('"environment": cfg["environment"],', '"environment": cfg["environment"], "release": SERVICE_VERSION,')
const deployment = HEALTH_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('  name: assistant\n  namespace: assistant', '  name: assistant-api\n  namespace: assistant')
  .replace('acraksprobesguided.azurecr.io/assistant:health-v1', 'acraksreleases.azurecr.io/assistant:release-v2')
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

export const RELEASE_FILES = Object.freeze({ ...HEALTH_FILES, 'app.py': starterApp })
export const RELEASE_SOLUTION_FILES = Object.freeze({ ...HEALTH_SOLUTION_FILES, 'app.py': releaseApp, 'k8s/deployment.yaml': deployment })
export const RELEASE_MANIFEST = Object.freeze({ ...HEALTH_MANIFEST, id: 'aks-python-releases-v1', releaseVersion: 1,
  files: Object.freeze([...HEALTH_MANIFEST.files]),
  buildFiles: Object.freeze(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'retrieval.sql', 'Dockerfile']),
  maxFiles: 16,
})

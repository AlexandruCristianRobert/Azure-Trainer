import { DIAGNOSIS_SOLUTION_FILES, DIAGNOSIS_MANIFEST } from './diagnosis.js'
import { RESOURCE_FILES, RESOURCE_SOLUTION_FILES } from './resources.js'
import { WORKLOAD_RUNTIME_SOURCE } from './workload-runtime.js'
import { diagnosisServerSource } from './server.js'

const workSource = (units) => `\nimport training_workload\n\nWORK_UNITS = ${units}\nSCRATCH_MIB = 96\n\ndef work():\n    return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)\n`
const server = diagnosisServerSource(RESOURCE_FILES['server.py'])
const docker = `FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py training_clients.py training_health.py training_diagnostics.py training_workload.py retrieval.sql ./
EXPOSE 8080
CMD ["python", "server.py"]
`
const solutionSql = DIAGNOSIS_SOLUTION_FILES['retrieval.sql']
const starterSql = solutionSql.replace('  AND published = %(published)s\n', '')
const v2App = DIAGNOSIS_SOLUTION_FILES['app.py'] + workSource(20)
const v1App = v2App.replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "1.0"')
  .replace('        "release": SERVICE_VERSION,\n', '')

const deployment = DIAGNOSIS_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksreleasesguided.azurecr.io/assistant:release-v2', 'acrakscapstone.azurecr.io/assistant:capstone-v1')
const hpa = RESOURCE_SOLUTION_FILES['k8s/hpa.yaml'].replace('    name: assistant\n', '    name: assistant-api\n')

export const CAPSTONE_MANIFEST = Object.freeze({
  ...DIAGNOSIS_MANIFEST,
  id: 'aks-python-capstone-v1',
  workloadVersion: 1,
  capstone: true,
  files: Object.freeze([...DIAGNOSIS_MANIFEST.files, 'training_workload.py', 'k8s/hpa.yaml']),
  buildFiles: Object.freeze(['app.py', 'retrieval.sql', 'Dockerfile', 'server.py', 'training_clients.py', 'training_health.py', 'training_diagnostics.py', 'training_workload.py']),
  kubernetesFiles: Object.freeze([...DIAGNOSIS_MANIFEST.kubernetesFiles, 'k8s/hpa.yaml']),
  fixedFiles: Object.freeze({ ...DIAGNOSIS_MANIFEST.fixedFiles, 'server.py': server, 'training_workload.py': WORKLOAD_RUNTIME_SOURCE }),
  maxFiles: 16,
})

const v1 = Object.freeze({
  ...DIAGNOSIS_SOLUTION_FILES,
  'app.py': v1App,
  'server.py': server,
  'training_workload.py': WORKLOAD_RUNTIME_SOURCE,
  'retrieval.sql': solutionSql,
  Dockerfile: docker,
  'k8s/deployment.yaml': deployment,
  'k8s/service-external.yaml': DIAGNOSIS_SOLUTION_FILES['k8s/service-external.yaml'].replace('name: assistant-public', 'name: assistant-external'),
  'k8s/hpa.yaml': '# HPA is authored during the resilience stage.\n',
})
const v2 = Object.freeze({ ...v1, 'app.py': v2App,
  'k8s/deployment.yaml': deployment.replace('assistant:capstone-v1', 'assistant:capstone-v2') })
const scale = Object.freeze({ ...v1, 'k8s/deployment.yaml': deployment.replace('  replicas: 2\n', ''), 'k8s/hpa.yaml': hpa })
const final = Object.freeze({ ...v2, 'k8s/hpa.yaml': '# HPA exercise complete; final deployment uses two fixed replicas.\n' })

export const CAPSTONE_SOLUTION_FILES = Object.freeze({ v1, v2, scale, final })
export const CAPSTONE_FILES = Object.freeze({
  ...v1,
  'app.py': v1App.replace('    if not question:\n        return {"status": 400, "body": {"error": "Question is required."}}\n', '')
    .replace('                "published": True,\n', '')
    .replace('    log_event("request.started")\n', '')
    .replace('    log_event("request.completed", response["status"])\n', '')
    .replace('return {"status": 200 if initialized() and accepting_requests() else 503, "body": {"check": "readiness"}}', 'return {"status": 200, "body": {"check": "readiness"}}')
    .replace('WORK_UNITS = 20', 'WORK_UNITS = 1'),
  'retrieval.sql': starterSql,
  'k8s/configmap.yaml': 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: assistant-config\n  namespace: assistant\ndata: {}\n',
  'k8s/secret.yaml': 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: assistant-credentials\n  namespace: assistant\ntype: Opaque\nstringData: {}\n',
  'k8s/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: assistant-api\n  namespace: assistant\nspec: {}\n',
  'k8s/service-internal.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-internal\n  namespace: assistant\nspec: {}\n',
  'k8s/service-external.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: assistant-external\n  namespace: assistant\nspec: {}\n',
})

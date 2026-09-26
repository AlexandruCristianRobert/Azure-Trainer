import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from './health.js'
import { WORKLOAD_RUNTIME_SOURCE } from './workload-runtime.js'

const workloadSource = (units, scratchMiB) => `\nimport training_workload\n\nWORK_UNITS = ${units}\nSCRATCH_MIB = ${scratchMiB}\n\ndef work():\n    return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)\n`
const server = HEALTH_SOLUTION_FILES['server.py'].replace('        if self.path == "/api/info":', '        if self.path == "/api/work":\n            self._send(app.work())\n            return\n        if self.path == "/api/info":')
const docker = HEALTH_SOLUTION_FILES.Dockerfile.replace('training_health.py retrieval.sql', 'training_health.py training_workload.py retrieval.sql')
const resources = `          resources:\n            requests:\n              cpu: "250m"\n              memory: "128Mi"\n            limits:\n              cpu: "500m"\n              memory: "256Mi"\n`

export const RESOURCE_FILES = Object.freeze({ ...HEALTH_SOLUTION_FILES, 'app.py': `${HEALTH_SOLUTION_FILES['app.py']}${workloadSource(1, 96)}`, 'server.py': server, Dockerfile: docker,
  'training_workload.py': WORKLOAD_RUNTIME_SOURCE,
  'k8s/hpa.yaml': `apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: assistant-cpu\n  namespace: assistant\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: assistant\n  minReplicas: 2\n  maxReplicas: 4\n  metrics:\n    - type: Resource\n      resource:\n        name: cpu\n        target:\n          type: Utilization\n          averageUtilization: 60\n  behavior:\n    scaleDown:\n      stabilizationWindowSeconds: 60\n`,
})
export const RESOURCE_SOLUTION_FILES = Object.freeze({ ...RESOURCE_FILES,
  'app.py': `${HEALTH_SOLUTION_FILES['app.py']}${workloadSource(20, 96)}`,
  'k8s/deployment.yaml': RESOURCE_FILES['k8s/deployment.yaml'].replace('          env:', `${resources}          env:`),
})
export const RESOURCE_MANIFEST = Object.freeze({ ...HEALTH_MANIFEST, id: 'aks-python-resources-v1', workloadVersion: 1,
  files: Object.freeze([...HEALTH_MANIFEST.files, 'training_workload.py', 'k8s/hpa.yaml']),
  buildFiles: Object.freeze([...HEALTH_MANIFEST.buildFiles.slice(0, -1), 'training_workload.py', 'Dockerfile']),
  kubernetesFiles: Object.freeze([...HEALTH_MANIFEST.kubernetesFiles, 'k8s/hpa.yaml']),
  fixedFiles: Object.freeze({ ...HEALTH_MANIFEST.fixedFiles, 'server.py': server, 'training_workload.py': WORKLOAD_RUNTIME_SOURCE }),
  maxFiles: 16,
})

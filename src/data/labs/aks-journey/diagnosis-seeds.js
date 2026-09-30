import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { initializeConnectivity, reconcileServices } from '../../../lib/kubernetes/services.js'
import { DIAGNOSIS_MANIFEST, DIAGNOSIS_SOLUTION_FILES } from '../../templates/aks-python/diagnosis.js'

export const DIAGNOSIS_GROUP = 'rg-aks-diagnosis-guided'
export const DIAGNOSIS_REGISTRY = 'acraksdiagnosisguided'
export const DIAGNOSIS_CLUSTER = 'aks-diagnosis-guided'
export const DIAGNOSIS_GUIDED_SOLUTION_FILES = Object.freeze(Object.fromEntries(Object.entries(DIAGNOSIS_SOLUTION_FILES).map(([path, text]) => [path,
  text.replaceAll('acraksreleasesguided', DIAGNOSIS_REGISTRY).replaceAll('assistant-public', 'assistant-external')
    .replaceAll('assistant:release-v2', 'assistant:diagnostics-v1').replace('terminationGracePeriodSeconds: 30', 'terminationGracePeriodSeconds: 1') ])))
export const DIAGNOSIS_GUIDED_FILES = Object.freeze({ ...DIAGNOSIS_GUIDED_SOLUTION_FILES,
  'app.py': DIAGNOSIS_GUIDED_SOLUTION_FILES['app.py'].replace('    log_event("request.started")\n', '').replace('    log_event("request.completed", response["status"])\n', ''),
  'k8s/deployment.yaml': DIAGNOSIS_GUIDED_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:diagnostics-v1', 'assistant:baseline-v2'),
})
export const DIAGNOSIS_TROUBLESHOOTING_FILES = Object.freeze({ ...DIAGNOSIS_GUIDED_SOLUTION_FILES,
  'k8s/service-internal.yaml': DIAGNOSIS_GUIDED_SOLUTION_FILES['k8s/service-internal.yaml'].replace('targetPort: http', 'targetPort: 8081'),
  'k8s/service-external.yaml': DIAGNOSIS_GUIDED_SOLUTION_FILES['k8s/service-external.yaml'].replace('targetPort: http', 'targetPort: 8081'),
  'k8s/configmap.yaml': DIAGNOSIS_GUIDED_SOLUTION_FILES['k8s/configmap.yaml'].replace('https://ai-training.example', 'https://ai-missing.example'),
})

/** Standalone setup builds and applies the supplied project through ordinary actions. */
export function createDiagnosisSeed(lab, { run, incident = null, group = DIAGNOSIS_GROUP, registry = DIAGNOSIS_REGISTRY, cluster = DIAGNOSIS_CLUSTER } = {}) {
  let seeded = run
  const seedLab = { ...lab, tasks: [], scenarios: {} }
  const act = action => {
    const result = applyRunAction(seeded, action, seedLab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Diagnosis seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  for (const line of [`az group create -n ${group} -l eastus`, `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image assistant:${incident === 'port-and-endpoint' ? 'diagnostics-v1' : 'baseline-v2'} .`,
    `az aks create -g ${group} -n ${cluster} --enable-managed-identity --generate-ssh-keys --attach-acr ${registry}`,
    `az aks get-credentials -g ${group} -n ${cluster}`, ...DIAGNOSIS_MANIFEST.kubernetesFiles.map(path => `kubectl apply -f ${path}`)]) act({ type: 'command', line })
  const clusterId = seeded.sandbox.aksClusters.find(item => item.name === cluster).id
  seeded = initializeConnectivity(seeded, clusterId)
  act({ type: 'aks-advance', seconds: 15 })
  const state = seeded.runtime.kubernetes.clusters[clusterId], uid = `diagnostic/${clusterId}`
  state.resources['Namespace//diagnostics'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'diagnostics', uid: `fixture-${clusterId}-diagnostics-namespace`, resourceVersion: '1' } }
  state.resources['Pod/diagnostics/diagnostics'] = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'diagnostics', namespace: 'diagnostics', uid, resourceVersion: '1', labels: { app: 'diagnostics' } },
    spec: { containers: [{ name: 'diagnostics', image: 'mcr.microsoft.com/aks-trainer/diagnostics:1', ports: [] }] }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.connectivity.diagnosticPodUids = [uid]
  seeded = reconcileServices(seeded, clusterId)
  if (incident === 'port-and-endpoint') {
    const current = seeded.runtime.kubernetes.clusters[clusterId]
    if (current.resources['Service/assistant/assistant-internal']?.spec.ports[0].targetPort !== 8081
      || current.resources['Service/assistant/assistant-external']?.spec.ports[0].targetPort !== 8081
      || Object.values(current.podSnapshots).filter(item => item.environment?.AI_ENDPOINT === 'https://ai-missing.example').length !== 2)
      throw new Error('Diagnosis seed did not capture both declared initial faults.')
  }
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

import { describe, expect, it } from 'vitest'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { emptyClusterState } from '../src/lib/kubernetes/state.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'
import { RESOURCE_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { setDeploymentReplicas } from '../src/lib/kubernetes/scheduling.js'
import { seedResourceTest, advanceResources, act } from './helpers/aks.js'
import { reconcileKubernetes } from '../src/lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

function deployment(replicas) {
  const value = parseKubernetesYaml(RESOURCE_SOLUTION_FILES['k8s/deployment.yaml']).documents[0]
  if (replicas === undefined) delete value.spec.replicas
  else value.spec.replicas = replicas
  return value
}

function run() {
  const state = emptyClusterState('c1')
  state.resources['Namespace//assistant'] = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'assistant', uid: 'ns-assistant', resourceVersion: '1' } }
  return { nextSequence: 1, runtime: { kubernetes: { clusters: { c1: state } } } }
}

const lab = { capabilities: { kubernetesResources: true, kubernetesConfiguration: true, kubernetesProbes: true } }

describe('AKS replica ownership', () => {
  it('uses saved manifest applies to relinquish replicas once and preserve later live scale across reload', () => {
    const seeded = seedResourceTest(); let value = reconcileKubernetes(setDeploymentReplicas(seeded.run, seeded.target, 4, { cause: 'manual' }).run, seeded.lab)
    expect(value.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(4)
    value = act(value, seeded.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(value.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(2)
    let manifest = parseYaml(value.project.savedFiles['k8s/deployment.yaml']); delete manifest.spec.replicas
    value = act(value, seeded.lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    value = act(value, seeded.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(value.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(1)
    value = reconcileKubernetes(setDeploymentReplicas(value, seeded.target, 5, { cause: 'hpa', controllerUid: 'hpa' }).run, seeded.lab)
    value = act(value, seeded.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(value.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(5)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(value)), seeded.lab)).toBeTruthy()
  })

  it('allows replicas through six only when persisted resource runtime is present', () => {
    const seeded = seedResourceTest()
    expect(setDeploymentReplicas(seeded.run, seeded.target, 6, { cause: 'manual' }).diagnostics).toEqual([])
    const legacy = run(); legacy.runtime.kubernetes.clusters.c1.resources['Deployment/assistant/assistant'] = deployment(1)
    legacy.runtime.kubernetes.clusters.c1.resources['Deployment/assistant/assistant'].metadata = { uid: 'deploy', resourceVersion: '1', generation: 1, name: 'assistant', namespace: 'assistant' }
    expect(setDeploymentReplicas(legacy, { clusterId: 'c1', namespace: 'assistant', deploymentName: 'assistant' }, 4, { cause: 'manual' }).diagnostics).toHaveLength(1)
  })
  it('preserves existing Pods on scale-up and withdraws a terminating Pod before its reservation is released', () => {
    const seeded = seedResourceTest({ replicas: 2 }); let value = advanceResources(seeded.run, seeded.lab, 10)
    const state = value.runtime.kubernetes.clusters[seeded.clusterId]; const before = Object.keys(state.resourcesRuntime.assignments).sort()
    const containers = before.map(uid => state.health.containers[uid].containerId)
    const snapshots = before.map(uid => state.podSnapshots[uid].artifactId)
    const rsUid = Object.values(state.resources).find(item => item.kind === 'ReplicaSet').metadata.uid
    value = reconcileKubernetes(setDeploymentReplicas(value, seeded.target, 3, { cause: 'manual' }).run, seeded.lab)
    const afterUp = Object.keys(value.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments).sort()
    expect(afterUp).toEqual(expect.arrayContaining(before))
    expect(before.map(uid => value.runtime.kubernetes.clusters[seeded.clusterId].health.containers[uid].containerId)).toEqual(containers)
    expect(before.map(uid => value.runtime.kubernetes.clusters[seeded.clusterId].podSnapshots[uid].artifactId)).toEqual(snapshots)
    expect(Object.values(value.runtime.kubernetes.clusters[seeded.clusterId].resources).find(item => item.kind === 'ReplicaSet').metadata.uid).toBe(rsUid)
    value = reconcileKubernetes(setDeploymentReplicas(value, seeded.target, 1, { cause: 'manual' }).run, seeded.lab)
    expect(getServiceBackends(value, seeded.target).readyEndpoints).toHaveLength(1)
    expect(Object.keys(value.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments)).toHaveLength(3)
    value = advanceResources(value, seeded.lab, 1)
    expect(Object.keys(value.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments)).toHaveLength(1)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(value)), seeded.lab)).toBeTruthy()
  })
  it('relinquishes replicas once, then preserves an externally scaled live value on omitted reapply', () => {
    let value = applyKubernetesObjects(run(), [deployment(2)], { clusterId: 'c1', namespace: 'assistant' }, lab).run
    value = setDeploymentReplicas(value, { clusterId: 'c1', namespace: 'assistant', deploymentName: 'assistant' }, 4, { cause: 'manual' }).run
    value = applyKubernetesObjects(value, [deployment()], { clusterId: 'c1', namespace: 'assistant' }, lab).run
    expect(value.runtime.kubernetes.clusters.c1.resources['Deployment/assistant/assistant'].spec.replicas).toBe(1)
    value = setDeploymentReplicas(value, { clusterId: 'c1', namespace: 'assistant', deploymentName: 'assistant' }, 5, { cause: 'hpa', controllerUid: 'hpa-1' }).run
    value = applyKubernetesObjects(value, [deployment()], { clusterId: 'c1', namespace: 'assistant' }, lab).run
    expect(value.runtime.kubernetes.clusters.c1.resources['Deployment/assistant/assistant'].spec.replicas).toBe(5)
  })

  it('defaults a newly omitted replica field to one', () => {
    const value = applyKubernetesObjects(run(), [deployment()], { clusterId: 'c1', namespace: 'assistant' }, lab).run
    expect(value.runtime.kubernetes.clusters.c1.resources['Deployment/assistant/assistant'].spec.replicas).toBe(1)
  })
})

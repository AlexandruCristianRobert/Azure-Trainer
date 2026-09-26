import { describe, expect, it } from 'vitest'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { emptyClusterState } from '../src/lib/kubernetes/state.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'
import { RESOURCE_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { setDeploymentReplicas } from '../src/lib/kubernetes/scheduling.js'

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

import { expect, it } from 'vitest'
import { seedFoundation, act } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

function cluster(run, id) { return run.runtime.kubernetes.clusters[id] }

it('keeps Deployment and Pod identities on a no-op apply', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const deployment = cluster(run, clusterId).resources['Deployment/assistant/assistant']
  const sequence = run.nextSequence
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(cluster(run, clusterId).resources['Deployment/assistant/assistant'].metadata).toEqual(deployment.metadata)
  expect(after.map(p => p.metadata.uid)).toEqual(before.map(p => p.metadata.uid))
  expect(run.nextSequence).toBe(sequence)
})

it('records old and replacement Pod IDs when replacing a Deployment template', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const text = run.project.savedFiles['k8s/deployment.yaml'].replace('value: training', 'value: staging')
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const receipts = cluster(run, clusterId).receipts
  expect(after).toHaveLength(2)
  expect(after.every(p => p.status.phase === 'Running')).toBe(true)
  expect(receipts.some(x => before.some(p => x.deletedPodUid === p.metadata.uid) && after.some(p => x.replacementPodUid === p.metadata.uid))).toBe(true)
})

it('distinguishes a missing image tag from denied kubelet pull access', () => {
  let { run, lab, clusterId } = seedFoundation()
  const depPath = 'k8s/deployment.yaml'
  const text = run.project.savedFiles[depPath].replace('assistant:v1', 'assistant:missing')
  run = act(run, lab, { type: 'save-file', path: depPath, text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const pods = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(pods.every(p => p.status.containerStatuses[0].state.waiting.reason === 'ImageNotFound')).toBe(true)
  expect(pods.every(p => !Object.hasOwn(cluster(run, clusterId).podSnapshots, p.metadata.uid))).toBe(true)
})

it('keeps captured artifacts immutable and leaves old Pods running after pull access is revoked', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const snapshots = structuredClone(cluster(run, clusterId).podSnapshots)
  run = act(run, lab, { type: 'command', line: 'az aks update -g rgaks01 -n aks01 --detach-acr acraks01' }).run
  expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(p => p.status.phase)).toEqual(['Running', 'Running'])
  expect(cluster(run, clusterId).podSnapshots).toEqual(snapshots)
  const text = run.project.savedFiles['k8s/deployment.yaml'].replace('value: training', 'value: staging')
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(after.every(p => p.status.containerStatuses[0].state.waiting.reason === 'RegistryAccessDenied')).toBe(true)
  expect(after.every(p => !Object.hasOwn(cluster(run, clusterId).podSnapshots, p.metadata.uid))).toBe(true)
  expect(before.every(p => !Object.hasOwn(cluster(run, clusterId).podSnapshots, p.metadata.uid))).toBe(true)
})

it('keeps running snapshots on republish and resolves the new tag for a later Pod', () => {
  let { run, lab, clusterId } = seedFoundation()
  const oldPods = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const state = cluster(run, clusterId)
  const oldArtifactIds = oldPods.map(pod => state.podSnapshots[pod.metadata.uid].artifactId)
  const oldFiles = oldPods.map(pod => structuredClone(state.podSnapshots[pod.metadata.uid].files))
  const app = run.project.savedFiles['app.py'].replace('"0.1"', '"2.0"')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: app }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraks01 -t assistant:v1 .' }).run
  expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(pod => pod.metadata.uid)).toEqual(oldPods.map(pod => pod.metadata.uid))
  expect(oldPods.map(pod => cluster(run, clusterId).podSnapshots[pod.metadata.uid].artifactId)).toEqual(oldArtifactIds)
  expect(oldPods.map(pod => cluster(run, clusterId).podSnapshots[pod.metadata.uid].files)).toEqual(oldFiles)
  const deployment = run.project.savedFiles['k8s/deployment.yaml'].replace('value: training', 'value: staging')
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: deployment }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const newPods = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  const currentArtifact = run.artifacts.publishedTags['acraks01.azurecr.io/assistant:v1']
  expect(newPods).toHaveLength(2)
  expect(newPods.every(pod => cluster(run, clusterId).podSnapshots[pod.metadata.uid].artifactId === currentArtifact)).toBe(true)
})

it('scales down Pods and removes their snapshots', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.savedFiles['k8s/deployment.yaml'].replace('replicas: 2', 'replicas: 1') }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(after).toHaveLength(1)
  expect(cluster(run, clusterId).podSnapshots[after[0].metadata.uid]).toBeTruthy()
  expect(before.filter(pod => !after.some(item => item.metadata.uid === pod.metadata.uid)).every(pod => !Object.hasOwn(cluster(run, clusterId).podSnapshots, pod.metadata.uid))).toBe(true)
})

it('keeps similarly prefixed Deployments and their Pods separate by owner UID', () => {
  let { run, lab, clusterId } = seedFoundation()
  let yaml = run.project.savedFiles['k8s/deployment.yaml'].replace('name: assistant\n  namespace: assistant', 'name: assistant-api\n  namespace: assistant')
  run = act(run, lab, { type: 'save-file', path: 'k8s/service.yaml', text: yaml }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }).run
  expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
  expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant-api')).toHaveLength(2)
})

it('rejects Pod snapshots whose artifact does not own their captured files', () => {
  const { run } = seedFoundation()
  const id = run.sandbox.aksClusters[0].id
  const mutated = structuredClone(run.runtime.kubernetes)
  const state = mutated.clusters[id]
  const pod = Object.values(state.resources).find(x => x.kind === 'Pod')
  state.podSnapshots[pod.metadata.uid].artifactId = 'unknown-build'
  expect(validateKubernetesRuntime(mutated, run)).toBe(false)
})

it('replaces a deleted Pod without changing its desired template', () => {
  let { run, lab, clusterId } = seedFoundation()
  const before = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  run = act(run, lab, { type: 'command', line: `kubectl delete pod ${before[0].metadata.name} -n assistant` }).run
  const after = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
  expect(after).toHaveLength(2)
  expect(after.every(p => p.status.phase === 'Running')).toBe(true)
  expect(after.some(p => p.metadata.uid === before[0].metadata.uid)).toBe(false)
  expect(after.some(p => p.metadata.uid === before[1].metadata.uid)).toBe(true)
  expect(cluster(run, clusterId).receipts.some(x => x.deletedPodUid === before[0].metadata.uid && x.replacementPodUid)).toBe(true)
})

it('preserves earlier objects when a later object fails validation during apply', () => {
  let { run, lab } = seedFoundation()
  run = act(run, lab, { type: 'save-file', path: 'k8s/namespace.yaml', text: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: retained\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: later\n  namespace: absent\nspec:\n  type: ClusterIP\n  selector:\n    app: absent\n  ports:\n  - port: 80\n    targetPort: 8080\n    protocol: TCP\n' }).run
  const result = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/namespace.yaml' }, lab)
  expect(result.lines.at(-1).text).toMatch(/Namespace 'absent'/)
  expect(result.run.runtime.kubernetes.clusters[result.run.sandbox.aksClusters[0].id].resources['Namespace//retained']).toBeTruthy()
})

it('allows an effective Deployment update when immutable selector keys are reordered', () => {
  let { run, lab, clusterId } = seedFoundation()
  const deployment = cluster(run, clusterId).resources['Deployment/assistant/assistant']
  deployment.spec.selector.matchLabels.tier = 'web'
  deployment.spec.template.metadata.labels.tier = 'web'
  const makeObject = (selector, replicas) => ({
    apiVersion: 'apps/v1', kind: 'Deployment',
    metadata: { name: 'assistant', namespace: 'assistant' },
    spec: {
      replicas,
      selector: { matchLabels: selector },
      template: {
        metadata: { labels: { ...deployment.spec.template.metadata.labels } },
        spec: deployment.spec.template.spec,
      },
    },
  })
  const first = applyKubernetesObjects(run, [makeObject({ app: 'assistant', tier: 'web' }, 2)], { clusterId }, lab)
  expect(first.diagnostics).toEqual([])
  run = first.run
  const beforeGeneration = cluster(run, clusterId).resources['Deployment/assistant/assistant'].metadata.generation
  const reordered = applyKubernetesObjects(run, [makeObject({ tier: 'web', app: 'assistant' }, 1)], { clusterId }, lab)
  expect(reordered.diagnostics).toEqual([])
  expect(cluster(reordered.run, clusterId).resources['Deployment/assistant/assistant'].spec.replicas).toBe(1)
  expect(cluster(reordered.run, clusterId).resources['Deployment/assistant/assistant'].metadata.generation).toBe(beforeGeneration + 1)
})

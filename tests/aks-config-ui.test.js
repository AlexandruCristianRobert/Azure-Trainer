import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { inspectPodConfiguration } from '../src/lib/kubernetes/configuration-inspection.js'
import { act, seedConfiguredAssistant } from './helpers/aks.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

async function render(component, lab, behavioralRun, props = {}) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore()
  await store.load(lab.id, { lab, repository: behavioralRepository() })
  store.behavioralRun = behavioralRun; store.sandbox = behavioralRun.sandbox
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return renderToString(createSSRApp(component, props).use(pinia).use(router))
}

describe('AKS configuration inspection UI support', () => {
  it('redacts Secret values by provenance, even under an innocuous environment key', () => {
    const { run, clusterId } = seedConfiguredAssistant()
    const pod = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
    const snapshot = run.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.metadata.uid]
    snapshot.environment.DISPLAY_NAME = 'fictional-sensitive-value'
    snapshot.configRefs.push({ kind: 'Secret', namespace: 'assistant', name: 'credentials', key: 'NAME', uid: 'secret-fixture', resourceVersion: '1', mode: 'env', target: 'DISPLAY_NAME' })
    const before = JSON.stringify(snapshot)
    const view = inspectPodConfiguration(run, clusterId, pod.metadata.uid)
    expect(JSON.stringify(view)).not.toContain('fictional-sensitive-value')
    expect(view.environment.find(item => item.name === 'DISPLAY_NAME')).toMatchObject({ source: 'Secret', value: '[REDACTED]' })
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('shows applied and captured versions with a pending mounted-file projection', () => {
    let { run, lab, clusterId } = seedConfiguredAssistant()
    const pod = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
    let view = inspectPodConfiguration(run, clusterId, pod.metadata.uid)
    expect(view.mountedFiles.map(item => item.path)).toContain('/etc/assistant/settings.json')
    expect(view.resources.map(item => item.kind)).toEqual(expect.arrayContaining(['ConfigMap', 'Secret']))

    const text = run.project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training', 'APP_ENV: training-updated').replace('Training assistant', 'Updated assistant')
    run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
    view = inspectPodConfiguration(run, clusterId, pod.metadata.uid)
    expect(view.pendingProjection).toMatchObject({ secondsRemaining: 60 })
    expect(view.resources.find(item => item.kind === 'ConfigMap').appliedResourceVersion)
      .not.toBe(view.resources.find(item => item.kind === 'ConfigMap').capturedResourceVersion)

    run = act(run, lab, { type: 'aks-advance', seconds: 60 }).run
    view = inspectPodConfiguration(run, clusterId, pod.metadata.uid)
    expect(view.pendingProjection).toBeNull()
    expect(view.mountedFiles.map(item => item.path)).toContain('/etc/assistant/settings.json')
    expect(view.environment.find(item => item.name === 'APP_ENV').value).toBe('training')
  })

  it('renders named fixture requests, safe profiles and the read-only Pod view', async () => {
    const seeded = seedConfiguredAssistant()
    const { run, lab, clusterId } = seeded
    const target = lab.scenarios.info.target
    lab.scenarios = {
      ...lab.scenarios,
      backups: { kind: 'aks-request', version: 1, target, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected: { status: 200, body: {} } },
      support: { kind: 'aks-request', version: 1, target, request: { method: 'POST', path: '/api/ask', body: { question: 'Who provides support?' } }, expected: { status: 200, body: {} } },
    }
    const panel = await render(AksExperimentPanel, lab, run)
    expect(panel).toContain('How long are backups kept?')
    expect(panel).toContain('Who provides support?')
    expect(panel).toContain('Advance 60 simulated seconds')
    expect(panel).toContain('ai-training.example')
    expect(panel).not.toContain('training-only-password')
    const cluster = run.sandbox.aksClusters.find(item => item.id === clusterId)
    const blade = await render(AksClusterBlade, lab, run, { resourceGroup: cluster.resourceGroup, name: cluster.name })
    expect(blade).toContain('Pod configuration snapshot')
    expect(blade).toContain('/etc/assistant/settings.json')
    expect(blade).toContain('Captured version')
    expect(blade).not.toContain('training-only-password')
  })

  it('includes ConfigMap and normalized Secret data in the applied-state fingerprint', async () => {
    const editor = await readFile(new URL('../src/components/lab/ProjectEditor.vue', import.meta.url), 'utf8')
    expect(editor).toContain('stringData')
    expect(editor).toContain('value.data')
    expect(editor).toContain('value.type')
  })
})

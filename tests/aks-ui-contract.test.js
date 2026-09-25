import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const root = new URL('../src/', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

it('routes Kubernetes labs to a declared-scenario experiment panel', async () => {
  const panel = await source('components/lab/ExperimentPanel.vue')
  const aks = await source('components/lab/AksExperimentPanel.vue')
  expect(panel).toContain('AksExperimentPanel')
  expect(panel).toContain('capabilities?.kubernetes')
  expect(aks).toContain("type: 'aks-request'")
  expect(aks).toContain('scenarioId')
  expect(aks).toContain('run.completedAt')
})

it('labels Python/YAML project state and registers the AKS portal blade', async () => {
  const editor = await source('components/lab/ProjectEditor.vue')
  const host = await source('components/blade/BladeHost.vue')
  const group = await source('components/blade/ResourceGroupBlade.vue')
  expect(editor).toContain('Saved')
  expect(editor).toContain('Applied')
  expect(editor).toContain('Built')
  expect(host).toContain('AksClusterBlade')
  expect(group).toContain("kind: 'aks-cluster'")
})

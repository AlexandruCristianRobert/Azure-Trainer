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
  expect(aks).toContain('latestEvidence')
  expect(aks).toContain('HTTP {{ latestEvidence.measurements?.status }}')
  expect(aks).toContain('JSON.stringify(latestEvidence.measurements?.body')
})

it('labels Python/YAML project state and registers the AKS portal blade', async () => {
  const editor = await source('components/lab/ProjectEditor.vue')
  const host = await source('components/blade/BladeHost.vue')
  const group = await source('components/blade/ResourceGroupBlade.vue')
  expect(editor).toContain('Saved')
  expect(editor).toContain('Applied')
  expect(editor).toContain('Built')
  expect(editor).toContain('parseKubernetesYaml')
  expect(editor).toContain('Applied to the current cluster')
  expect(editor).toContain('context.namespace')
  expect(host).toContain('AksClusterBlade')
  expect(group).toContain("kind: 'aks-cluster'")
})

it('renders and copies AKS solution step kinds without serializing resolver functions', async () => {
  const taskRow = await source('components/lab/TaskRow.vue')
  expect(taskRow).toContain("step.kind === 'inspect'")
  expect(taskRow).toContain("step.kind === 'scenario'")
  expect(taskRow).toContain('step.resolver')
  expect(taskRow).toContain("step.line ?? step.instruction")
  expect(taskRow).toContain('Inspect')
  expect(taskRow).toContain('Experiments')
})

import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import CpuExperimentPanel from '../src/components/lab/CpuExperimentPanel.vue'
import { cpuGuidedLab } from '../src/data/labs/containerapps-journey/cpu-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'

it('shows current pending replicas after a scaler decision before the new replica is ready', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-metric-ui' })
  const actions = [
    { type: 'command', line: cpuGuidedLab.tasks[0].solution.steps[0].line },
    { type: 'scenario-start', scenarioId: 'sustained' },
    { type: 'simulation-advance', seconds: 15 },
  ]
  for (const action of actions) {
    const result = applyRunAction(run, action, cpuGuidedLab)
    expect(result.diagnostics).toEqual([])
    run = result.run
  }
  const state = Object.values(run.runtime.cpuByApp)[0]
  expect(state).toMatchObject({ readyReplicas: 1, desiredReplicas: 2, pendingReplicas: [{ count: 1 }] })
  store.labId = cpuGuidedLab.id
  store.sandbox = run.sandbox
  store.behavioralRun = run
  const html = await renderToString(createSSRApp(CpuExperimentPanel).use(pinia))
  expect(html).toMatch(/<dt>Ready<\/dt><dd>1<\/dd>/)
  expect(html).toMatch(/<dt>Pending<\/dt><dd>1<\/dd>/)
  expect(html).toMatch(/<dt>Desired<\/dt><dd>2<\/dd>/)
})

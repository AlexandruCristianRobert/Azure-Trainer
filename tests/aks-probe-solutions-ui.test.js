import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TaskRow from '../src/components/lab/TaskRow.vue'
import { aksProbesGuidedLab } from '../src/data/labs/aks-journey/probes-guided.lab.js'

it('renders a readable named probe experiment and explicit advance in its revealed Solution', async () => {
  const task = aksProbesGuidedLab.tasks.find(item => item.id === 'protected-startup')
  const html = await renderToString(createSSRApp(TaskRow, {
    task: { ...task, index: 2 }, state: 'current', solutionRevealed: true,
  }))
  expect(html).toContain('guided-probe-startup')
  expect(html).toContain('Advance the AKS simulation by 30 seconds')
  expect(html).not.toContain('undefined')
})

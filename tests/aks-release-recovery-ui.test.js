import { expect, test } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TaskRow from '../src/components/lab/TaskRow.vue'
import { aksReleasesTroubleshootingLab as lab } from '../src/data/labs/aks-journey/releases-troubleshooting.lab.js'

test('revealed recovery Solution exposes the full supplied-key alternative to learners', async () => {
  const html = await renderToString(createSSRApp(TaskRow, {
    task: { ...lab.tasks[2], index: 2 }, state: 'current', solutionRevealed: true,
  }))
  expect(html).toContain('Supply the requested ConfigMap key')
  expect(html).toContain('ANSWER_DEPLOYMENT_V2: answers-v1')
  expect(html).toContain('kubectl apply -f k8s/configmap.yaml')
  expect(html).not.toContain('undefined')
})

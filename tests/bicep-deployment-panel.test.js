import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import BicepDeploymentPanel from '../src/components/lab/BicepDeploymentPanel.vue'
import { bicepGuidedLab } from '../src/data/labs/containerapps-journey/bicep-guided.lab.js'
import { bicepTroubleshootingLab } from '../src/data/labs/containerapps-journey/bicep-troubleshooting.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { useLabRunStore } from '../src/stores/labRun.js'

const fresh = () => createBehavioralRun(bicepGuidedLab, { attemptId: 'bicep-panel' })
function act(run, action) {
  const result = applyRunAction(run, action, bicepGuidedLab)
  return result
}
function through(taskId) {
  let run = fresh()
  for (const task of bicepGuidedLab.tasks) {
    for (const step of task.solution.steps) {
      const action = step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
        : step.kind === 'command' ? { type: 'command', line: step.line } : step.action
      const result = act(run, action)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    if (task.id === taskId) break
  }
  return run
}
async function render(run, diagnostics = [], readOnly = false, lab = bicepGuidedLab) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = lab.id
  store.behavioralRun = run
  store.diagnostics = diagnostics
  store.readOnly = readOnly
  return renderToString(createSSRApp(BicepDeploymentPanel).use(pinia))
}

function troubleshootingThrough(taskId) {
  let run = createBehavioralRun(bicepTroubleshootingLab, { attemptId: 'incident-panel' })
  for (const task of bicepTroubleshootingLab.tasks) {
    for (const step of task.solution.steps) {
      const action = step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
        : step.kind === 'command' ? { type: 'command', line: step.line } : step.action
      const result = applyRunAction(run, action, bicepTroubleshootingLab)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    if (task.id === taskId) break
  }
  return run
}

describe('Bicep deployment panel', () => {
  it('shows the saved project and selected target before validation or preview', async () => {
    const html = await render(fresh())
    expect(html).toContain('Saved Bicep project')
    expect(html).toContain('infra/main.bicep')
    expect(html).toContain('infra/first.bicepparam')
    expect(html).toContain('infra/modules/app.bicep')
    expect(html).toContain('version 0')
    expect(html).toContain('rg-aca-bicep')
    expect(html).toContain('first')
    expect(html).toContain('No what-if preview yet')
    expect(html).toContain('No deployment attempt yet')
    expect(html).toContain('local simulation')
    expect(html).not.toMatch(/<button|<input|<select|<textarea/)
  })

  it('shows located validation diagnostics from a failed saved-file command', async () => {
    let run = through('parameters')
    const path = 'infra/main.bicep'
    run = act(run, { type: 'save-file', path, text: `${run.project.savedFiles[path]}\nresource broken` }).run
    const validation = act(run, { type: 'command', line: bicepGuidedLab.tasks.find(task => task.id === 'validate').solution.steps[0].line })
    expect(validation.diagnostics.length).toBeGreaterThan(0)
    const html = await render(validation.run, validation.diagnostics)
    expect(html).toContain('Validation diagnostics')
    expect(html).toContain(`${path}:${validation.diagnostics[0].line}:${validation.diagnostics[0].column}`)
    expect(html).toContain(validation.diagnostics[0].code)
  })

  it('shows what-if operations, then marks the preview stale after an away-and-back save', async () => {
    let run = through('preview')
    let html = await render(run)
    expect(html).toContain('Current preview')
    expect(html).toContain('Create')
    expect(html).toContain('Ignored existing')
    const path = 'infra/modules/app.bicep'
    const original = run.project.savedFiles[path]
    run = act(run, { type: 'save-file', path, text: original.replace('maxReplicas: 2', 'maxReplicas: 3') }).run
    run = act(run, { type: 'save-file', path, text: original }).run
    html = await render(run)
    expect(html).toContain('Stale preview')
    expect(html).toContain('Run what-if again')
  })

  it('shows latest status, outputs and partial operations while preserving a read-only result', async () => {
    const run = through('create')
    let html = await render(run, [], true)
    expect(html).toContain('Succeeded')
    expect(html).toContain('Deployment outputs')
    expect(html).toContain('Read-only result')
    const failed = structuredClone(run)
    const latest = failed.runtime.bicep.currentByTarget['rg-aca-bicep/first'].latest
    latest.status = 'failed'
    latest.outputs = {}
    latest.operations = latest.operations.slice(0, 2)
    latest.diagnostics = [{ code: 'BICEP_APPLY_FAILED', message: 'Activation failed', path: 'infra/modules/app.bicep', line: 7, column: 3 }]
    html = await render(failed)
    expect(html).toContain('Failed')
    expect(html).toContain('Applied before failure')
    expect(html).toContain('Activation failed')
    expect(html).not.toContain('Deployment outputs')
  })
})

describe('Bicep incident deployment panel', () => {
  it('shows the located failed validation immediately, while reload retains only Cloud Shell history', async () => {
    const run = createBehavioralRun(bicepTroubleshootingLab, { attemptId: 'incident-panel' })
    const line = bicepTroubleshootingLab.tasks[0].solution.steps[1].line
    const failed = applyRunAction(run, { type: 'command', line }, bicepTroubleshootingLab)
    const diagnostic = failed.diagnostics.find(item => item.path && item.line && item.column)
    expect(diagnostic).toBeDefined()
    const html = await render(failed.run, failed.diagnostics, false, bicepTroubleshootingLab)
    expect(html).toContain(`${diagnostic.path}:${diagnostic.line}:${diagnostic.column}`)
    expect(html).toContain(diagnostic.code)
    expect(failed.run.runtime.bicep.observations).toEqual([])
    const reloaded = migrateBehavioralRun(structuredClone(failed.run), bicepTroubleshootingLab)
    expect(reloaded.history).toContain(line)
    expect(reloaded.scrollback.some(item => item.kind === 'err' && item.text.includes(diagnostic.code))).toBe(true)
    const reloadedHtml = await render(reloaded, [], false, bicepTroubleshootingLab)
    expect(reloadedHtml).not.toContain(diagnostic.code)
  })

  it('compares the preserved wrong environment with the current corrected preview without edit controls', async () => {
    const run = troubleshootingThrough('correct-preview')
    const html = await render(run, [], true, bicepTroubleshootingLab)
    expect(html).toContain('Historical preview')
    expect(html).toContain('Current saved-file preview')
    expect(html).toContain('env-bicep-test')
    expect(html).toContain('env-bicep-incident')
    expect(html).toContain(run.runtime.bicep.incidentPreview.id)
    expect(html).toContain('Read-only result')
    expect(html).not.toMatch(/<button|<input|<select|<textarea/)
  })

  it('keeps the wrong preview visible after preview-history pruning and a stale current preview', async () => {
    let run = troubleshootingThrough('correct-preview')
    const command = bicepTroubleshootingLab.tasks.find(task => task.id === 'correct-preview').solution.steps[1].line
    for (let index = 0; index < 12; index++) {
      const result = applyRunAction(run, { type: 'command', line: command }, bicepTroubleshootingLab)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    const path = 'infra/modules/app.bicep'
    const original = run.project.savedFiles[path]
    run = applyRunAction(run, { type: 'save-file', path, text: `${original}\n// changed` }, bicepTroubleshootingLab).run
    run = applyRunAction(run, { type: 'save-file', path, text: original }, bicepTroubleshootingLab).run
    const reloaded = migrateBehavioralRun(structuredClone(run), bicepTroubleshootingLab)
    const html = await render(reloaded, [], false, bicepTroubleshootingLab)
    expect(html).toContain('Historical preview')
    expect(html).toContain('env-bicep-test')
    expect(html).toContain('Stale preview')
    expect(html).toContain('Latest recorded preview')
    expect(html).not.toContain('Current saved-file preview')
    expect(html).toContain('Run what-if again')
  })
})

import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import BicepDeploymentPanel from '../src/components/lab/BicepDeploymentPanel.vue'
import { bicepIndependentLab } from '../src/data/labs/containerapps-journey/bicep-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'
import { bicepTargetKey } from '../src/lib/bicep/provenance.js'

async function render(run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-panel' }), readOnly = false, selected = 0) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = bicepIndependentLab.id
  store.behavioralRun = run
  store.readOnly = readOnly
  const setup = BicepDeploymentPanel.setup
  BicepDeploymentPanel.setup = (props, context) => {
    const bindings = setup(props, context)
    bindings.selectedTargetIndex.value = selected
    return bindings
  }
  try { return await renderToString(createSSRApp(BicepDeploymentPanel).use(pinia)) }
  finally { BicepDeploymentPanel.setup = setup }
}

describe('independent Bicep deployment review', () => {
  it('renders keyboard-operable trusted target choices with primary selected on each mount', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-reload' })
    const html = await render(run)
    expect(html).toContain('Primary')
    expect(html).toContain('Staging')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[^<]*Primary/)
    expect(html).toContain('rg-aca-bicep-primary')
    expect(html).toContain('infra/first.bicepparam')
    expect(html).toContain('local simulation')
    expect(await render(run)).toContain('aria-pressed="true"')
    expect(await render(run, true)).toContain('Read-only result')
  })

  it('renders selected staging target with its own parameter and empty deployment history', async () => {
    const html = await render(undefined, false, 1)
    expect(html).toContain('rg-aca-bicep-staging')
    expect(html).toContain('infra/second.bicepparam')
    expect(html).not.toContain('Parameter file: <code>infra/first.bicepparam')
    expect(html).toContain('No what-if preview yet')
  })

  it('keeps primary preview current across staging-only edits and marks staging stale', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-stale' })
    for (const target of bicepIndependentLab.bicepTargets) {
      const key = bicepTargetKey(target.resourceGroup, target.deploymentName)
      run.runtime.bicep.currentByTarget[key] = { preview: {
        id: `preview-${target.deploymentName}`, key, target: target.resourceGroup, name: target.deploymentName,
        parameterPath: target.parameterPath, ...bicepCommandSource(run, target.parameterPath), operations: [],
      } }
    }
    const stagingPath = 'infra/second.bicepparam'
    run.project.savedFiles[stagingPath] += '\n// staging revision'
    run.project.fileVersions[stagingPath] = 1
    expect(await render(run)).toContain('Current preview')
    expect(await render(run, false, 1)).toContain('Stale preview')
    run.project.savedFiles['infra/main.bicep'] += '\n// shared revision'
    run.project.fileVersions['infra/main.bicep'] = 1
    expect(await render(run)).toContain('Stale preview')
  })

  it('shows saved and unsaved selected parameter state without exposing edit controls', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-draft' })
    run.project.draftFiles['infra/second.bicepparam'] += '\n// draft'
    const html = await render(run, true, 1)
    expect(html).toContain('infra/second.bicepparam')
    expect(html).toMatch(/infra\/second\.bicepparam<\/code><span>version 0[\s\S]*?unsaved draft/)
    expect(html).toContain('Read-only result')
    expect(html).not.toMatch(/<input|<textarea|<select/)
  })

  it('shows only the selected target deployment and outputs', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-outputs' })
    for (const target of bicepIndependentLab.bicepTargets) {
      const key = bicepTargetKey(target.resourceGroup, target.deploymentName)
      run.runtime.bicep.currentByTarget[key] = { latest: {
        id: `attempt-${target.deploymentName}`, key, target: target.resourceGroup, name: target.deploymentName,
        parameterPath: target.parameterPath, ...bicepCommandSource(run, target.parameterPath),
        status: 'succeeded', operations: [], outputs: { appName: target.appName },
      } }
    }
    const primary = await render(run)
    expect(primary).toContain('api-bicep-primary')
    expect(primary).not.toContain('api-bicep-staging')
    const staging = await render(run, false, 1)
    expect(staging).toContain('api-bicep-staging')
    expect(staging).not.toContain('api-bicep-primary')
  })

  it('marks a successful deployment and its recorded outputs stale after a selected parameter edit', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-attempt-stale' })
    for (const target of bicepIndependentLab.bicepTargets) {
      const key = bicepTargetKey(target.resourceGroup, target.deploymentName)
      run.runtime.bicep.currentByTarget[key] = { latest: {
        id: `attempt-${target.deploymentName}`, key, target: target.resourceGroup, name: target.deploymentName,
        parameterPath: target.parameterPath, ...bicepCommandSource(run, target.parameterPath),
        status: 'succeeded', operations: [], outputs: { appName: target.appName },
      } }
    }
    run.project.savedFiles['infra/second.bicepparam'] += '\n// saved revision'
    run.project.fileVersions['infra/second.bicepparam'] = 1
    expect(await render(run)).toContain('Current deployment')
    const staging = await render(run, false, 1)
    expect(staging).toContain('Stale deployment')
    expect(staging).toContain('Recorded deployment outputs (stale)')
    expect(staging).not.toContain('Current deployment')
  })

  it('shows the saved selected parameter hash beside its path and version', async () => {
    const run = createBehavioralRun(bicepIndependentLab, { attemptId: 'dual-parameter-hash' })
    const firstHash = bicepCommandSource(run, 'infra/first.bicepparam').parameterHash
    const secondHash = bicepCommandSource(run, 'infra/second.bicepparam').parameterHash
    expect(firstHash).not.toBe(secondHash)
    const primary = await render(run)
    expect(primary).toContain(`Parameter hash: <code>${firstHash}</code>`)
    expect(primary).not.toContain(`Parameter hash: <code>${secondHash}</code>`)
    const staging = await render(run, false, 1)
    expect(staging).toContain(`Parameter hash: <code>${secondHash}</code>`)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import LabPanel from '../src/components/lab/LabPanel.vue'
import BicepDeploymentPanel from '../src/components/lab/BicepDeploymentPanel.vue'
import CpuExperimentPanel from '../src/components/lab/CpuExperimentPanel.vue'
import ProbeExperimentPanel from '../src/components/lab/ProbeExperimentPanel.vue'
import { capstoneLab } from '../src/data/labs/containerapps-journey/capstone.lab.js'
import { bicepGuidedLab } from '../src/data/labs/containerapps-journey/bicep-guided.lab.js'
import { CAPSTONE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'
import { bicepTargetKey } from '../src/lib/bicep/provenance.js'

function act(run, action) {
  const result = applyRunAction(run, action, capstoneLab)
  expect(result.diagnostics).toEqual([])
  return result.run
}

async function render(component, behavioralRun, selected = 0, lab = capstoneLab) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = lab.id
  store.behavioralRun = behavioralRun
  store.sandbox = behavioralRun.sandbox
  if (component !== BicepDeploymentPanel) return renderToString(createSSRApp(component).use(pinia))
  const setup = component.setup
  component.setup = (props, context) => {
    const bindings = setup(props, context)
    bindings.selectedTargetIndex.value = selected
    return bindings
  }
  try { return await renderToString(createSSRApp(component).use(pinia)) }
  finally { component.setup = setup }
}

async function renderBindings(component, behavioralRun) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = capstoneLab.id
  store.behavioralRun = behavioralRun
  store.sandbox = behavioralRun.sandbox
  const setup = component.setup
  let bindings
  component.setup = (props, context) => { bindings = setup(props, context); return bindings }
  try {
    const html = await renderToString(createSSRApp(component).use(pinia))
    return { bindings, store, html }
  } finally { component.setup = setup }
}

describe('Capstone rendered controls', () => {
  it('preserves ordinary stage groups and their help controls in earlier Labs', async () => {
    const run = createBehavioralRun(bicepGuidedLab, { attemptId: 'older-lab-ui' })
    const html = await render(LabPanel, run, 0, bicepGuidedLab)
    expect(html).not.toContain('Locked stage')
    expect(html).not.toContain('Advance to')
    expect(html).toContain('Show hint 1')
    expect(html).not.toMatch(/class="task__hint-link" disabled/)
  })
  it('distinguishes active, locked and sealed stages and enables advance only when the active Tasks pass', async () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-ui' })
    let html = await render(LabPanel, run)
    expect(html).toContain('Active stage')
    expect(html).toContain('Locked stage')
    expect(html).toMatch(/<button[^>]*disabled>Advance to Bootstrap and publish<\/button>/)
    for (const path of ['src/Trainer.Api/Program.cs', 'src/Trainer.Api/appsettings.json'])
      run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path] })
    html = await render(LabPanel, run)
    expect(html).toContain('Advance to Bootstrap and publish')
    expect(html).toMatch(/<button[^>]*class="btn btn--primary lab-panel__advance">Advance to Bootstrap and publish<\/button>/)
    run = act(run, { type: 'advance-stage' })
    html = await render(LabPanel, run)
    expect(html).toContain('Sealed stage')
    expect(html).toContain('Bootstrap and publish')
    expect(html).toContain('Checkpoint pending')
  })

  it('labels both Bicep roots and shows only the selected target context', async () => {
    const run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-bicep-ui' })
    const html = await render(BicepDeploymentPanel, run)
    expect(html).toContain('Bootstrap')
    expect(html).toContain('Main application')
    expect(html).toContain('infra/bootstrap.bicep')
    expect(html).toContain('infra/bootstrap.bicepparam')
    expect(html).not.toContain('infra/main.bicepparam</code>')
    const main = await render(BicepDeploymentPanel, run, 1)
    expect(main).toContain('infra/main.bicepparam')
    expect(main).not.toContain('infra/bootstrap.bicepparam</code>')
  })

  it('keeps root-specific outputs separate and explains saved desired versus live effective incident drift', async () => {
    const run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-output-ui' })
    for (const [index, target] of capstoneLab.bicepTargets.entries()) {
      const key = bicepTargetKey(target.resourceGroup, target.deploymentName)
      run.runtime.bicep.currentByTarget[key] = { latest: {
        id: `attempt-${index}`, key, target: target.resourceGroup, name: target.deploymentName,
        parameterPath: target.parameterPath, ...bicepCommandSource(run, target.parameterPath),
        status: 'succeeded', operations: [], outputs: { marker: index ? 'main-only' : 'bootstrap-only' },
      } }
    }
    expect(await render(BicepDeploymentPanel, run)).toContain('bootstrap-only')
    expect(await render(BicepDeploymentPanel, run)).not.toContain('main-only')
    run.runtime.incident = { id: 'incident-42', status: 'active', desiredDeployment: 'brief-model' }
    const main = await render(BicepDeploymentPanel, run, 1)
    expect(main).toContain('main-only')
    expect(main).not.toContain('bootstrap-only')
    expect(main).toContain('Saved desired Foundry deployment')
    expect(main).toContain('Live effective deployment')
    expect(main).toContain('missing-deployment')
  })

  it('keeps CPU and probe controls with their own active scenario kind', async () => {
    const base = createBehavioralRun(capstoneLab, { attemptId: 'capstone-mixed-ui' })
    const cpuRun = structuredClone(base)
    cpuRun.runtime.activeScenario = { kind: 'cpu', scenarioId: 'baseline-steady', elapsedSeconds: 1, paused: false }
    const probeRun = structuredClone(base)
    probeRun.runtime.activeScenario = { kind: 'probes', scenarioId: 'baseline-startup', elapsedSeconds: 1, paused: false }
    expect(await render(ProbeExperimentPanel, cpuRun)).toMatch(/probe-experiment__progress" role="status">Ready/)
    expect(await render(CpuExperimentPanel, probeRun)).toMatch(/cpu-experiment__progress" role="status">Ready/)
  })

  it('dispatches trusted advance and one-shot incident actions from rendered control handlers', async () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-control-ui' })
    for (const path of ['src/Trainer.Api/Program.cs', 'src/Trainer.Api/appsettings.json'])
      run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path] })
    const advance = await renderBindings(LabPanel, run)
    const dispatchAdvance = vi.fn(async () => ({ effects: { diagnostics: [] } }))
    advance.store.dispatchBehavioral = dispatchAdvance
    expect(advance.html).toMatch(/<button[^>]*lab-panel__advance[^>]*>Advance to Bootstrap and publish<\/button>/)
    await advance.bindings.stageAction('advance-stage')
    expect(dispatchAdvance).toHaveBeenCalledWith({ type: 'advance-stage' })

    const incidentRun = structuredClone(run)
    incidentRun.stages.sealedStages = capstoneLab.stages.slice(0, 4)
      .map(stage => ({ taskIds: stage.taskIds, evidenceIds: [] }))
    incidentRun.stages.activeStageId = 'incident'
    const incident = await renderBindings(LabPanel, incidentRun)
    const dispatchIncident = vi.fn(async () => ({ effects: { diagnostics: [] } }))
    incident.store.dispatchBehavioral = dispatchIncident
    expect(incident.html).toMatch(/<button[^>]*>Inject simulated incident<\/button>/)
    await incident.bindings.stageAction('inject-incident')
    expect(dispatchIncident).toHaveBeenCalledWith({ type: 'inject-incident' })
  })

  it('switches Bicep target state while preserving native button keyboard semantics', async () => {
    const run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-keyboard-ui' })
    const initial = await renderBindings(BicepDeploymentPanel, run)
    expect(initial.html).toMatch(/<button type="button" aria-pressed="false">Main application<\/button>/)
    initial.bindings.selectedTargetIndex.value = 1
    expect(initial.bindings.target.value.parameterPath).toBe('infra/main.bicepparam')
    const selected = await render(BicepDeploymentPanel, run, 1)
    expect(selected).toMatch(/<button type="button" aria-pressed="true">Main application<\/button>/)
    expect(selected).toContain('Parameter file: <code>infra/main.bicepparam</code>')
  })
})

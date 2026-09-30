import { describe, expect, it } from 'vitest'
import { runLine } from '../src/lib/az/shell.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { BICEP_MANIFEST, BICEP_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/bicep-guided.js'

const main = 'infra/main.bicep'
const parameters = 'infra/first.bicepparam'
const source = `targetScope = 'resourceGroup'
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'app-id'
  location: resourceGroup().location
}
resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: 'app-env'
  location: resourceGroup().location
  properties: { appLogsConfiguration: { destination: 'none' } }
}
output identityId string = identity.id`
const full = '--name first --resource-group demo-rg --template-file infra/main.bicep --parameters infra/first.bicepparam'

function setup() {
  const lab = { id: 'bicep-cli-test', engineVersion: 2, contentVersion: 1, manifestId: BICEP_MANIFEST.id,
    capabilities: { bicepDeployment: true }, tasks: [], initialProjectFiles: { ...BICEP_STARTER_FILES,
      [main]: source, [parameters]: "using './main.bicep'\n" },
    seed: sandbox => ({ ...sandbox, resourceGroups: [{ name: 'demo-rg', location: 'eastus' }] }) }
  return { lab, run: createBehavioralRun(lab, { attemptId: 'one' }) }
}
const command = (run, lab, verb, args = full) => applyRunAction(run, { type: 'command', line: `az deployment group ${verb} ${args}` }, lab)
const output = result => JSON.parse(result.lines.find(line => line.kind === 'out').text)

describe('az deployment group bounded CLI', () => {
  it('validates saved Bicep without changing Sandbox or earning preview', () => {
    const { lab, run } = setup()
    const before = structuredClone(run.sandbox)
    const result = command(run, lab, 'validate')
    expect(output(result)).toMatchObject({ status: 'succeeded', target: 'demo-rg' })
    expect(result.run.sandbox).toEqual(before)
    expect(result.run.runtime.bicep.previews).toEqual([])
    expect(result.run.runtime.bicep.attempts).toEqual([])
  })

  it('previews saved files, records provenance, and creates repeat attempts for one target', () => {
    const { lab, run } = setup()
    const draft = applyRunAction(run, { type: 'draft', path: main, text: 'broken source' }, lab).run
    const preview = command(draft, lab, 'what-if')
    expect(output(preview).id).toBe('bicep-preview-1')
    expect(output(preview).operations.map(item => item.changeType)).toEqual(['create', 'create'])
    expect(preview.run.sandbox).toEqual(run.sandbox)
    expect(preview.run.runtime.bicep.previews).toHaveLength(1)
    const created = command(preview.run, lab, 'create')
    expect(output(created)).toMatchObject({ status: 'succeeded', outputs: { identityId: expect.stringContaining('/app-id') } })
    expect(created.run.sandbox.managedIdentities).toHaveLength(1)
    expect(created.run.sandbox.containerAppEnvironments).toHaveLength(1)
    const again = command(created.run, lab, 'create')
    expect(output(again).operations.map(item => item.changeType)).toEqual(['no-change', 'no-change'])
    expect(again.run.runtime.bicep.attempts).toHaveLength(2)
    const shown = command(again.run, lab, 'show', '--name first --resource-group demo-rg')
    expect(output(shown).id).toBe('bicep-attempt-2')
    expect(shown.run.sandbox).toEqual(again.run.sandbox)
  })

  it('rejects unsupported paths, modes, inline parameters, remote sources, and unknown scopes', () => {
    const { lab, run } = setup()
    for (const args of [
      full.replace('infra/main.bicep', './infra/main.bicep'),
      full.replace('infra/first.bicepparam', 'name=spoof'),
      full.replace('infra/main.bicep', 'https://example.com/main.bicep'),
      `${full} --mode Complete`,
      `${full} --template-uri https://example.com/main.bicep`,
      `${full} --bogus value`,
    ]) {
      const result = command(run, lab, 'create', args)
      expect(result.lines.some(line => line.kind === 'err')).toBe(true)
      expect(result.run.sandbox).toEqual(run.sandbox)
      expect(result.run.runtime.bicep.attempts).toEqual([])
    }
    expect(command(run, lab, 'show', `--name first --resource-group demo-rg --template-file ${main}`).lines[0].kind).toBe('err')
    expect(runLine(run.sandbox, 'az deployment sub create', { run, lab }).lines[0].kind).toBe('err')
  })

  it('shows group help and rejects injected effect records', () => {
    const { lab, run } = setup()
    expect(runLine(run.sandbox, 'az deployment group --help', { run, lab }).lines[0].text).toContain('what-if')
    expect(runLine(run.sandbox, 'az deployment group create --help', { run, lab }).lines[0].text).toContain('--template-file')
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', name: 'first', resourceGroup: 'demo-rg', operations: [{ changeType: 'no-change' }] }], lab)).toThrow()
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', name: 'first', resourceGroup: 'demo-rg', status: 'succeeded' }], lab)).toThrow()
    const result = command(run, lab, 'create')
    expect(result.run.runtime.bicep.attempts).toHaveLength(1)
    expect(() => applyCommandEffects(run, [{ type: 'bicep-deployment', graph: { target: { name: 'demo-rg', id: 'forged', location: 'eastus' }, order: [] },
      options: { name: 'first', sourceHash: 'forged', parameterHash: 'forged', fileVersions: {} } }], lab)).toThrow()
  })

  it('persists current preview and latest attempt across native reload', () => {
    const { lab, run } = setup()
    const preview = command(run, lab, 'what-if')
    const created = command(preview.run, lab, 'create')
    const reloaded = migrateBehavioralRun(structuredClone(created.run), lab)
    expect(reloaded.runtime.bicep.currentByTarget['demo-rg/first'].preview.id).toBe('bicep-preview-1')
    expect(output(command(reloaded, lab, 'show', '--name first --resource-group demo-rg')).id).toBe('bicep-attempt-1')
  })

  it('reports compiler diagnostics without preview or deployment attempts', () => {
    const { lab, run } = setup()
    const changed = applyRunAction(run, { type: 'save-file', path: main, text: "targetScope = 'resourceGroup'\noutput id string = missing" }, lab)
    expect(changed.diagnostics).toEqual([])
    for (const verb of ['validate', 'what-if', 'create']) {
      const result = command(changed.run, lab, verb)
      expect(result.lines[0]).toMatchObject({ kind: 'err' })
      expect(result.diagnostics[0]).toMatchObject({ code: 'MISSING_BICEP_REFERENCE', path: main, line: 2 })
      expect(result.run.sandbox).toEqual(run.sandbox)
      expect(result.run.runtime.bicep.attempts).toEqual([])
      expect(result.run.runtime.bicep.previews).toEqual([])
    }
  })

  it('accepts name and group aliases while keeping saved paths exact', () => {
    const { lab, run } = setup()
    const aliases = '-n first -g demo-rg --template-file infra/main.bicep --parameters infra/first.bicepparam'
    const validated = command(run, lab, 'validate', aliases)
    expect(output(validated).status).toBe('succeeded')
    const preview = command(validated.run, lab, 'what-if', aliases)
    expect(output(preview).operations).toHaveLength(2)
    expect(preview.run.sandbox).toEqual(run.sandbox)
    const created = command(preview.run, lab, 'create', aliases)
    expect(output(created).status).toBe('succeeded')
    expect(output(command(created.run, lab, 'show', '-n first -g demo-rg')).id).toBe('bicep-attempt-1')
    for (const bad of [aliases.replace('infra/main.bicep', './infra/main.bicep'),
      aliases.replace('infra/first.bicepparam', '.\\infra\\first.bicepparam')]) {
      expect(command(run, lab, 'validate', bad).lines[0].kind).toBe('err')
    }
  })

  it('describes the capability as a Bicep Lab in unavailable command errors', () => {
    const { lab, run } = setup()
    const unavailable = { ...lab, capabilities: {} }
    expect(command(run, unavailable, 'validate').lines[0].text).toContain('Bicep Lab')
    expect(command(run, unavailable, 'show', '--name first --resource-group demo-rg').lines[0].text).toContain('Bicep Lab')
  })
})

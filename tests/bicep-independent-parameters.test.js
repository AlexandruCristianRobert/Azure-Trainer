import { describe, expect, it } from 'vitest'
import { parseBicepProject } from '../src/lib/bicep/parser.js'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction, applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'
import { runLine } from '../src/lib/az/shell.js'
import { BICEP_INDEPENDENT_MANIFEST } from '../src/data/templates/containerapps-dotnet/bicep-independent.js'
import { BICEP_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/bicep-guided.js'

const first = 'infra/first.bicepparam'
const second = 'infra/second.bicepparam'
const main = 'infra/main.bicep'
const files = { ...BICEP_STARTER_FILES, [main]: "param label string\noutput selected string = label", [first]: "using './main.bicep'\nparam label = 'primary'", [second]: "using './main.bicep'\nparam label = 'secondary'",
  ...Object.fromEntries(BICEP_INDEPENDENT_MANIFEST.bicepFiles.filter(path => path.endsWith('.bicep') && path !== main).map(path => [path, "output unused string = 'ok'"])) }
const targets = [
  { parameterPath: first, resourceGroup: 'first-rg', deploymentName: 'first-deploy', appName: 'first-app' },
  { parameterPath: second, resourceGroup: 'second-rg', deploymentName: 'second-deploy', appName: 'second-app' },
]
const lab = { id: 'aca-bicep-independent', engineVersion: 2, contentVersion: 1,
  manifestId: BICEP_INDEPENDENT_MANIFEST.id, capabilities: { bicepDeployment: true },
  bicepTargets: targets, tasks: [], initialProjectFiles: files,
  seed: sandbox => ({ ...sandbox, resourceGroups: [
    { name: 'first-rg', location: 'eastus' }, { name: 'second-rg', location: 'eastus' },
  ] }) }
const make = () => createBehavioralRun(lab, { attemptId: 'parameter-test' })
const cli = (run, verb, path = second, group = 'second-rg', name = 'second-deploy') =>
  applyRunAction(run, { type: 'command', line: `az deployment group ${verb} --name ${name} --resource-group ${group} --template-file infra/main.bicep --parameters ${path}` }, lab)
const out = result => JSON.parse(result.lines.find(line => line.kind === 'out').text)

describe('independent Bicep parameter selection', () => {
  it('compiles shared source with only selected local parameters', () => {
    const selected = parseBicepProject({ ...files, [first]: 'invalid!!' }, BICEP_INDEPENDENT_MANIFEST, second)
    expect(selected.diagnostics).toEqual([])
    expect(selected.params.path).toBe(second)
    expect(compileBicepProject({ ...files, [first]: 'invalid!!' }, BICEP_INDEPENDENT_MANIFEST,
      { resourceGroup: { name: 'second-rg', location: 'eastus' }, parameterPath: second }).graph.outputs.selected).toBe('secondary')
    for (const path of [undefined, '../second.bicepparam', 'https://example.com/second.bicepparam', 'label=secondary']) {
      expect(parseBicepProject(files, BICEP_INDEPENDENT_MANIFEST, path).diagnostics.length).toBeGreaterThan(0)
    }
    expect(parseBicepProject({ ...files, [second]: "using './other.bicep'" }, BICEP_INDEPENDENT_MANIFEST, second).diagnostics.length).toBeGreaterThan(0)
  })

  it('keeps source provenance independent of the unselected parameter file', () => {
    const run = make()
    const before = bicepCommandSource(run, first)
    const edited = applyRunAction(run, { type: 'save-file', path: second, text: "using './main.bicep'\nparam label = 'changed'" }, lab).run
    expect(bicepCommandSource(edited, first)).toEqual(before)
    expect(bicepCommandSource(edited, second).parameterHash).not.toBe(bicepCommandSource(run, second).parameterHash)
    const sourceEdit = applyRunAction(edited, { type: 'save-file', path: main, text: files[main] + '\n' }, lab).run
    expect(bicepCommandSource(sourceEdit, first).sourceHash).not.toBe(before.sourceHash)
    const restored = applyRunAction(sourceEdit, { type: 'save-file', path: main, text: files[main] }, lab).run
    expect(bicepCommandSource(restored, first).fileVersions[main]).toBeGreaterThan(before.fileVersions[main])
  })

  it('binds CLI and trusted replay to declared target and selected path', () => {
    const run = make()
    const validated = cli(run, 'validate')
    expect(out(validated).outputs.selected).toBe('secondary')
    expect(validated.run.nextSequence).toBe(run.nextSequence)
    const preview = cli(validated.run, 'what-if')
    expect(out(preview)).toMatchObject({ parameterPath: second, sequence: 1 })
    expect(preview.run.nextSequence).toBe(2)
    const created = cli(preview.run, 'create')
    expect(out(created)).toMatchObject({ parameterPath: second, sequence: 2, status: 'succeeded' })
    expect(created.run.nextSequence).toBe(3)
    expect(migrateBehavioralRun(structuredClone(created.run), lab).runtime.bicep.currentByTarget['second-rg/second-deploy'].latest.parameterPath).toBe(second)
    expect(cli(run, 'create', first).lines[0].kind).toBe('err')
    expect(cli(run, 'create', second, 'first-rg', 'first-deploy').lines[0].kind).toBe('err')
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', resourceGroup: 'second-rg', name: 'second-deploy', parameterPath: first }], lab)).toThrow()
    const forged = structuredClone(created.run.runtime.bicep.attempts[0])
    expect(() => applyCommandEffects(run, [{ type: 'bicep-deployment',
      graph: { target: { name: 'second-rg', id: 'forged', location: 'eastus' }, order: [] },
      options: { name: 'second-deploy', parameterPath: second, sourceHash: forged.sourceHash,
        parameterHash: forged.parameterHash, fileVersions: forged.fileVersions } }], lab)).toThrow()
  })

  it('lists both allowed parameter paths in Lab 15 help only', () => {
    const run = make()
    const help = runLine(run.sandbox, 'az deployment group create --help', { run, lab }).lines[0].text
    expect(help).toContain(first)
    expect(help).toContain(second)
  })

  it('rejects missing and tampered paths or duplicate causal sequences on hydration', () => {
    const created = cli(cli(cli(make(), 'validate').run, 'what-if').run, 'create').run
    for (const mutate of [
      run => { delete run.runtime.bicep.attempts[0].parameterPath },
      run => { run.runtime.bicep.previews[0].parameterPath = first },
      run => { run.runtime.bicep.currentByTarget['second-rg/second-deploy'].latest.parameterPath = first },
      run => { run.runtime.bicep.attempts[0].sequence = run.runtime.bicep.previews[0].sequence },
      run => { run.runtime.bicep.observations[0].parameterPath = first },
    ]) {
      const tampered = structuredClone(created); mutate(tampered)
      expect(() => validateBehavioralRun(tampered, lab)).toThrow()
      expect(() => migrateBehavioralRun(tampered, lab)).toThrow()
    }
  })

  it('records validate/show observations with selected path without consuming sequence', () => {
    const validated = cli(make(), 'validate').run
    expect(validated.runtime.bicep.observations[0].parameterPath).toBe(second)
    expect(validated.nextSequence).toBe(1)
    const created = cli(validated, 'create').run
    const shown = applyRunAction(created, { type: 'command', line: 'az deployment group show --name second-deploy --resource-group second-rg' }, lab).run
    expect(shown.runtime.bicep.observations.at(-1)).toMatchObject({ kind: 'show', parameterPath: second })
    expect(shown.nextSequence).toBe(created.nextSequence)
  })

  it('maps app-show observations to each target deployment tuple', () => {
    const firstCreated = cli(make(), 'create', first, 'first-rg', 'first-deploy').run
    const secondCreated = cli(firstCreated, 'create').run
    const withApps = { ...secondCreated, sandbox: { ...secondCreated.sandbox,
      containerApps: [{ name: 'first-app', resourceGroup: 'first-rg' }, { name: 'second-app', resourceGroup: 'second-rg' }] } }
    for (const [group, app, path] of [['first-rg', 'first-app', first], ['second-rg', 'second-app', second]]) {
      const observed = applyCommandEffects(withApps, [{ type: 'bicep-observation', kind: 'app-show',
        name: app, resourceGroup: group }], lab).run.runtime.bicep.observations.at(-1)
      expect(observed).toMatchObject({ kind: 'app-show', target: group, parameterPath: path })
    }
    expect(() => applyCommandEffects(withApps, [{ type: 'bicep-observation', kind: 'app-show',
      name: 'second-app', resourceGroup: 'second-rg', parameterPath: first }], lab)).toThrow()
    expect(() => applyCommandEffects(withApps, [{ type: 'bicep-observation', kind: 'app-show',
      name: 'other-app', resourceGroup: 'second-rg' }], lab)).toThrow()
  })

  it('allocates a new causal sequence for a successful no-change create', () => {
    const firstCreate = cli(make(), 'create').run
    const secondCreate = cli(firstCreate, 'create').run
    expect(secondCreate.runtime.bicep.attempts.map(record => record.sequence)).toEqual([1, 2])
    expect(secondCreate.nextSequence).toBe(3)
    expect(secondCreate.runtime.bicep.attempts[1].status).toBe('succeeded')
  })

  it('rejects a trusted create effect that omits the selected Lab 15 parameter path', () => {
    const run = make()
    const graph = compileBicepProject(run.project.savedFiles, BICEP_INDEPENDENT_MANIFEST,
      { resourceGroup: { name: 'first-rg', location: 'eastus' }, parameterPath: first }).graph
    const effect = { type: 'bicep-deployment', graph,
      options: { name: 'first-deploy', ...bicepCommandSource(run, first) } }
    expect(() => applyCommandEffects(run, [effect], lab)).toThrow('malformed')
    expect(run.nextSequence).toBe(1)
    expect(run.runtime.bicep.attempts).toEqual([])
    const recorded = applyCommandEffects(run, [{ ...effect,
      options: { ...effect.options, parameterPath: first } }], lab).run
    expect(recorded.runtime.bicep.attempts[0]).toMatchObject({ parameterPath: first, sequence: 1 })
    expect(recorded.nextSequence).toBe(2)
    expect(validateBehavioralRun(recorded, lab)).toBe(recorded)
  })
})

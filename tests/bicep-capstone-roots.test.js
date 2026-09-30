import { describe, expect, it } from 'vitest'
import { parseBicepProject } from '../src/lib/bicep/parser.js'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction, applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'
import { successfulBicepDependency } from '../src/lib/bicep/provenance.js'
import { CAPSTONE_MANIFEST } from '../src/data/templates/containerapps-dotnet/capstone.js'

const bootstrap = 'infra/bootstrap.bicep'
const main = 'infra/main.bicep'
const bootstrapParams = 'infra/bootstrap.bicepparam'
const mainParams = 'infra/main.bicepparam'
const files = {
  [bootstrap]: "param label string\nmodule foundation './modules/foundation.bicep' = {\n  name: 'foundation'\n  params: { label: label }\n}\noutput selected string = foundation.outputs.selected",
  'infra/modules/foundation.bicep': 'param label string\noutput selected string = label',
  [main]: "param label string\nmodule application './modules/application.bicep' = {\n  name: 'application'\n  params: { label: label }\n}\noutput selected string = application.outputs.selected",
  'infra/modules/application.bicep': 'param label string\noutput selected string = label',
  [bootstrapParams]: "using './bootstrap.bicep'\nparam label = 'bootstrap'",
  [mainParams]: "using './main.bicep'\nparam label = 'main'",
}
const targets = [
  { templatePath: bootstrap, parameterPath: bootstrapParams, resourceGroup: 'cap-rg', deploymentName: 'bootstrap' },
  { templatePath: main, parameterPath: mainParams, resourceGroup: 'cap-rg', deploymentName: 'main', appName: 'cap-app' },
]
const lab = { id: 'aca-capstone-root-test', engineVersion: 2, contentVersion: 1,
  manifestId: CAPSTONE_MANIFEST.id, capabilities: { bicepDeployment: true }, bicepTargets: targets,
  tasks: [], initialProjectFiles: files,
  seed: sandbox => ({ ...sandbox, resourceGroups: [{ name: 'cap-rg', location: 'eastus' }] }) }
const make = () => createBehavioralRun(lab, { attemptId: 'roots' })
const command = (run, verb, target) => applyRunAction(run, { type: 'command',
  line: `az deployment group ${verb} --name ${target.deploymentName} --resource-group cap-rg --template-file ${target.templatePath} --parameters ${target.parameterPath}` }, lab)
const output = result => JSON.parse(result.lines.find(line => line.kind === 'out').text)

describe('Capstone trusted Bicep roots', () => {
  it('compiles only the selected root and its local module closure', () => {
    const saved = { ...files, [main]: 'broken!!', 'infra/modules/application.bicep': 'broken!!' }
    expect(parseBicepProject(saved, CAPSTONE_MANIFEST, bootstrapParams).diagnostics).toEqual([])
    expect(compileBicepProject(saved, CAPSTONE_MANIFEST, { resourceGroup: { name: 'cap-rg', location: 'eastus' }, parameterPath: bootstrapParams }).graph.outputs.selected).toBe('bootstrap')
    expect(parseBicepProject(saved, CAPSTONE_MANIFEST, mainParams).diagnostics.length).toBeGreaterThan(0)
    for (const text of ["using './main.bicep'", "using '../bootstrap.bicep'", "using 'https://example.com/bootstrap.bicep'"])
      expect(parseBicepProject({ ...files, [bootstrapParams]: text }, CAPSTONE_MANIFEST, bootstrapParams).diagnostics.length).toBeGreaterThan(0)
    for (const reference of ['../main.bicep', 'https://example.com/foundation.bicep', './modules/unlisted.bicep']) {
      const changed = { ...files, [bootstrap]: files[bootstrap].replace('./modules/foundation.bicep', reference) }
      expect(parseBicepProject(changed, CAPSTONE_MANIFEST, bootstrapParams).diagnostics).not.toEqual([])
    }
    const crossRoot = { ...files, [bootstrap]: files[bootstrap].replace('./modules/foundation.bicep', './main.bicep') }
    expect(parseBicepProject(crossRoot, CAPSTONE_MANIFEST, bootstrapParams).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_BICEP', path: bootstrap }))
    const missingMap = { ...CAPSTONE_MANIFEST,
      bicepRoots: { [bootstrapParams]: bootstrap } }
    expect(parseBicepProject(files, missingMap, mainParams).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'BICEP_PARAMETER_PATH', path: mainParams }))
  })

  it('hashes selected closure and excludes edits to the other root', () => {
    const run = make()
    const before = bicepCommandSource(run, bootstrapParams)
    const other = structuredClone(run)
    other.project.savedFiles[main] = 'broken!!'
    other.project.fileVersions[main] = 3
    expect(bicepCommandSource(other, bootstrapParams)).toEqual(before)
    expect(Object.keys(before.fileVersions).sort()).toEqual([bootstrap, bootstrapParams, 'infra/modules/foundation.bicep'].sort())
    other.project.savedFiles['infra/modules/foundation.bicep'] += '\n'
    expect(bicepCommandSource(other, bootstrapParams).sourceHash).not.toBe(before.sourceHash)
  })

  it('binds CLI validation, preview, apply and observation to the declared root', () => {
    const run = make()
    const validated = command(run, 'validate', targets[0])
    expect(output(validated).outputs.selected).toBe('bootstrap')
    expect(validated.run.runtime.bicep.observations[0]).toMatchObject({ templatePath: bootstrap, parameterPath: bootstrapParams })
    const preview = command(validated.run, 'what-if', targets[0])
    expect(output(preview)).toMatchObject({ templatePath: bootstrap, parameterPath: bootstrapParams, sequence: 1 })
    const created = command(preview.run, 'create', targets[0])
    expect(output(created)).toMatchObject({ status: 'succeeded', templatePath: bootstrap, parameterPath: bootstrapParams, sequence: 2 })
    expect(migrateBehavioralRun(structuredClone(created.run), lab).runtime.bicep.currentByTarget['cap-rg/bootstrap'].latest.templatePath).toBe(bootstrap)
    expect(successfulBicepDependency(created.run.runtime.bicep, targets[0])).toMatchObject({
      attemptId: 'bicep-attempt-1', target: 'cap-rg', name: 'bootstrap', templatePath: bootstrap,
      parameterPath: bootstrapParams, outputs: { selected: 'bootstrap' },
    })
    expect(successfulBicepDependency(created.run.runtime.bicep, targets[1])).toBeNull()
    const shown = applyRunAction(created.run, { type: 'command', line: 'az deployment group show --name bootstrap --resource-group cap-rg' }, lab)
    expect(shown.run.runtime.bicep.observations.at(-1).templatePath).toBe(bootstrap)
    const wrongRoot = command(run, 'create', { ...targets[0], templatePath: main })
    expect(wrongRoot.lines[0].kind).toBe('err')
    const wrongGroup = applyRunAction(run, { type: 'command', line: `az deployment group create --name bootstrap --resource-group other-rg --template-file ${bootstrap} --parameters ${bootstrapParams}` }, lab)
    expect(wrongGroup.lines[0].kind).toBe('err')
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', resourceGroup: 'cap-rg', name: 'bootstrap', parameterPath: bootstrapParams, templatePath: main }], lab)).toThrow()
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', resourceGroup: 'cap-rg', name: 'main', parameterPath: mainParams }], lab)).toThrow()
    const mainCreated = command(created.run, 'create', targets[1])
    expect(output(mainCreated)).toMatchObject({ status: 'succeeded', templatePath: main, parameterPath: mainParams, outputs: { selected: 'main' } })
    expect(mainCreated.run.runtime.bicep.currentByTarget['cap-rg/main'].successful.templatePath).toBe(main)
    expect(created.run.runtime.bicep.currentByTarget['cap-rg/main']).toBeUndefined()
  })

  it('rejects malformed root provenance during hydration before Task evaluation', () => {
    const created = command(command(make(), 'what-if', targets[0]).run, 'create', targets[0]).run
    for (const mutate of [
      run => { delete run.runtime.bicep.attempts[0].templatePath },
      run => { run.runtime.bicep.previews[0].templatePath = main },
      run => { run.runtime.bicep.currentByTarget['cap-rg/bootstrap'].latest.templatePath = main },
      run => { run.runtime.bicep.attempts[0].fileVersions[main] = 4 },
    ]) {
      const forged = structuredClone(created); mutate(forged)
      expect(() => validateBehavioralRun(forged, lab)).toThrow()
      expect(() => migrateBehavioralRun(forged, lab)).toThrow()
    }
  })
})

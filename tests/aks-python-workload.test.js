import { describe, expect, it } from 'vitest'
import { parsePythonProject } from '../src/lib/project/python.js'
import { parsePythonWorkload } from '../src/lib/project/python-workload.js'
import { RESOURCE_MANIFEST, RESOURCE_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { buildImage, projectSourceHash, selectBuildFiles } from '../src/lib/project/build.js'

describe('AKS Python local-work workload compiler', () => {
  it('captures the declared process_batch operation and workload constants', () => {
    const result = parsePythonWorkload(RESOURCE_SOLUTION_FILES, RESOURCE_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.workloadSpec).toMatchObject({ version: 1, route: '/api/work', units: 20, scratchMiB: 96, operation: 'process_batch' })
    expect(result.workloadSpec.helperDigest).toMatch(/^sha256:/)
    const appSpec = parsePythonProject(RESOURCE_SOLUTION_FILES, RESOURCE_MANIFEST).appSpec
    expect(appSpec.workload).toMatchObject({ units: 20, scratchMiB: 96 })
    expect(appSpec.routes).toContainEqual({ method: 'GET', path: '/api/work', response: { kind: 'workload', operation: 'process_batch' } })
  })

  it.each([
    ['literal checksum bypass', files => ({ ...files, 'app.py': files['app.py'].replace('return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)', 'return {"status": 200, "body": {"checksum": 3230, "units": 20}}') })],
    ['wrong unit binding', files => ({ ...files, 'app.py': files['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = 101') })],
    ['wrong scratch binding', files => ({ ...files, 'app.py': files['app.py'].replace('SCRATCH_MIB = 96', 'SCRATCH_MIB = 0') })],
    ['changed fixed workload adapter', files => ({ ...files, 'training_workload.py': `${files['training_workload.py']}\n# edited` })],
  ])('rejects %s', (_name, change) => {
    expect(parsePythonWorkload(change(RESOURCE_SOLUTION_FILES), RESOURCE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: expect.stringMatching(/PYTHON_UNSUPPORTED|SCAFFOLD_MODIFIED/) }))
  })

  it('accepts harmless formatting and renamed workload bindings', () => {
    const files = { ...RESOURCE_SOLUTION_FILES, 'app.py': RESOURCE_SOLUTION_FILES['app.py']
      .replaceAll('WORK_UNITS', 'BATCH_UNITS').replaceAll('SCRATCH_MIB', 'WORKING_SET_MIB') }
    expect(parsePythonWorkload(files, RESOURCE_MANIFEST)).toMatchObject({ diagnostics: [], workloadSpec: { units: 20, scratchMiB: 96 } })
  })

  it('does not confuse function-local names with module workload bindings', () => {
    const files = { ...RESOURCE_SOLUTION_FILES, 'app.py': `${RESOURCE_SOLUTION_FILES['app.py']}\ndef helper(WORK_UNITS):\n    return WORK_UNITS\n` }
    expect(parsePythonWorkload(files, RESOURCE_MANIFEST)).toMatchObject({ diagnostics: [], workloadSpec: { units: 20, scratchMiB: 96 } })
  })

  it.each([
    ['a duplicate work function', files => ({ ...files, 'app.py': `${files['app.py']}\ndef work():\n    return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)\n` })],
    ['a reassigned workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\nWORK_UNITS = 20\n` })],
    ['a decoy process call in an unused function', files => ({ ...files, 'app.py': files['app.py'].replace(
      'return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)', 'return {"status": 200, "body": {}}') + '\ndef decoy():\n    return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)\n' })],
    ['an import only inside a string', files => ({ ...files, 'app.py': files['app.py'].replace('import training_workload', 'DOC = "import training_workload"') })],
    ['an unrelated work call', files => ({ ...files, 'app.py': files['app.py'].replace('training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)', 'other.process_batch(WORK_UNITS, SCRATCH_MIB)') })],
    ['a bare work call', files => ({ ...files, 'app.py': files['app.py'].replace('training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)', 'process_batch(WORK_UNITS, SCRATCH_MIB)') })],
    ['a shadowed workload module', files => ({ ...files, 'app.py': `${files['app.py']}\ntraining_workload = object()\n` })],
    ['a rebound work function name', files => ({ ...files, 'app.py': `${files['app.py']}\nwork = None\n` })],
    ['a rewritten workload operation', files => ({ ...files, 'app.py': `${files['app.py']}\ntraining_workload.process_batch = other\n` })],
    ['a non-assignment workload update', files => ({ ...files, 'app.py': `${files['app.py']}\nWORK_UNITS += 1\n` })],
    ['a conditional workload reassignment', files => ({ ...files, 'app.py': `${files['app.py']}\nif True:\n    SCRATCH_MIB = 96\n` })],
    ['a loop target that shadows a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\nfor WORK_UNITS in (1,):\n    pass\n` })],
    ['a from-import that shadows a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\nfrom other import WORK_UNITS\n` })],
    ['a class that shadows the workload module', files => ({ ...files, 'app.py': `${files['app.py']}\nclass training_workload:\n    pass\n` })],
    ['a delete of a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\ndel WORK_UNITS\n` })],
    ['a chained assignment that overwrites the workload module', files => ({ ...files, 'app.py': files['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = training_workload = 20') })],
    ['a chained assignment with a protected second target', files => ({ ...files, 'app.py': files['app.py'].replace('WORK_UNITS = 20', 'other = WORK_UNITS = 1') })],
    ['a destructuring assignment of workload bindings', files => ({ ...files, 'app.py': files['app.py'].replace('WORK_UNITS = 20\nSCRATCH_MIB = 96', '(WORK_UNITS, SCRATCH_MIB) = (1, 1)') })],
    ['a with target that shadows a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\nwith helper() as WORK_UNITS:\n    pass\n` })],
    ['an except target that shadows a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\ntry:\n    pass\nexcept Exception as WORK_UNITS:\n    pass\n` })],
    ['a walrus assignment of a workload binding', files => ({ ...files, 'app.py': `${files['app.py']}\nif (WORK_UNITS := 1):\n    pass\n` })],
    ['a global workload binding declared inside a function', files => ({ ...files, 'app.py': `${files['app.py']}\ndef helper():\n    global WORK_UNITS\n    if (WORK_UNITS := 1):\n        return WORK_UNITS\nhelper()\n` })],
    ['a global workload module declared inside a function', files => ({ ...files, 'app.py': `${files['app.py']}\ndef helper():\n    global training_workload\n    training_workload = object()\nhelper()\n` })],
  ])('rejects %s even when matching source text is present', (_name, change) => {
    expect(parsePythonWorkload(change(RESOURCE_SOLUTION_FILES), RESOURCE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
  })

  it('reports malformed source and enforces the manifest syntax-node limit', () => {
    const malformed = { ...RESOURCE_SOLUTION_FILES, 'app.py': RESOURCE_SOLUTION_FILES['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = (') }
    expect(parsePythonWorkload(malformed, RESOURCE_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_SYNTAX' }))
    expect(parsePythonWorkload(RESOURCE_SOLUTION_FILES, { ...RESOURCE_MANIFEST, maxTokens: 1 }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TOKEN_LIMIT' }))
  })

  it('captures workload source in builds while excluding saved resource YAML', () => {
    const run = files => ({ nextSequence: 1, project: { manifestId: RESOURCE_MANIFEST.id, savedFiles: files, draftFiles: files },
      artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })
    const built = buildImage(run(RESOURCE_SOLUTION_FILES), { registryId: 'fixture', loginServer: 'aksresources.azurecr.io', image: 'assistant:v1' })
    expect(built.diagnostics).toEqual([])
    const editedSource = { ...RESOURCE_SOLUTION_FILES, 'app.py': `${RESOURCE_SOLUTION_FILES['app.py']}\n# saved source change` }
    expect(projectSourceHash(selectBuildFiles(editedSource, RESOURCE_MANIFEST))).not.toBe(built.artifact.sourceHash)
    const yamlOnly = { ...RESOURCE_SOLUTION_FILES, 'k8s/deployment.yaml': 'not a build input' }
    expect(projectSourceHash(selectBuildFiles(yamlOnly, RESOURCE_MANIFEST))).toBe(built.artifact.sourceHash)
  })
})

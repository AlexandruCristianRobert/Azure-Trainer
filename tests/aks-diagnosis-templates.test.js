import { describe, expect, it } from 'vitest'
import { parser } from '@lezer/python'
import { parsePythonProject } from '../src/lib/project/python.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parsePythonDockerfile } from '../src/lib/project/python-dockerfile.js'
import { buildImage, selectBuildFiles, projectSourceHash } from '../src/lib/project/build.js'
import { parse as parseYaml } from 'yaml'

async function template() {
  const modulePath = '../src/data/templates/aks-python/diagnosis.js'
  const result = await import(/* @vite-ignore */ modulePath).catch(() => null)
  expect(result, 'The complete diagnosis teaching project must exist.').not.toBeNull()
  return result
}

describe('complete diagnosis teaching project', () => {
  it('generates all 14 complete files within inherited limits and compiles both variants', async () => {
    const { DIAGNOSIS_MANIFEST: manifest, DIAGNOSIS_FILES, DIAGNOSIS_SOLUTION_FILES } = await template()
    expect(manifest).toMatchObject({ id: 'aks-python-diagnosis-v1', integrationVersion: 1, healthVersion: 1, releaseVersion: 1, diagnosticsVersion: 1, maxFiles: 16, maxFileBytes: 65536, maxTotalBytes: 262144, maxTokens: 20000 })
    expect(getProjectManifest(manifest.id)).toBe(manifest)
    for (const files of [DIAGNOSIS_FILES, DIAGNOSIS_SOLUTION_FILES]) {
      expect(Object.keys(files).sort()).toEqual([...manifest.files].sort())
      expect(Object.keys(files)).toHaveLength(14)
      expect(Object.values(files).every(text => typeof text === 'string' && text.trim() && Buffer.byteLength(text) <= 65536)).toBe(true)
      expect(Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0)).toBeLessThanOrEqual(262144)
      for (const [path, text] of Object.entries(files)) {
        if (path.endsWith('.py')) {
          let invalid = false
          parser.parse(text).iterate({ enter(node) { if (node.type.isError) invalid = true } })
          expect(invalid, path).toBe(false)
        }
        if (path.endsWith('.yaml')) expect(parseYaml(text).kind).toBeTypeOf('string')
      }
      expect(parsePythonProject(files, manifest)).toMatchObject({ diagnostics: [], appSpec: { version: '2.0', diagnostics: { version: 1 } } })
      expect(parsePythonDockerfile(files.Dockerfile, manifest).diagnostics).toEqual([])
    }
  })

  it('captures exactly seven build files and keeps schema and all six YAML files outside the image hash', async () => {
    const { DIAGNOSIS_MANIFEST: manifest, DIAGNOSIS_SOLUTION_FILES: files } = await template()
    expect(manifest.buildFiles).toEqual(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'training_diagnostics.py', 'retrieval.sql', 'Dockerfile'])
    const result = buildImage({ nextSequence: 1, project: { manifestId: manifest.id, savedFiles: files }, artifacts: {} }, { registryId: 'acr', loginServer: 'acraksdiagnosis.azurecr.io', image: 'assistant:v1' })
    expect(result.diagnostics).toEqual([])
    const captured = result.artifacts.sourceSnapshotsByHash[result.artifact.sourceHash].files
    expect(Object.keys(captured)).toEqual(manifest.buildFiles)
    expect(parsePythonProject(captured, manifest).diagnostics).toEqual([])
    for (const path of ['schema.sql', ...manifest.kubernetesFiles]) expect(projectSourceHash(selectBuildFiles({ ...files, [path]: files[path] + '\n' }, manifest))).toBe(result.artifact.sourceHash)
    expect(projectSourceHash(selectBuildFiles({ ...files, 'app.py': files['app.py'] + '\n' }, manifest))).not.toBe(result.artifact.sourceHash)
    expect(parsePythonDockerfile(files.Dockerfile.replace('training_diagnostics.py ', ''), manifest).diagnostics).toContainEqual(expect.objectContaining({ code: 'MISSING_COPY_SOURCE' }))
  })

  it('supplies readable request context scope and resets its token even on an early return', async () => {
    const { DIAGNOSIS_SOLUTION_FILES: files } = await template()
    const helper = files['training_diagnostics.py']
    expect(helper).toContain('ContextVar(')
    expect(helper).toContain('default=None')
    expect(helper).toContain('return _request_id.get()')
    const server = files['server.py']
    expect(server).toMatch(/token = set_request_id\(/)
    expect(server).toMatch(/try:\n\s+response = app.answer\(request\["question"\]\)\n\s+finally:\n\s+reset_request_id\(token\)/)
    expect(server).not.toContain('request["question"].strip()')
    expect(server).toContain('not isinstance(request, dict) or not isinstance(request.get("question"), str)')
    expect(files['app.py']).toContain('def answer_core(question):')
  })

  it.each(['training_diagnostics.py', 'server.py', 'training_clients.py', 'training_health.py', 'schema.sql'])('rejects immutable %s edits', async path => {
    const { DIAGNOSIS_MANIFEST: manifest, DIAGNOSIS_SOLUTION_FILES: files } = await template()
    expect(parsePythonProject({ ...files, [path]: files[path] + '\n# learner edit\n' }, manifest).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED', path }))
  })

  it('exports the bounded logging parser independently', async () => {
    const { DIAGNOSIS_MANIFEST: manifest, DIAGNOSIS_SOLUTION_FILES: files } = await template()
    const modulePath = '../src/lib/project/python-diagnostics.js'
    const diagnostics = await import(/* @vite-ignore */ modulePath)
    expect(diagnostics.parsePythonDiagnostics(files, manifest)).toMatchObject({ diagnostics: [], diagnosticsSpec: { version: 1, statements: expect.any(Array) } })
  })
})

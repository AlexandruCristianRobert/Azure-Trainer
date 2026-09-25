import { describe, expect, it } from 'vitest'
import { parsePythonIntegration } from '../src/lib/project/python-integration.js'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { buildImage } from '../src/lib/project/build.js'

describe('explicit Python assistant integration compiler', () => {
  it('compiles the teaching solution into an answer data-flow graph', () => {
    const result = parsePythonIntegration(INTEGRATION_SOLUTION_FILES, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration).toMatchObject({ adapter: 'integration-fixture-v1', adapterDigest: expect.any(String), querySpec: expect.any(Object) })
    expect(result.appSpec.integration.graph).toMatchObject({ version: 1, roots: expect.any(Object), bindings: expect.any(Object) })
    expect(result.appSpec.integration.graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'guard', source: expect.any(Object) }), expect.objectContaining({ op: 'invoke', method: 'embed', source: expect.any(Object) }), expect.objectContaining({ op: 'invoke', method: 'execute', source: expect.any(Object) })]))
  })

  it('records a literal vector as a literal rather than an embedding result', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('as_vector(vector)', 'as_vector([1, 0, 0])') }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.some(node => node.op === 'literal' && Array.isArray(node.value) && node.value.length === 3)).toBe(true)
  })

  it('rejects an active call to an unsupported helper with a source location', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('embeddings.embed', 'literal_vector') }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py', line: expect.any(Number) }))
  })

  it('compiles an answer path without an empty-input guard for behavioral assessment', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('    if not question:\n        return {"status": 400, "body": {"error": "A question string is required."}}\n', '') }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.some(node => node.op === 'validate-question')).toBe(false)
  })

  it('does not compile comments, strings, or unused functions into the active graph', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES, 'app.py': `${INTEGRATION_SOLUTION_FILES['app.py']}\n\ndef unused():\n    fake = EmbeddingClient()\n    return fake.embed("comment", "wrong")\n` }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.filter(node => node.op === 'invoke' && node.method === 'embed')).toHaveLength(2)
  })

  it('includes saved retrieval SQL in the immutable image snapshot', () => {
    const run = { nextSequence: 1, project: { manifestId: INTEGRATION_MANIFEST.id, savedFiles: INTEGRATION_SOLUTION_FILES }, artifacts: {} }
    const first = buildImage(run, { registryId: 'acr', loginServer: 'aksintegration.azurecr.io', image: 'assistant:v1' })
    const changed = buildImage({ ...run, project: { ...run.project, savedFiles: { ...INTEGRATION_SOLUTION_FILES, 'retrieval.sql': `${INTEGRATION_SOLUTION_FILES['retrieval.sql']}\n` } } }, { registryId: 'acr', loginServer: 'aksintegration.azurecr.io', image: 'assistant:v1' })
    expect(first.diagnostics).toEqual([])
    expect(first.artifact.sourceHash).not.toBe(changed.artifact.sourceHash)
    expect(first.artifacts.sourceSnapshotsByHash[first.artifact.sourceHash].files['retrieval.sql']).toBe(INTEGRATION_SOLUTION_FILES['retrieval.sql'])
  })
})

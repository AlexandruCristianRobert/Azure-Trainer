import { describe, expect, it } from 'vitest'
import { parsePythonIntegration } from '../src/lib/project/python-integration.js'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { buildImage } from '../src/lib/project/build.js'

describe('explicit Python assistant integration compiler', () => {
  it('compiles the teaching solution into an answer data-flow graph', () => {
    const result = parsePythonIntegration(INTEGRATION_SOLUTION_FILES, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.map(node => node.op)).toEqual(expect.arrayContaining(['validate-question', 'embed', 'query', 'answer', 'response']))
  })

  it('records a literal vector as a literal rather than an embedding result', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('as_vector(vector)', 'as_vector([1, 0, 0])') }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.some(node => node.op === 'literal' && Array.isArray(node.value) && node.value.length === 3)).toBe(true)
  })

  it('does not allow an unused helper to satisfy active answer execution', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('vector = embeddings.embed(question, cfg["embedding_deployment"])', 'vector = [1, 0, 0]') }
    const result = parsePythonIntegration(files, INTEGRATION_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.appSpec.integration.graph.nodes.some(node => node.op === 'embed')).toBe(false)
  })

  it('rejects an answer path without an empty-input guard', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES,
      'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('    if not question:\n        return {"status": 400, "body": {"error": "A question string is required."}}\n', '') }
    expect(parsePythonIntegration(files, INTEGRATION_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
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

import { describe, expect, it } from 'vitest'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { parsePythonDockerfile } from '../src/lib/project/python-dockerfile.js'
import { parseRetrievalSql } from '../src/lib/project/retrieval-sql.js'

describe('assistant integration teaching template', () => {
  it('ships complete immutable helpers and a valid SQL snapshot', () => {
    expect(Object.keys(INTEGRATION_SOLUTION_FILES)).toHaveLength(INTEGRATION_MANIFEST.files.length)
    expect(INTEGRATION_MANIFEST.fixedFiles['training_clients.py']).toContain('class RequestBudget')
    expect(INTEGRATION_MANIFEST.fixedFiles['training_clients.py']).not.toContain('pass\n')
    expect(parseRetrievalSql(INTEGRATION_SOLUTION_FILES['retrieval.sql']).diagnostics).toEqual([])
    expect(parsePythonDockerfile(INTEGRATION_SOLUTION_FILES.Dockerfile, { buildFiles: INTEGRATION_MANIFEST.buildFiles }).diagnostics).toEqual([])
  })
})

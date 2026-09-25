import { describe, expect, it } from 'vitest'
import { parsePythonHealth } from '../src/lib/project/python-health.js'
import { HEALTH_MANIFEST, HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'

describe('AKS Python health compiler', () => {
  it('projects the fixed startup, readiness and responsive liveness functions', () => {
    const result = parsePythonHealth(HEALTH_SOLUTION_FILES, HEALTH_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.healthSpec.endpoints).toEqual([
      { path: '/health/startup', statusExpression: { kind: 'conditional', condition: { kind: 'signal', name: 'initialized' }, then: 200, else: 503 }, body: { check: 'startup' } },
      { path: '/health/ready', statusExpression: { kind: 'conditional', condition: { kind: 'and', operands: [{ kind: 'signal', name: 'initialized' }, { kind: 'signal', name: 'accepting_requests' }] }, then: 200, else: 503 }, body: { check: 'readiness' } },
      { path: '/health/live', statusExpression: { kind: 'constant', value: 200 }, body: { check: 'liveness' } },
    ])
    expect(result.healthSpec.helperDigest).toMatch(/^sha256:/)
  })

  it('keeps a supported AI-dependent liveness rule for runtime behavioral assessment', () => {
    const files = { ...HEALTH_SOLUTION_FILES, 'app.py': HEALTH_SOLUTION_FILES['app.py'].replace(
      'return {"status": 200, "body": {"check": "liveness"}}',
      'return {"status": 200 if ai_available() else 503, "body": {"check": "liveness"}}') }
    const result = parsePythonHealth(files, HEALTH_MANIFEST)
    expect(result.diagnostics).toEqual([])
    expect(result.healthSpec.endpoints.find(endpoint => endpoint.path === '/health/live').statusExpression).toEqual({
      kind: 'conditional', condition: { kind: 'signal', name: 'ai_available' }, then: 200, else: 503,
    })
  })

  it('rejects health functions that call undeclared helper names', () => {
    const files = { ...HEALTH_SOLUTION_FILES, 'app.py': HEALTH_SOLUTION_FILES['app.py'].replace('initialized()', 'custom_signal()') }
    expect(parsePythonHealth(files, HEALTH_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' }))
  })

  it('rejects constant health responses outside the bounded HTTP status range', () => {
    const files = { ...HEALTH_SOLUTION_FILES, 'app.py': HEALTH_SOLUTION_FILES['app.py'].replace(
      '200 if initialized() else 503', '0') }
    expect(parsePythonHealth(files, HEALTH_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' }))
  })
})

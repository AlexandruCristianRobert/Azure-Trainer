import { describe, expect, it } from 'vitest'
import { parsePythonProject } from '../src/lib/project/python.js'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../src/data/templates/aks-python/foundation.js'

describe('bounded Python project projection', () => {
  it('projects the actual return expression, including an environment lookup', () => {
    const parsed = parsePythonProject(FOUNDATION_FILES, FOUNDATION_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.routes[0].response.environment).toEqual({
      kind: 'config', key: 'APP_ENV', defaultValue: 'development',
    })
    const changed = { ...FOUNDATION_FILES, 'app.py': FOUNDATION_FILES['app.py']
      .replace('os.environ.get("APP_ENV", "development")', '"training"') }
    expect(parsePythonProject(changed, FOUNDATION_MANIFEST).appSpec.routes[0]
      .response.environment).toEqual({ kind: 'literal', value: 'training' })
  })

  it('accepts comments and equivalent quotes and whitespace', () => {
    const changed = { ...FOUNDATION_FILES, 'app.py': `# return {"service": "fake"}\nimport os\nSERVICE_NAME='changed'\nSERVICE_VERSION = "2.0"\nPORT= 9090\ndef info ( ) :\n  return { 'service' : SERVICE_NAME , 'version': SERVICE_VERSION, 'environment' : os.environ.get('APP_ENV','training') }\n` }
    expect(parsePythonProject(changed, FOUNDATION_MANIFEST)).toMatchObject({ diagnostics: [], appSpec: {
      language: 'python', service: 'changed', version: '2.0', listeningPort: 9090,
      routes: [{ method: 'GET', path: '/api/info', response: { environment: { kind: 'config', key: 'APP_ENV', defaultValue: 'training' } } }],
    } })
  })

  it('ignores fake return text in comments and rejects function-local constant leakage', () => {
    const commented = { ...FOUNDATION_FILES, 'app.py': FOUNDATION_FILES['app.py'].replace('    return {', '    # return {\"service\": \"fake\"}\n    return {') }
    expect(parsePythonProject(commented, FOUNDATION_MANIFEST).diagnostics).toEqual([])
    const local = { ...FOUNDATION_FILES, 'app.py': FOUNDATION_FILES['app.py'].replace('    return {', '    SERVICE_NAME = \"local\"\n    return {') }
    expect(parsePythonProject(local, FOUNDATION_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
  })

  it('rejects unsupported calls, syntax errors, and ambiguous info definitions', () => {
    const unsupported = { ...FOUNDATION_FILES, 'app.py': FOUNDATION_FILES['app.py'].replace('SERVICE_NAME,', 'str(SERVICE_NAME),') }
    expect(parsePythonProject(unsupported, FOUNDATION_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' }))
    const syntax = { ...FOUNDATION_FILES, 'app.py': 'def info(:\n  return {}\n' }
    expect(parsePythonProject(syntax, FOUNDATION_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_SYNTAX', path: 'app.py' }))
    const duplicate = { ...FOUNDATION_FILES, 'app.py': `${FOUNDATION_FILES['app.py']}\ndef info():\n    return {}\n` }
    expect(parsePythonProject(duplicate, FOUNDATION_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py' }))
  })
})

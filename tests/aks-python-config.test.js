import { describe, expect, it } from 'vitest'
import { CONFIG_FILES, CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../src/data/templates/aks-python/configuration.js'
import { parsePythonProject } from '../src/lib/project/python.js'

describe('AKS Python configuration projection', () => {
  it('accepts a bounded alternate listener port for a rebuilt assistant image', () => {
    const files = { ...CONFIG_SOLUTION_FILES, 'app.py': CONFIG_SOLUTION_FILES['app.py'].replace('PORT = 8080', 'PORT = 9090') }
    expect(parsePythonProject(files, CONFIG_MANIFEST)).toMatchObject({ diagnostics: [], appSpec: { listeningPort: 9090 } })
  })

  it('projects environment and mounted JSON settings into the assistant AppSpec', () => {
    const parsed = parsePythonProject(CONFIG_FILES, CONFIG_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.routes[1].response.settings.display_name).toEqual({ kind: 'file-json', path: '/etc/assistant/settings.json', key: 'display_name' })
    expect(parsed.appSpec.routes[1].response.settings.pg_host).toEqual({ kind: 'config', key: 'POSTGRES_HOST', defaultValue: '' })
    expect(parsed.appSpec.routes[0].response.environment).toEqual({
      kind: 'config', key: 'APP_ENV', defaultValue: 'development',
    })
    expect(parsed.appSpec.assistant).toEqual({ adapter: 'knowledge-fixture-v1', settingsFunction: 'settings', helperValid: true })
  })

  it('preserves a wrong but supported environment key for runtime diagnosis', () => {
    expect(parsePythonProject(CONFIG_FILES, CONFIG_MANIFEST).appSpec.routes[1].response.settings.pg_host.key).toBe('POSTGRES_HOST')
    expect(parsePythonProject(CONFIG_SOLUTION_FILES, CONFIG_MANIFEST).appSpec.routes[1].response.settings.pg_host.key).toBe('PGHOST')
  })

  it('provides a corrected solution source and training configuration', () => {
    expect(parsePythonProject(CONFIG_SOLUTION_FILES, CONFIG_MANIFEST).diagnostics).toEqual([])
    expect(CONFIG_SOLUTION_FILES['app.py']).toContain('"PGHOST"')
    expect(CONFIG_SOLUTION_FILES['k8s/configmap.yaml']).toContain('APP_ENV: training')
  })

  it('does not project settings expressions found only in comments', () => {
    const forged = { ...CONFIG_SOLUTION_FILES, 'app.py': CONFIG_SOLUTION_FILES['app.py']
      .replace('        "pg_host": os.environ.get("PGHOST", ""),', '        # "pg_host": os.environ.get("PGHOST", "")\n        "pg_host": "",') }
    expect(parsePythonProject(forged, CONFIG_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
  })

  it('rejects non-text service identity constants', () => {
    const invalid = { ...CONFIG_SOLUTION_FILES, 'app.py': CONFIG_SOLUTION_FILES['app.py']
      .replace('SERVICE_NAME = "knowledge-assistant"', 'SERVICE_NAME = 123') }
    expect(parsePythonProject(invalid, CONFIG_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
  })
})

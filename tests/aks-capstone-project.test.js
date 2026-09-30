import { describe, expect, it } from 'vitest'
import { CAPSTONE_MANIFEST, CAPSTONE_FILES, CAPSTONE_SOLUTION_FILES } from '../src/data/templates/aks-python/capstone.js'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { verifyCapstoneSource } from '../src/lib/kubernetes/capstone/scenarios.js'

describe('AKS capstone teaching project', () => {
  it('declares exactly 16 files and retains each fixed adapter in every complete solution', () => {
    expect(CAPSTONE_MANIFEST.id).toBe('aks-python-capstone-v1')
    expect(getProjectManifest(CAPSTONE_MANIFEST.id)).toBe(CAPSTONE_MANIFEST)
    expect(CAPSTONE_MANIFEST.files).toHaveLength(16)
    expect(new Set(CAPSTONE_MANIFEST.files).size).toBe(16)
    expect(CAPSTONE_MANIFEST.buildFiles).not.toContain('k8s/deployment.yaml')
    for (const files of [CAPSTONE_FILES, ...Object.values(CAPSTONE_SOLUTION_FILES)]) {
      expect(Object.keys(files).sort()).toEqual([...CAPSTONE_MANIFEST.files].sort())
      for (const [path, source] of Object.entries(CAPSTONE_MANIFEST.fixedFiles)) expect(files[path]).toBe(source)
    }
    expect(CAPSTONE_FILES['k8s/hpa.yaml'].trim()).toMatch(/^#/)
    expect(CAPSTONE_SOLUTION_FILES.final['k8s/hpa.yaml'].trim()).toMatch(/^#/)
    expect(CAPSTONE_SOLUTION_FILES.scale['k8s/hpa.yaml']).toContain('kind: HorizontalPodAutoscaler')
  })

  it('compiles the complete solution with integration, health, logging and workload projections', () => {
    for (const variant of ['v1', 'v2', 'scale', 'final']) {
      const parsed = parsePythonProject(CAPSTONE_SOLUTION_FILES[variant], CAPSTONE_MANIFEST)
      expect(parsed.diagnostics).toEqual([])
      expect(parsed.appSpec).toMatchObject({ integration: { graph: { version: 1 } }, health: { version: 1 }, diagnostics: { version: 1 }, workload: { units: 20, scratchMiB: 96 } })
    }
  })

  it('verifies source behavior in an isolated preview, including routes and request outcomes', () => {
    const result = verifyCapstoneSource(CAPSTONE_SOLUTION_FILES.v1, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
    expect(result.passed).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.measurements).toMatchObject({ kind: 'source-preview', artifactId: null, deploymentId: null })
    expect(result.measurements.cases.backups).toMatchObject({ status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'] } })
    expect(result.measurements.cases.invalid).toMatchObject({ status: 400, dependencyTrace: [] })
    expect(result.measurements.cases.noMatch).toMatchObject({ status: 200, body: { sources: [] } })
    expect(result.measurements.cases.retryFailure).toMatchObject({ status: 503 })
    expect(result.measurements.health.readyBefore.status).toBe(503)
    expect(result.measurements.health.readyBeforeClosed.status).toBe(503)
    expect(result.measurements.health.readyClosed.status).toBe(503)
    expect(result.measurements.workload).toMatchObject({ operation: 'process_batch', units: 20, checksum: 3230 })
  })

  it('accepts reordered log fields while still requiring the expected records in order', () => {
    const app = CAPSTONE_SOLUTION_FILES.v1['app.py']
    const reordered = app.replace(
      '{"event": event, "request_id": current_request_id(), "status": status}',
      '{"request_id": current_request_id(), "event": event, "status": status}')
    expect(reordered).not.toBe(app)
    expect(verifyCapstoneSource({ ...CAPSTONE_SOLUTION_FILES.v1, 'app.py': reordered }, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).passed).toBe(true)

    for (const invalidApp of [
      reordered.replace('"request_id": current_request_id()', '"request_id": "wrong"'),
      reordered.replace('log_event("request.started")', 'log_event("request.completed")'),
    ]) {
      const result = verifyCapstoneSource({ ...CAPSTONE_SOLUTION_FILES.v1, 'app.py': invalidApp }, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
      expect(result.passed).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CAPSTONE_LOGS' }))
    }
  })

  it('requires a changed v2 answer release and rejects malformed or unsupported source', () => {
    expect(verifyCapstoneSource(CAPSTONE_SOLUTION_FILES.v2, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).measurements.cases.backups.body.release).toBe('2.0')
    for (const app of [CAPSTONE_SOLUTION_FILES.v1['app.py'] + '\nif (\n', CAPSTONE_SOLUTION_FILES.v1['app.py'] + '\nimport subprocess\n']) {
      const result = verifyCapstoneSource({ ...CAPSTONE_SOLUTION_FILES.v1, 'app.py': app }, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
      expect(result.passed).toBe(false)
      expect(result.diagnostics.length).toBeGreaterThan(0)
    }
  })

  it('rejects SQL with missing published provenance and altered fixed server', () => {
    const badSql = { ...CAPSTONE_SOLUTION_FILES.v1, 'retrieval.sql': CAPSTONE_FILES['retrieval.sql'] }
    expect(verifyCapstoneSource(badSql, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).passed).toBe(false)
    const badServer = { ...CAPSTONE_SOLUTION_FILES.v1, 'server.py': 'print("altered")' }
    expect(verifyCapstoneSource(badServer, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED', path: 'server.py' }))
  })

  it('requires readiness to stay closed until initialization even when admission is open', () => {
    const files = { ...CAPSTONE_SOLUTION_FILES.v1,
      'app.py': CAPSTONE_SOLUTION_FILES.v1['app.py'].replace('initialized() and accepting_requests()', 'accepting_requests()') }
    const result = verifyCapstoneSource(files, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
    expect(result.passed).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CAPSTONE_HEALTH' }))
  })

  it('requires readiness to stay closed before initialization when admission is also closed', () => {
    const files = { ...CAPSTONE_SOLUTION_FILES.v1,
      'app.py': CAPSTONE_SOLUTION_FILES.v1['app.py'].replace(
        'initialized() and accepting_requests()',
        '(initialized() and accepting_requests()) or not (initialized() or accepting_requests())') }
    const result = verifyCapstoneSource(files, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
    expect(result.passed).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CAPSTONE_HEALTH' }))
  })

  it('rejects remote dependency coupling in readiness for both complete solutions', () => {
    const localReadiness = 'initialized() and accepting_requests()'
    const expectedHealth = {
      startupBefore: 503, startupAfter: 200, readyBefore: 503, readyBeforeClosed: 503,
      readyOpen: 200, readyClosed: 503, liveBefore: 200, liveAfter: 200,
    }
    const coupledReadiness = [
      `${localReadiness} and postgres_available()`,
      `${localReadiness} and ai_available()`,
      `${localReadiness} and (postgres_available() or ai_available())`,
    ]
    for (const variant of ['v1', 'v2']) {
      const valid = verifyCapstoneSource(CAPSTONE_SOLUTION_FILES[variant], CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
      expect(valid.passed).toBe(true)
      for (const cases of Object.values(valid.measurements.health.remoteDependencyCases)) {
        expect(Object.fromEntries(Object.keys(expectedHealth).map(name => [name, cases[name].status]))).toEqual(expectedHealth)
      }
      for (const expression of coupledReadiness) {
        const files = { ...CAPSTONE_SOLUTION_FILES[variant],
          'app.py': CAPSTONE_SOLUTION_FILES[variant]['app.py'].replace(localReadiness, expression) }
        expect(files['app.py']).not.toBe(CAPSTONE_SOLUTION_FILES[variant]['app.py'])
        const result = verifyCapstoneSource(files, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES)
        expect(result.passed).toBe(false)
        expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'CAPSTONE_HEALTH' }))
      }
    }
  })
})

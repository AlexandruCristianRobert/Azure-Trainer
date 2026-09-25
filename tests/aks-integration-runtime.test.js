import { describe, expect, it } from 'vitest'
import { parsePythonIntegration } from '../src/lib/project/python-integration.js'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { simulateIntegration } from '../src/lib/kubernetes/integration.js'
import { makeTrainingSnapshot } from './helpers/aks.js'

const appSpec = parsePythonIntegration(INTEGRATION_SOLUTION_FILES, INTEGRATION_MANIFEST).appSpec
const request = question => ({ method: 'POST', path: '/api/ask', body: { question } })
const snapshot = () => ({ ...makeTrainingSnapshot(), environment: { ...makeTrainingSnapshot().environment, AUDIENCE: 'employee' } })

describe('compiled AKS assistant integration runtime', () => {
  it('executes the authored graph and records dependency provenance', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } })
    expect(outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    expect(outcome.integrationTrace).toMatchObject({ profileId: 'healthy', vectorProvenance: 'embedding', selectedIds: ['training-backups'], contextIds: ['training-backups'], sourceProvenance: 'rows', elapsedMs: 120 })
  })

  it('uses one request-local budget across a retry without restarting earlier stages', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'embedding-throttle-once')
    expect(outcome.status).toBe(200)
    expect(outcome.integrationTrace.elapsedMs).toBe(310)
    expect(outcome.dependencyTrace[0].attempts).toHaveLength(2)
    expect(outcome.dependencyTrace[0].attempts[0].delayBeforeNextMs).toBe(150)
    expect(outcome.dependencyTrace.slice(1).map(item => item.operation)).toEqual(['postgres-query', 'answer'])
  })

  it('does not call answer for the authored empty-result guard', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('What is the travel allowance?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 200, body: { answer: 'No matching documents.', sources: [] } })
    expect(outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query'])
  })

  it('keeps a literal vector observable instead of treating it as an embedding result', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES, 'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('as_vector(vector)', 'as_vector([1, 0, 0])') }
    const literalApp = parsePythonIntegration(files, INTEGRATION_MANIFEST).appSpec
    const outcome = simulateIntegration(literalApp, snapshot(), request('Who provides support?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome.status).toBe(200)
    expect(outcome.integrationTrace.vectorProvenance).toBe('literal')
    expect(outcome.integrationTrace.selectedIds).toEqual(['training-backups'])
  })

  it('maps bounded persistent dependency errors through the authored catch path', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'answer-unavailable-always')
    expect(outcome).toMatchObject({ status: 503, body: { code: 'DEPENDENCY_UNAVAILABLE' } })
    expect(outcome.dependencyTrace.at(-1).attempts).toHaveLength(3)
    expect(outcome.integrationTrace.elapsedMs).toBe(520)
  })
})

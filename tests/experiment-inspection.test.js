import { describe, expect, it } from 'vitest'
import { latestRequestForApp, latestEvidenceForApp } from '../src/lib/simulation/inspection.js'

describe('Experiment inspection', () => {
  it('shows the selected app response even when another app was requested later', () => {
    const lines = [
      { kind: 'out', appId: '/apps/one', method: 'GET', path: '/api/info', status: 200, body: { service: 'one' } },
      { kind: 'err', appId: '/apps/two', method: 'GET', path: '/api/info', status: 503, body: { error: 'NO_ACTIVE_DEPLOYMENT' } },
    ]
    expect(latestRequestForApp(lines, '/APPS/ONE')?.status).toBe(200)
    expect(latestRequestForApp(lines, '/apps/two')?.status).toBe(503)
    expect(latestRequestForApp(lines, '/apps/three')).toBeNull()
  })

  it('shows only selected app evidence, including a failed observation', () => {
    const records = {
      first: { id: 'first', sequence: 1, measurements: { appId: '/apps/one', status: 200 } },
      second: { id: 'second', sequence: 2, measurements: { appId: '/apps/two', status: 503 } },
    }
    expect(latestEvidenceForApp(records, '/APPS/ONE')?.id).toBe('first')
    expect(latestEvidenceForApp(records, '/apps/two')?.measurements.status).toBe(503)
    expect(latestEvidenceForApp(records, '/apps/three')).toBeNull()
  })

  it('keeps request evidence visible when a newer CPU scenario completes', () => {
    const records = {
      request: { id: 'request', sequence: 1, measurements: { appId: '/apps/one', method: 'GET', path: '/api/info', status: 200 } },
      cpu: { id: 'cpu', sequence: 2, measurements: { appId: '/apps/one', trace: [{ second: 1 }] } },
    }
    const latestRequest = latestEvidenceForApp(records, '/apps/one',
      (record) => record.measurements?.method === 'GET' && record.measurements?.path === '/api/info')
    expect(latestRequest?.id).toBe('request')
  })
})

import { describe, expect, it } from 'vitest'
import { act, advanceHealth, seedHealthTest } from './helpers/aks.js'
import { HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'

function complete(scenarioId) {
  const seeded = seedHealthTest({ startupSeconds: 0 })
  const started = act(seeded.run, seeded.lab, { type: 'aks-probe-start', scenarioId }).run
  const seconds = seeded.lab.scenarios[scenarioId].durationSeconds
  const finished = advanceHealth(started, seeded.lab, seconds)
  return { ...seeded, finished, receipt: finished.runtime.kubernetes.clusters[seeded.clusterId].health.receipts.at(-1) }
}

describe('AKS probe experiments sample actual routed application behavior', () => {
  it('routes the readiness-window request away from the closed Pod and recovers the assistant answer', () => {
    const { receipt } = complete('temporaryAdmissionClosure')
    const closedUid = receipt.podUids[0]
    const withdrawn = receipt.samples.find(item => item.second === 9)
    expect(withdrawn).toMatchObject({ request: { method: 'GET', path: '/api/info' },
      response: { transport: { ok: true }, status: 200 } })
    expect(withdrawn.response.route.podUid).not.toBe(closedUid)
    const recovered = receipt.samples.find(item => item.second === 25)
    expect(recovered).toMatchObject({ request: { method: 'POST', path: '/api/ask' },
      response: { transport: { ok: true }, status: 200,
        body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'] } } })
    expect(recovered.response.integrationTrace).toBeTruthy()
    expect(receipt.outcome).toBe('passed')
  })

  it('records a bounded failure during optional AI outage while preserving info and recovery', () => {
    const { receipt } = complete('optionalAiOutage')
    const info = receipt.samples.find(item => item.second === 10)
    const unavailable = receipt.samples.find(item => item.second === 12)
    const restored = receipt.samples.find(item => item.second === 40)
    expect(info).toMatchObject({ request: { method: 'GET', path: '/api/info' }, response: { status: 200 } })
    expect(unavailable).toMatchObject({ request: { method: 'POST', path: '/api/ask' }, response: { status: 503 } })
    expect(restored).toMatchObject({ request: { method: 'POST', path: '/api/ask' },
      response: { status: 200, body: { sources: ['training-backups'] } } })
    expect(receipt.outcome).toBe('passed')
    expect(receipt.samples).toHaveLength(3)
  })

  it('withdraws all endpoints for a required database outage and answers after recovery', () => {
    const files = { ...HEALTH_SOLUTION_FILES,
      'app.py': HEALTH_SOLUTION_FILES['app.py'].replace('initialized() and accepting_requests()',
        'initialized() and accepting_requests() and postgres_available()') }
    const seeded = seedHealthTest({ startupSeconds: 0, files })
    const started = act(seeded.run, seeded.lab, { type: 'aks-probe-start', scenarioId: 'requiredPostgresOutage' }).run
    const finished = advanceHealth(started, seeded.lab, 35)
    const receipt = finished.runtime.kubernetes.clusters[seeded.clusterId].health.receipts.at(-1)
    const blocked = receipt.samples.find(item => item.second === 10)
    const recovered = receipt.samples.find(item => item.second === 30)
    expect(blocked).toMatchObject({ readyBackendCount: 0,
      response: { transport: { ok: false, reason: 'NO_READY_ENDPOINTS' }, status: null } })
    expect(recovered).toMatchObject({ response: { transport: { ok: true }, status: 200,
      body: { sources: ['training-backups'] } } })
    expect(receipt.outcome).toBe('passed')
  })

  it('records a final assistant answer after the hung container recovers in the same Pod', () => {
    const { receipt } = complete('processHang')
    const final = receipt.samples.find(item => item.second === 100 && item.request?.method === 'POST')
    expect(final).toMatchObject({ response: { transport: { ok: true }, status: 200,
      body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'] } } })
    expect(receipt.summary.restartReceipts.some(item => item.cause === 'probe'
      && receipt.podUids.includes(item.podUid) && item.oldContainerId !== item.newContainerId)).toBe(true)
    expect(receipt.outcome).toBe('passed')
  })
})

import { expect } from 'vitest'
import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { releaseTestRun, RELEASE_TEST_LAB, RELEASE_TARGET } from './aks.js'
export const target = { ...RELEASE_TARGET, serviceName: 'assistant-public' }
export const lab = { ...RELEASE_TEST_LAB, scenarios: {
  'release-v2': { kind: 'aks-release', version: 1, target, expectedRelease: '2.0', requiredAvailable: 2, zeroFailedRequests: true, requireIncident: false, requireDeadline: false, incidentEpoch: 1 },
  'recover-v2': { kind: 'aks-release', version: 1, target, expectedRelease: '2.0', requiredAvailable: 2, zeroFailedRequests: false, requireIncident: true, requireDeadline: true, incidentEpoch: 2 },
  'final-v2': { kind: 'aks-release-final', version: 1, target, expectedRelease: '2.0' },
} }
export const state = run => run.runtime.kubernetes.clusters[target.clusterId]
export const action = (run, value) => { const result = applyRunAction(run, value, lab); expect(result.diagnostics).toEqual([]); return result.run }
export const start = (run = releaseTestRun(), scenarioId = 'release-v2') => action(run, { type: 'aks-release-start', scenarioId })

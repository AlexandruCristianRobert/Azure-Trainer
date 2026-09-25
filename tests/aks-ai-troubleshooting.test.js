import { describe, expect, it } from 'vitest'
import { aksAiTroubleshootingLab } from '../src/data/labs/aks-journey/ai-troubleshooting.lab.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'

describe('AKS AI troubleshooting Lab', () => {
  it('registers after the guided assistant Lab', () => {
    expect(labById('aks-ai-troubleshooting')).toBe(aksAiTroubleshootingLab)
    expect(nextLabFor(labById('aks-ai-guided'))).toBe(aksAiTroubleshootingLab)
  })

  it('cannot skip the embedding-deployment observation by advancing the incident', () => {
    const run = createBehavioralRun(aksAiTroubleshootingLab, { attemptId: 'ai-incident' })
    const result = applyRunAction(run, { type: 'aks-integration-next-incident' }, aksAiTroubleshootingLab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('completes the authored incident repairs and bounded retry verification', () => {
    let run = createBehavioralRun(aksAiTroubleshootingLab, { attemptId: 'ai-solutions' })
    for (const task of aksAiTroubleshootingLab.tasks) run = executeAksSolution(run, aksAiTroubleshootingLab, task)
    const evaluation = evaluateLab(aksAiTroubleshootingLab, run)
    expect(evaluation.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksAiTroubleshootingLab).runtime.kubernetes.integrationIncident.phase).toBe('retry')
  })

  it('rejects caller-selected incident state without mutating the run', () => {
    const run = createBehavioralRun(aksAiTroubleshootingLab, { attemptId: 'ai-forged-incident' })
    const result = applyRunAction(run, { type: 'aks-integration-next-incident', integrationProfile: 'healthy' }, aksAiTroubleshootingLab)
    expect(result.diagnostics[0].code).toBe('INVALID_AKS_ACTION')
    expect(result.run).toBe(run)
  })
})

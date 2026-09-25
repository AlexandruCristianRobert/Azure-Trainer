import { describe, expect, it } from 'vitest'
import { aksAiGuidedLab } from '../src/data/labs/aks-journey/ai-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

const taskDone = (run, id) => evaluateLab(aksAiGuidedLab, run).tasks.find(task => task.id === id).done

describe('guided AKS AI integration Lab', () => {
  it('completes using the authored Solutions from a standalone run', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai' })
    for (const task of aksAiGuidedLab.tasks) run = executeAksSolution(run, aksAiGuidedLab, task)
    expect(evaluateLab(aksAiGuidedLab, run).isComplete).toBe(true)
  })

  it('requires context and sources to come from retrieved rows', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-bypass' })
    for (const task of aksAiGuidedLab.tasks.slice(0, 4)) run = executeAksSolution(run, aksAiGuidedLab, task)
    const forged = aksAiGuidedLab.solutionFiles['app.py']
      .replace('context = [{"id": row["id"], "content": row["content"]} for row in rows]', 'context = []')
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: forged }, aksAiGuidedLab).run
    expect(taskDone(run, 'construct-context')).toBe(false)
  })

  it('does not accept a query edit until its image is rebuilt and deployed', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-stale' })
    for (const task of aksAiGuidedLab.tasks.slice(0, 5)) run = executeAksSolution(run, aksAiGuidedLab, task)
    run = applyRunAction(run, { type: 'save-file', path: 'retrieval.sql', text: aksAiGuidedLab.solutionFiles['retrieval.sql'].replace('LIMIT %(limit)s', 'LIMIT 2') }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'guided-ai-backups' }, aksAiGuidedLab).run
    expect(taskDone(run, 'answer-backups')).toBe(false)
  })
})

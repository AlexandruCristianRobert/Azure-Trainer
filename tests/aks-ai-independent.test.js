import { describe, expect, it } from 'vitest'
import { aksAiIndependentLab } from '../src/data/labs/aks-journey/ai-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { act, executeAksSolution } from './helpers/aks.js'

const solve = (run, ids = aksAiIndependentLab.tasks.map(task => task.id)) => ids.reduce((value, id) => executeAksSolution(value, aksAiIndependentLab, aksAiIndependentLab.tasks.find(task => task.id === id)), run)

describe('AKS independent partner retrieval lab', () => {
  it('completes all nine tasks from its standalone optional Solutions', () => {
    const run = solve(createBehavioralRun(aksAiIndependentLab, { attemptId: 'partner-solutions' }))
    expect(evaluateLab(aksAiIndependentLab, run).isComplete).toBe(true)
  })

  it('requires partner retrieval rather than a successful training-corpus answer', () => {
    let run = createBehavioralRun(aksAiIndependentLab, { attemptId: 'partner-corpus' })
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'independent-ai-backups' }, aksAiIndependentLab).run
    expect(evaluateLab(aksAiIndependentLab, run).isComplete).toBe(false)
  })

  it('rejects a literal collection/audience binding even when the review ConfigMap is correct', () => {
    let run = solve(createBehavioralRun(aksAiIndependentLab, { attemptId: 'literal-binding' }), ['partner-bindings'])
    const forged = aksAiIndependentLab.solutionFiles['app.py'].replace('"collection": cfg["collection"]', '"collection": "review"')
    run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'app.py', text: forged }).run
    expect(evaluateLab(aksAiIndependentLab, run).tasks.find(task => task.id === 'partner-bindings').done).toBe(false)
  })

  it('accepts renamed bindings and predicate order when they preserve retrieval provenance', () => {
    let run = createBehavioralRun(aksAiIndependentLab, { attemptId: 'renamed-bindings' })
    const app = aksAiIndependentLab.solutionFiles['app.py'].replace('"collection": cfg["collection"]', '"corpus": cfg["collection"]')
      .replace('"audience": cfg["audience"]', '"reader": cfg["audience"]').replace('"published": True', '"is_published": True')
      .replace('"embedding": as_vector(vector)', '"query_vector": as_vector(vector)').replace('"max_distance": 0.2', '"cutoff": 0.2').replace('"limit": 1', '"row_limit": 1')
    const sql = `SELECT id, content\nFROM documents\nWHERE published = %(is_published)s\n  AND audience = %(reader)s\n  AND collection = %(corpus)s\n  AND (embedding <=> %(query_vector)s::vector) <= %(cutoff)s\nORDER BY embedding <=> %(query_vector)s::vector ASC, id ASC\nLIMIT %(row_limit)s;\n`
    run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'app.py', text: app }).run
    run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'retrieval.sql', text: sql }).run
    expect(evaluateLab(aksAiIndependentLab, run).tasks.find(task => task.id === 'partner-query').done).toBe(true)
  })

  it('rejects a hardcoded answer or manually constructed source list', () => {
    let run = createBehavioralRun(aksAiIndependentLab, { attemptId: 'manual-source' })
    const forged = aksAiIndependentLab.solutionFiles['app.py'].replace('"answer": result["answer"], "sources": [row["id"] for row in rows]', '"answer": "Review backups are kept for 7 days.", "sources": ["review-backups"]')
    run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'app.py', text: forged }).run
    expect(evaluateLab(aksAiIndependentLab, run).tasks.find(task => task.id === 'partner-context').done).toBe(false)
  })

  it('does not accept a query that can retrieve the employee or draft decoys', () => {
    for (const removed of ['  AND audience = %(audience)s\n', '  AND published = %(published)s\n']) {
      let run = solve(createBehavioralRun(aksAiIndependentLab, { attemptId: `decoy-${removed.length}` }), ['partner-bindings'])
      run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'app.py', text: aksAiIndependentLab.solutionFiles['app.py'] }).run
      run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'retrieval.sql', text: aksAiIndependentLab.solutionFiles['retrieval.sql'].replace(removed, '') }).run
      expect(evaluateLab(aksAiIndependentLab, run).tasks.find(task => task.id === 'partner-query').done).toBe(false)
    }
  })

  it('requires a rebuilt and applied partner image before accepting request evidence', () => {
    let run = solve(createBehavioralRun(aksAiIndependentLab, { attemptId: 'stale-partner' }), ['partner-bindings', 'partner-query', 'partner-context', 'deploy-partner'])
    run = act(run, aksAiIndependentLab, { type: 'save-file', path: 'retrieval.sql', text: aksAiIndependentLab.solutionFiles['retrieval.sql'].replace('LIMIT %(limit)s', 'LIMIT 2') }).run
    run = act(run, aksAiIndependentLab, { type: 'aks-request', scenarioId: 'independent-ai-backups' }).run
    expect(evaluateLab(aksAiIndependentLab, run).tasks.find(task => task.id === 'partner-backups').done).toBe(false)
  })
})

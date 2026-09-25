import { describe, expect, it } from 'vitest'
import { aksAiGuidedLab } from '../src/data/labs/aks-journey/ai-guided.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
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

  it('rejects a literal vector even when the embedding call remains present', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-literal-vector' })
    run = executeAksSolution(run, aksAiGuidedLab, aksAiGuidedLab.tasks[0])
    const forged = aksAiGuidedLab.solutionFiles['app.py'].replace('"embedding": as_vector(vector)', '"embedding": as_vector([1, 0, 0])')
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: forged }, aksAiGuidedLab).run
    expect(taskDone(run, 'embed-question')).toBe(false)
  })

  it('accepts renamed SQL bindings and reordered predicates when their graph preserves retrieval semantics', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-renamed-bindings' })
    const app = aksAiGuidedLab.solutionFiles['app.py']
      .replace('"collection": cfg["collection"]', '"corpus": cfg["collection"]')
      .replace('"audience": cfg["audience"]', '"reader": cfg["audience"]')
      .replace('"published": True', '"is_published": True')
      .replace('"embedding": as_vector(vector)', '"query_vector": as_vector(vector)')
      .replace('"max_distance": 0.2', '"cutoff": 0.2')
      .replace('"limit": 1', '"row_limit": 1')
    const sql = `SELECT id, content\nFROM documents\nWHERE published = %(is_published)s\n  AND audience = %(reader)s\n  AND collection = %(corpus)s\n  AND (embedding <=> %(query_vector)s::vector) <= %(cutoff)s\nORDER BY embedding <=> %(query_vector)s::vector ASC, id ASC\nLIMIT %(row_limit)s;\n`
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: app }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'save-file', path: 'retrieval.sql', text: sql }, aksAiGuidedLab).run
    expect(taskDone(run, 'retrieve-documents')).toBe(true)
  })

  it('accepts a renamed retrieval local when context and sources retain its graph provenance', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-renamed-local' })
    const app = aksAiGuidedLab.solutionFiles['app.py'].replaceAll('rows', 'retrieved')
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: app }, aksAiGuidedLab).run
    expect(taskDone(run, 'construct-context')).toBe(true)
  })

  it('rejects descending vector ranking even when filters and bindings are present', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-descending-rank' })
    const sql = aksAiGuidedLab.solutionFiles['retrieval.sql'].replace('::vector ASC, id ASC', '::vector DESC, id DESC')
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: aksAiGuidedLab.solutionFiles['app.py'] }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'save-file', path: 'retrieval.sql', text: sql }, aksAiGuidedLab).run
    expect(taskDone(run, 'retrieve-documents')).toBe(false)
  })

  it('rejects a hardcoded answer or source list despite a generate call', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-hardcoded-return' })
    const forged = aksAiGuidedLab.solutionFiles['app.py']
      .replace('"answer": result["answer"], "sources": [row["id"] for row in rows]', '"answer": "Training backups are kept for 30 days.", "sources": ["training-backups"]')
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

  it('does not accept a newly built image until the Deployment uses it', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-unapplied-image' })
    for (const task of aksAiGuidedLab.tasks.slice(0, 5)) run = executeAksSolution(run, aksAiGuidedLab, task)
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: aksAiGuidedLab.solutionFiles['app.py'].replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "2.1"') }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'az acr build -r acraksaiguided -t assistant:rebuilt .' }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'guided-ai-backups' }, aksAiGuidedLab).run
    expect(taskDone(run, 'answer-backups')).toBe(false)
  })

  it('rejects a deployed query that omits metadata filters and selects a draft decoy', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-decoy' })
    for (const task of aksAiGuidedLab.tasks.slice(0, 4)) run = executeAksSolution(run, aksAiGuidedLab, task)
    const sql = aksAiGuidedLab.solutionFiles['retrieval.sql'].replace('  AND audience = %(audience)s\n  AND published = %(published)s\n', '')
    run = applyRunAction(run, { type: 'save-file', path: 'retrieval.sql', text: sql }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'az acr build -r acraksaiguided -t assistant:decoy .' }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/deployment.yaml', text: aksAiGuidedLab.solutionFiles['k8s/deployment.yaml'].replace('integration-v1', 'decoy') }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksAiGuidedLab).run
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'guided-ai-backups' }, aksAiGuidedLab).run
    expect(run.runtime.kubernetes.requests.at(-1).integrationTrace.selectedIds).toEqual(['00-training-draft'])
    expect(taskDone(run, 'answer-backups')).toBe(false)
  })

  it('records the verification through the declared external Service route', () => {
    let run = createBehavioralRun(aksAiGuidedLab, { attemptId: 'guided-ai-route' })
    for (const task of aksAiGuidedLab.tasks) run = executeAksSolution(run, aksAiGuidedLab, task)
    const request = run.runtime.kubernetes.requests.at(-1)
    const state = run.runtime.kubernetes.clusters[aksAiGuidedLab.scenarios['guided-ai-no-match'].target.clusterId]
    expect(request).toMatchObject({ connectivity: true, route: expect.objectContaining({ namespace: 'assistant', serviceName: 'assistant-public', serviceUid: state.resources['Service/assistant/assistant-public'].metadata.uid }) })
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), aksAiGuidedLab).runtime.kubernetes.requests.at(-1).connectivity).toBe(true)
  })
})

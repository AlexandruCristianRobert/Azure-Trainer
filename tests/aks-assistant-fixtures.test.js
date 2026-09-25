import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_FIXTURES, renderKnowledgeHelper } from '../src/data/fixtures/aks/knowledge.js'
import { CONFIG_MANIFEST, CONFIG_SOLUTION_FILES } from '../src/data/templates/aks-python/configuration.js'
import { simulateAssistant } from '../src/lib/kubernetes/assistant.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { makeTrainingSnapshot } from './helpers/aks.js'

describe('simulated Knowledge Assistant fixtures', () => {
  const appSpec = parsePythonProject(CONFIG_SOLUTION_FILES, CONFIG_MANIFEST).appSpec
  const request = { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }

  it('returns the selected source and records the configured dependency trace', () => {
    const good = simulateAssistant(appSpec, makeTrainingSnapshot(), request, KNOWLEDGE_FIXTURES)
    expect(good.body.sources).toEqual(['training-backups'])
    expect(good.body.answer).toBe('Training backups are kept for 30 days.')
    expect(good.body).toMatchObject({ environment: 'training', displayName: 'Training assistant' })
    expect(good.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    expect(good.dependencyTrace[0]).toMatchObject({ endpoint: 'https://ai-training.example', deployment: 'embeddings-v1' })
    expect(good.dependencyTrace[1]).toMatchObject({ collection: 'training', selectedSourceIds: ['training-backups'] })
    expect(JSON.stringify(good)).not.toContain('training-only-password')
  })

  it('distinguishes endpoint, deployment, database, authentication and empty collection faults', () => {
    const snapshot = makeTrainingSnapshot()
    const check = (key, value, status, code) => {
      const outcome = simulateAssistant(appSpec, { ...snapshot, environment: { ...snapshot.environment, [key]: value } }, request, KNOWLEDGE_FIXTURES)
      expect(outcome).toMatchObject({ status, diagnostic: { code } })
      expect(JSON.stringify(outcome)).not.toContain('training-only-password')
    }
    check('AI_ENDPOINT', 'https://wrong.example', 502, 'AI_ENDPOINT')
    check('EMBEDDING_DEPLOYMENT', 'wrong', 502, 'AI_DEPLOYMENT')
    check('ANSWER_DEPLOYMENT', 'wrong', 502, 'AI_DEPLOYMENT')
    check('PGHOST', 'wrong', 503, 'POSTGRES_CONNECTION')
    check('PGDATABASE', 'wrong', 503, 'POSTGRES_CONNECTION')
    check('PGUSER', 'wrong', 503, 'POSTGRES_AUTH')
    check('PGPASSWORD', 'wrong', 503, 'POSTGRES_AUTH')
    const noCollection = simulateAssistant(appSpec, { ...snapshot, environment: { ...snapshot.environment, COLLECTION: 'empty' } }, request, KNOWLEDGE_FIXTURES)
    expect(noCollection).toMatchObject({ status: 200, body: { answer: 'No matching documents.', sources: [] } })
    expect(noCollection.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query'])
  })

  it('retrieves the authored support passage from the selected collection', () => {
    const outcome = simulateAssistant(appSpec, makeTrainingSnapshot(), { ...request, body: { question: 'Who provides support?' } }, KNOWLEDGE_FIXTURES)
    expect(outcome.body).toMatchObject({ answer: 'Contact the training desk for support.', sources: ['training-support'] })
    expect(outcome.dependencyTrace[1].selectedSourceIds).toEqual(['training-support'])
  })

  it('fails when the mounted settings file is missing or malformed', () => {
    const snapshot = makeTrainingSnapshot()
    expect(simulateAssistant(appSpec, { ...snapshot, files: {} }, request, KNOWLEDGE_FIXTURES).diagnostic.code).toBe('CONFIG_FILE_MISSING')
    expect(simulateAssistant(appSpec, { ...snapshot, files: { ...snapshot.files, '/etc/assistant/settings.json': '{' } }, request, KNOWLEDGE_FIXTURES).diagnostic.code).toBe('CONFIG_FILE_INVALID')
    expect(simulateAssistant(appSpec, { ...snapshot, files: { ...snapshot.files, '/etc/assistant/settings.json': '{}' } }, request, KNOWLEDGE_FIXTURES))
      .toMatchObject({ status: 503, diagnostic: { code: 'APP_CONFIGURATION' } })
    expect(simulateAssistant(appSpec, { ...snapshot, files: { ...snapshot.files, '/etc/assistant/settings.json': '{"display_name":{"error":"FORGED"},"response_prefix":""}' } }, request, KNOWLEDGE_FIXTURES))
      .toMatchObject({ status: 503, diagnostic: { code: 'APP_CONFIGURATION' } })
  })

  it('rejects an altered fixed helper adapter and a hardcoded answer bypass', () => {
    const helper = renderKnowledgeHelper(KNOWLEDGE_FIXTURES)
    expect(helper).toContain('FIXTURE_VERSION')
    const changedHelper = { ...CONFIG_SOLUTION_FILES, 'training_runtime.py': `${helper}\n# altered` }
    expect(parsePythonProject(changedHelper, CONFIG_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED' }))
    const bypassSource = { ...CONFIG_SOLUTION_FILES, 'app.py': CONFIG_SOLUTION_FILES['app.py'].replace('return training_runtime.answer(question, settings())', 'return "Training backups are kept for 30 days."') }
    expect(parsePythonProject(bypassSource, CONFIG_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
    const bypass = { ...appSpec, routes: [{ ...appSpec.routes[0], response: { kind: 'literal', value: 'Training backups are kept for 30 days.' } }] }
    expect(simulateAssistant(bypass, makeTrainingSnapshot(), request, KNOWLEDGE_FIXTURES).diagnostic.code).toBe('ASSISTANT_FLOW_INVALID')
  })
})

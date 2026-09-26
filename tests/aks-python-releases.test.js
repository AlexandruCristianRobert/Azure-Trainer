import { expect, test } from 'vitest'
import { RELEASE_FILES, RELEASE_MANIFEST, RELEASE_SOLUTION_FILES } from '../src/data/templates/aks-python/releases.js'
import { parsePythonProject } from '../src/lib/project/python.js'

test('release template has exactly the health based source and build surface', () => {
  expect(Object.keys(RELEASE_FILES)).toHaveLength(13)
  expect(RELEASE_MANIFEST.buildFiles).toEqual(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'retrieval.sql', 'Dockerfile'])
  expect(RELEASE_FILES).not.toHaveProperty('training_workload.py')
  expect(RELEASE_FILES).not.toHaveProperty('k8s/hpa.yaml')
})

test('v2 source projects an executable release response binding', () => {
  const parsed = parsePythonProject(RELEASE_SOLUTION_FILES, RELEASE_MANIFEST)
  expect(parsed.diagnostics).toEqual([])
  expect(parsed.appSpec.release).toMatchObject({ version: 1 })
})

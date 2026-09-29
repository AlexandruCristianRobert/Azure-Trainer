import { expect, test } from 'vitest'
import { RELEASE_FILES, RELEASE_MANIFEST, RELEASE_SOLUTION_FILES } from '../src/data/templates/aks-python/releases.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { parse, stringify } from 'yaml'
import { simulateIntegration } from '../src/lib/kubernetes/integration.js'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'
import { makeTrainingSnapshot, createAksTestRun, act } from './helpers/aks.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { projectSourceHash, selectBuildFiles } from '../src/lib/project/build.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'
import { createHash } from 'node:crypto'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'

const question = { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }
const snapshot = () => { const result = makeTrainingSnapshot(); result.environment.AUDIENCE = 'employee'; return result }
const compile = files => parsePythonProject(files, RELEASE_MANIFEST)
const response = files => simulateIntegration(compile(files).appSpec, snapshot(), question, INTEGRATION_FIXTURES, 'healthy')

test('preserves the existing captured integration AppSpec for legacy saved runs', () => {
  // Frozen from the base 8e38e6c compiler, before any release projection.
  const app = parsePythonProject(INTEGRATION_SOLUTION_FILES, INTEGRATION_MANIFEST).appSpec
  expect(createHash('sha256').update(JSON.stringify(app)).digest('hex')).toBe('9666c70bd66d7e4812a471d718b61491fa7c7bb9a1108557b5064b81a3c78452')
})

test('release template has exactly the health based source and build surface', () => {
  expect(Object.keys(RELEASE_FILES)).toHaveLength(13)
  expect(RELEASE_MANIFEST.buildFiles).toEqual(['app.py', 'server.py', 'training_clients.py', 'training_health.py', 'retrieval.sql', 'Dockerfile'])
  expect(RELEASE_FILES).not.toHaveProperty('training_workload.py')
  expect(RELEASE_FILES).not.toHaveProperty('k8s/hpa.yaml')
  expect(RELEASE_MANIFEST).toMatchObject({ id: 'aks-python-releases-v1', integrationVersion: 1, healthVersion: 1, releaseVersion: 1 })
  const app = compile(RELEASE_FILES)
  expect(app.diagnostics).toEqual([])
  expect(app.appSpec.version).toBe('1.0')
  expect(app.appSpec.health).toEqual(compile({ ...RELEASE_FILES, 'app.py': HEALTH_SOLUTION_FILES['app.py'] }).appSpec.health)
  expect(response(RELEASE_FILES).body).toEqual({ answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' })
  const deployment = parse(RELEASE_FILES['k8s/deployment.yaml'])
  expect(deployment.metadata).toMatchObject({ name: 'assistant-api', namespace: 'assistant' })
  expect(deployment.spec).toMatchObject({ replicas: 2, revisionHistoryLimit: 3, minReadySeconds: 5, progressDeadlineSeconds: 60, strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } } })
  expect(deployment.spec.template.spec.containers[0]).toMatchObject({ image: 'acraksreleasesguided.azurecr.io/assistant:release-v1', resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } } })
  expect(validateKubernetesObject(deployment, { capabilities: { kubernetesConfiguration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true } }).diagnostics).toEqual([])
})

test('v2 source projects an executable release response binding', () => {
  const parsed = parsePythonProject(RELEASE_SOLUTION_FILES, RELEASE_MANIFEST)
  expect(parsed.diagnostics).toEqual([])
  expect(parsed.appSpec.release).toMatchObject({ version: 1 })
  expect(parsed.appSpec.version).toBe('2.0')
  expect(parsed.appSpec.release.responseBindings.release).toBe('2.0')
  const result = response(RELEASE_SOLUTION_FILES)
  expect(result.body).toEqual({ answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '2.0' })
  expect(result.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
  expect(result.integrationTrace).toMatchObject({ vectorProvenance: 'embedding', sourceProvenance: 'rows', selectedIds: ['training-backups'], contextIds: ['training-backups'] })
  expect(parsed.appSpec.integration.graph.nodes.some(node => node.op === 'literal' && node.value === 'retrieval.sql')).toBe(true)
})

test('named formatter and direct dictionary preserve equivalent lexical bindings and provenance', () => {
  const files = { ...RELEASE_SOLUTION_FILES, 'app.py': RELEASE_SOLUTION_FILES['app.py'].replace('format_answer(result["answer"], rows, cfg["environment"])', '{"answer": result["answer"], "sources": [row["id"] for row in rows], "environment": cfg["environment"], "release": SERVICE_VERSION}') }
  expect(compile(files).diagnostics).toEqual([])
  const direct = response(files); const helper = response(RELEASE_SOLUTION_FILES)
  expect(direct.body).toEqual(helper.body)
  expect(direct.integrationTrace).toMatchObject({ sourceProvenance: 'rows', vectorProvenance: 'embedding' })
  const shadowed = { ...RELEASE_SOLUTION_FILES, 'app.py': RELEASE_SOLUTION_FILES['app.py'].replace('def answer(question):', 'rows = "module shadow"\n\ndef answer(question):') }
  expect(response(shadowed).body).toEqual(helper.body)
})

test.each([
  source => source.replace('format_answer(result["answer"], rows, cfg["environment"])', 'format_answer(result["answer"], rows)'),
  source => source.replace('def format_answer(answer_text, rows, environment):', 'def format_answer(answer_text, rows, environment, extra):'),
  source => source.replace('def format_answer(answer_text, rows, environment):', 'def format_answer(answer_text, rows, environment):\n    print(answer_text)'),
  source => source.replace('"answer": answer_text,', '"answer": str(answer_text),'),
  source => source.replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = 2'),
  source => source.replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = unknown()'),
  source => source.replace('"release": SERVICE_VERSION,', '"release": environment,'),
  source => source.replace('"answer": answer_text,', '"answer": "Training backups are kept for 30 days.",'),
  source => source.replace('"sources": [row["id"] for row in rows],', '"sources": ["training-backups"],'),
  source => source.replace('format_answer(result["answer"], rows, cfg["environment"])', '{"answer": "Training backups are kept for 30 days.", "sources": [row["id"] for row in rows], "environment": cfg["environment"], "release": SERVICE_VERSION}'),
  source => source.replace('format_answer(result["answer"], rows, cfg["environment"])', '{"answer": result["answer"], "sources": ["training-backups"], "environment": cfg["environment"], "release": SERVICE_VERSION}'),
])('rejects unsupported release source with a located diagnostic', mutate => {
  expect(compile({ ...RELEASE_SOLUTION_FILES, 'app.py': mutate(RELEASE_SOLUTION_FILES['app.py']) }).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', path: 'app.py', line: expect.any(Number), column: expect.any(Number) })]))
})

test('unknown non-scalar module expressions cannot become undefined graph literals', () => {
  const files = { ...RELEASE_SOLUTION_FILES, 'app.py': RELEASE_SOLUTION_FILES['app.py'].replace('PORT = 8080', 'PORT = 8080\nUNKNOWN = other()').replace('"release": SERVICE_VERSION,', '"release": UNKNOWN,') }
  expect(compile(files).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PYTHON_UNSUPPORTED', message: "Unknown binding 'UNKNOWN'." })]))
})

test('invalid input, empty retrieval, and dependency errors retain their original branches', () => {
  const app = compile(RELEASE_SOLUTION_FILES).appSpec
  const invoke = (body, profile = 'healthy') => simulateIntegration(app, snapshot(), { ...question, body }, INTEGRATION_FIXTURES, profile)
  expect(invoke({ question: '   ' })).toMatchObject({ status: 400, body: { error: 'Question is required.' }, dependencyTrace: [] })
  expect(invoke({ question: 'What is the travel allowance?' }).body).toEqual({ answer: 'No matching documents.', sources: [], environment: 'training' })
  expect(invoke(question.body, 'answer-unavailable-always')).toMatchObject({ status: 503, body: { code: 'DEPENDENCY_UNAVAILABLE' } })
})

test('constant response cannot fabricate three dependency stages or row provenance', () => {
  const files = { ...RELEASE_SOLUTION_FILES, 'app.py': RELEASE_SOLUTION_FILES['app.py'].replace(/def answer\(question\):[\s\S]*?(?=from training_health)/, 'def answer(question):\n    return {"status": 200, "body": {"answer": "Training backups are kept for 30 days.", "sources": ["training-backups"], "environment": "training", "release": SERVICE_VERSION}}\n\n') }
  const result = response(files)
  expect(result.dependencyTrace).toEqual([])
  expect(result.integrationTrace.sourceProvenance).toBe(null)
})

// Task 1 exercises capture with the existing replacement lifecycle. The timed
// rollout controller and resource scheduling for these sources belong to Task 2.
function seedRelease(files = RELEASE_FILES) {
  const projectFiles = { ...files }
  const deployment = parse(projectFiles['k8s/deployment.yaml'])
  for (const key of ['strategy', 'revisionHistoryLimit', 'minReadySeconds', 'progressDeadlineSeconds']) delete deployment.spec[key]
  delete deployment.spec.template.spec.containers[0].resources
  projectFiles['k8s/deployment.yaml'] = stringify(deployment)
  let { run, lab } = createAksTestRun({ manifestId: RELEASE_MANIFEST.id, initialProjectFiles: projectFiles,
    capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true }, healthFixture: { initializationSeconds: 6 } })
  for (const line of ['az group create -n rgrelease -l eastus', 'az acr create -g rgrelease -n acraksreleasesguided --sku Basic', 'az acr build --registry acraksreleasesguided -t assistant:release-v1 .', 'az aks create -g rgrelease -n aksrelease --enable-managed-identity --generate-ssh-keys --attach-acr acraksreleasesguided', 'az aks get-credentials -g rgrelease -n aksrelease', ...RELEASE_MANIFEST.kubernetesFiles.map(path => `kubectl apply -f ${path}`)]) run = act(run, lab, { type: 'command', line }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 10 }).run
  return { run, lab, clusterId: run.sandbox.aksClusters[0].id }
}
function route(run, lab, clusterId, request = question) {
  const service = run.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/assistant-public']
  return routeServiceRequest(run, { origin: { kind: 'external', clusterId }, hostname: service.status.loadBalancer.ingress[0].ip, port: 80, ...request, integrationProfile: 'healthy' }, lab)
}

test('saved source changes leave running v1 capture intact until public build and apply start v2 Pods', () => {
  let { run, lab, clusterId } = seedRelease()
  const first = route(run, lab, clusterId)
  expect(first.outcome.status).toBe(200)
  expect(first.outcome.body).not.toHaveProperty('release')
  const uid = first.outcome.route.podUid
  const artifactId = run.runtime.kubernetes.clusters[clusterId].podSnapshots[uid].artifactId
  const original = structuredClone(run.artifacts.buildsById[artifactId])
  const sourceHash = projectSourceHash(selectBuildFiles(RELEASE_FILES, RELEASE_MANIFEST))
  expect(original.sourceHash).toBe(sourceHash)
  expect(original.appSpec.release.responseBindings).toEqual({})
  expect(run.artifacts.sourceSnapshotsByHash[sourceHash].files['app.py']).toBe(RELEASE_FILES['app.py'])
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: RELEASE_SOLUTION_FILES['app.py'] }).run
  const unchanged = route(run, lab, clusterId)
  expect(unchanged.outcome.body).toEqual(first.outcome.body)
  expect(route(run, lab, clusterId, { method: 'GET', path: '/api/info' }).outcome.body.version).toBe('1.0')
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.savedFiles['k8s/deployment.yaml'].replace('release-v1', 'release-v2') }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 10 }).run
  const changed = route(run, lab, clusterId)
  expect(changed.outcome.body.release).toBe('2.0')
  expect(changed.outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
  expect(changed.outcome.integrationTrace.sourceProvenance).toBe('rows')
  expect(changed.outcome.route.podUid).not.toBe(uid)
  expect(route(changed.run, lab, clusterId, { method: 'GET', path: '/api/info' }).outcome.body.version).toBe('2.0')
  expect(run.artifacts.buildsById[artifactId]).toEqual(original)
})

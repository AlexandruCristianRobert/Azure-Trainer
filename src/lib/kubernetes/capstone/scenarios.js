import { parsePythonProject } from '../../project/python.js'
import { parsePythonDockerfile } from '../../project/python-dockerfile.js'
import { simulateIntegration } from '../integration.js'
import { evaluateHealthEndpoint } from '../probes.js'
import { canonicalize } from '../../labEngine/evidence.js'

const issue = (code, message, path = 'app.py') => ({ code, message, path, line: 1, column: 1 })
const profileEnvironment = catalog => ({ ...catalog?.profiles?.training, APP_ENV: 'training' })
const request = (question, requestId) => ({ method: 'POST', path: '/api/ask', body: { question }, requestId })
const expectedLog = (id, status) => [
  { event: 'request.started', request_id: id, status: null },
  { event: 'request.completed', request_id: id, status },
]

/** Inspect saved source with a supplied fixture context only. No run, registry,
 * artifact or Kubernetes state enters this source-preview path. */
export function verifyCapstoneSource(files, manifest, fixtureCatalog) {
  const diagnostics = []
  const measurements = { kind: 'source-preview', fixtureVersion: fixtureCatalog?.version ?? null,
    artifactId: null, deploymentId: null, cases: {}, health: {}, workload: null }
  const declared = manifest?.files ?? []
  const fileNames = Object.keys(files ?? {})
  if (declared.length !== 16 || new Set(declared).size !== 16 || fileNames.length !== 16 || fileNames.some(path => !declared.includes(path)))
    diagnostics.push(issue('PROJECT_FILES', 'The saved project must contain exactly the declared 16 files.'))
  let totalBytes = 0
  for (const path of declared) {
    const source = files?.[path]
    if (typeof source !== 'string') { diagnostics.push(issue('MISSING_FILE', 'A required project file is missing.', path)); continue }
    const bytes = new TextEncoder().encode(source).length
    totalBytes += bytes
    if (bytes > (manifest.maxFileBytes ?? 64 * 1024)) diagnostics.push(issue('FILE_SIZE_LIMIT', 'A project file exceeds its supported size.', path))
  }
  if (totalBytes > (manifest?.maxTotalBytes ?? 256 * 1024)) diagnostics.push(issue('PROJECT_SIZE_LIMIT', 'The project exceeds its supported size.'))
  for (const [path, source] of Object.entries(manifest?.fixedFiles ?? {}))
    if (files?.[path] !== source) diagnostics.push(issue('SCAFFOLD_MODIFIED', 'The supplied adapter is fixed.', path))
  const docker = parsePythonDockerfile(files?.Dockerfile, manifest)
  diagnostics.push(...docker.diagnostics)
  if (diagnostics.length) return { passed: false, diagnostics, measurements }

  const parsed = parsePythonProject(files, manifest)
  diagnostics.push(...parsed.diagnostics)
  if (diagnostics.length || !parsed.appSpec) return { passed: false, diagnostics, measurements }
  const app = parsed.appSpec
  const snapshot = { environment: profileEnvironment(fixtureCatalog), configRefs: [] }
  const cases = [
    ['backups', 'How long are backups kept?', 'healthy'],
    ['support', 'Who provides support?', 'healthy'],
    ['invalid', '   ', 'healthy'],
    ['noMatch', 'What is the travel allowance?', 'healthy'],
    ['retryFailure', 'How long are backups kept?', 'answer-unavailable-always'],
    ['retryRecovery', 'How long are backups kept?', 'embedding-throttle-once'],
  ]
  for (const [name, question, profile] of cases) {
    const id = `source-preview-${name}`
    measurements.cases[name] = simulateIntegration(app, snapshot, request(question, id), fixtureCatalog, profile)
  }
  const results = measurements.cases
  const check = (condition, code, message) => { if (!condition) diagnostics.push(issue(code, message)) }
  check(results.backups.status === 200 && results.backups.body.answer === fixtureCatalog?.questions?.['How long are backups kept?']?.answers?.['training-backups']
    && results.backups.body.sources?.join() === 'training-backups' && results.backups.integrationTrace?.queryBindings?.published === true
    && results.backups.integrationTrace?.vectorProvenance === 'embedding' && results.backups.integrationTrace?.sourceProvenance === 'rows',
  'CAPSTONE_BACKUPS', 'The published training backup response must derive from the embedding and retrieved row.')
  check(results.support.status === 200 && results.support.body.sources?.join() === 'training-support'
    && results.support.body.answer === fixtureCatalog?.questions?.['Who provides support?']?.answers?.['training-support'],
  'CAPSTONE_SUPPORT', 'The training support response must derive from its retrieved row.')
  check(results.invalid.status === 400 && results.invalid.dependencyTrace.length === 0, 'CAPSTONE_INVALID', 'Blank input must stop before dependency calls.')
  check(results.noMatch.status === 200 && results.noMatch.body.answer === 'No matching documents.'
    && results.noMatch.body.sources?.length === 0 && results.noMatch.dependencyTrace.every(item => item.operation !== 'answer'),
  'CAPSTONE_NO_MATCH', 'Empty retrieval must avoid the answer dependency.')
  check(results.retryFailure.status === 503 && results.retryFailure.dependencyTrace.at(-1)?.attempts?.length === 3,
    'CAPSTONE_RETRY', 'The bounded retry failure must return the dependency error after three attempts.')
  check(results.retryRecovery.status === 200 && results.retryRecovery.dependencyTrace[0]?.attempts?.length === 2,
    'CAPSTONE_RETRY', 'A transient embedding failure must recover on the second attempt.')
  for (const [name, result] of Object.entries(results))
    check(canonicalize(result.appLogRecords) === canonicalize(expectedLog(`source-preview-${name}`, result.status)),
      'CAPSTONE_LOGS', `The ${name} application logs must surround the actual response with a request ID.`)
  const version = app.version
  check((version === '1.0' && !Object.hasOwn(results.backups.body, 'release'))
    || (version === '2.0' && results.backups.body.release === '2.0'),
  'CAPSTONE_RELEASE', 'Successful answers must match the declared application release.')

  const pod = { spec: { containers: [{ ports: [{ name: 'http', containerPort: 8080 }] }] } }
  const container = { initializedAtMs: 6000, localFaults: {} }
  const health = (path, nowMs, faults = {}) => evaluateHealthEndpoint(app, { ...container, localFaults: faults }, {}, path, 'http', nowMs, pod)
  measurements.health = {
    startupBefore: health('/health/startup', 0), startupAfter: health('/health/startup', 6000),
    readyBefore: health('/health/ready', 0), readyBeforeClosed: health('/health/ready', 0, { admissionClosed: true }),
    readyOpen: health('/health/ready', 6000),
    readyClosed: health('/health/ready', 6000, { admissionClosed: true }),
    liveBefore: health('/health/live', 0), liveAfter: health('/health/live', 6000),
  }
  check(measurements.health.startupBefore.status === 503 && measurements.health.startupAfter.status === 200
    && measurements.health.readyBefore.status === 503 && measurements.health.readyBeforeClosed.status === 503
    && measurements.health.readyOpen.status === 200
    && measurements.health.readyClosed.status === 503
    && measurements.health.liveBefore.status === 200 && measurements.health.liveAfter.status === 200,
  'CAPSTONE_HEALTH', 'Startup, readiness and liveness must reflect the taught lifecycle signals.')

  const work = app.workload
  measurements.workload = work && { route: work.route, operation: work.operation, units: work.units,
    scratchMiB: work.scratchMiB, checksum: Array.from({ length: work.units }, (_, index) => index * 17).reduce((sum, value) => sum + value, 0) % 1000003,
    helperDigest: work.helperDigest }
  check(work?.route === '/api/work' && work?.operation === 'process_batch' && work.units === 20 && work.scratchMiB === 96
    && measurements.workload.checksum === 3230, 'CAPSTONE_WORKLOAD', 'The work route must project twenty bounded workload units.')
  check(app.routes.some(route => route.method === 'GET' && route.path === '/api/info')
    && app.routes.some(route => route.method === 'POST' && route.path === '/api/ask')
    && app.routes.some(route => route.method === 'GET' && route.path === '/api/work'),
  'CAPSTONE_ROUTES', 'The fixed server must expose info, ask and work routes.')
  return { passed: diagnostics.length === 0, diagnostics, measurements }
}

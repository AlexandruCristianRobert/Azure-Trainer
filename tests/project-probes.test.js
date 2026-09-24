import { describe, expect, it } from 'vitest'
import { PROJECT_MANIFEST, SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'
import { PROBE_MANIFEST, PROBE_STARTER_FILES, PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'
import { parseProbeConfiguration } from '../src/lib/project/probes.js'
import { deployGuidedLab } from '../src/data/labs/containerapps-journey/deploy-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { presentContainerApp } from '../src/lib/az/containerapps-arm.js'

const programPath = 'src/Trainer.Api/Program.cs'
const image = 'acrprobesguided.azurecr.io/api:v1'
const probe = (type, path) => ({ type, httpGet: { path, port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 1,
  periodSeconds: 2, timeoutSeconds: 1, failureThreshold: 2, successThreshold: 1 })
const probes = [probe('Startup', '/health/startup'), probe('Readiness', '/health/ready'), probe('Liveness', '/health/live')]
const config = (items = probes) => probeConfiguration({ appName: 'api', image, probes: items })
const project = (files = PROBE_SOLUTION_FILES) => ({ manifestId: PROBE_MANIFEST.id, savedFiles: structuredClone(files), draftFiles: structuredClone(files), fileVersions: {} })
const run = (files = PROBE_SOLUTION_FILES) => ({ nextSequence: 3, project: project(files), artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })
const build = (candidate) => buildImage(candidate, { registryId: 'registry-id', loginServer: 'acrprobesguided.azurecr.io', image: 'api:v1' })

describe('probe project source', () => {
  it('limits new files and health parsing to the probe manifest', () => {
    expect(getProjectManifest(PROJECT_MANIFEST.id)).toBe(PROJECT_MANIFEST)
    expect(getProjectManifest(PROBE_MANIFEST.id)).toBe(PROBE_MANIFEST)
    expect(PROBE_MANIFEST.files).toEqual([...PROJECT_MANIFEST.files, 'src/Trainer.Api/HealthState.cs', 'containerapp.yaml'])
    expect(PROBE_STARTER_FILES[programPath]).toContain('Results.StatusCode(503)')
    expect(parseProject(PROBE_STARTER_FILES, PROBE_MANIFEST).appSpec.healthEndpoints).toEqual([
      { path: '/health/startup', condition: 'never' }, { path: '/health/ready', condition: 'never' },
      { path: '/health/live', condition: 'never' },
    ])
    expect(parseProject(PROBE_SOLUTION_FILES, PROBE_MANIFEST).appSpec.healthEndpoints).toEqual([
      { path: '/health/startup', condition: 'startup' }, { path: '/health/ready', condition: 'ready' },
      { path: '/health/live', condition: 'responsive' },
    ])
    expect(parseProject(SOLUTION_FILES).appSpec).not.toHaveProperty('healthEndpoints')
    expect(parseProject(PROBE_SOLUTION_FILES).diagnostics).not.toEqual([])
  })

  it('normalizes comments, whitespace, and equivalent status response while retaining faulty conditions', () => {
    const program = PROBE_SOLUTION_FILES[programPath]
      .replace('HealthState.Ready ? Results.Ok() : Results.StatusCode(503)',
        '/* ready */ HealthState . DependencyAvailable ? Results.StatusCode(200) : Results.StatusCode(503)')
      .replace('HealthState.Responsive ? Results.Ok() : Results.StatusCode(503)',
        'true ? Results.Ok() : Results.StatusCode(503)')
    const parsed = parseProject({ ...PROBE_SOLUTION_FILES, [programPath]: program }, PROBE_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.healthEndpoints).toEqual([
      { path: '/health/startup', condition: 'startup' }, { path: '/health/ready', condition: 'dependency' },
      { path: '/health/live', condition: 'always' },
    ])
    const alternate = program.replace('HealthState . DependencyAvailable ? Results.StatusCode(200) : Results.StatusCode(503)',
      'Results.StatusCode(HealthState.Ready ? 200 : 503)')
    expect(parseProject({ ...PROBE_SOLUTION_FILES, [programPath]: alternate }, PROBE_MANIFEST).appSpec.healthEndpoints[1]).toEqual({ path: '/health/ready', condition: 'ready' })
  })

  it('rejects duplicate routes, unknown C# conditions, executable statements, and modified fixed helper', () => {
    const base = PROBE_SOLUTION_FILES[programPath]
    for (const changed of [
      base.replace('"/health/ready"', '"/health/startup"'),
      base.replace('HealthState.Ready', 'HealthState.Unknown'),
      base.replace('app.Run(', 'Console.WriteLine("x"); app.Run('),
      base.replace('"/health/live"', '"/api/info"'),
    ]) expect(parseProject({ ...PROBE_SOLUTION_FILES, [programPath]: changed }, PROBE_MANIFEST).appSpec).toBeNull()
    const changedHelper = { ...PROBE_SOLUTION_FILES, 'src/Trainer.Api/HealthState.cs': 'unsafe' }
    expect(parseProject(changedHelper, PROBE_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED' }))
  })

  it('saves bounded files without publishing a build and builds only saved health source', () => {
    const original = project()
    const changed = PROBE_SOLUTION_FILES[programPath].replace('HealthState.Ready', 'HealthState.DependencyAvailable')
    const saved = saveProjectFile(original, programPath, changed)
    expect(saved.diagnostics).toEqual([])
    expect(original.savedFiles[programPath]).not.toBe(changed)
    expect(build({ ...run(), project: { ...original, draftFiles: { ...original.draftFiles, [programPath]: changed } } }).artifact.appSpec.healthEndpoints[1].condition).toBe('ready')
    expect(build({ ...run(), project: saved.project }).artifact.appSpec.healthEndpoints[1].condition).toBe('dependency')
    for (const [path, text, code] of [
      ['../containerapp.yaml', config(), 'INVALID_PATH'], ['containerapp.yml', config(), 'UNKNOWN_FILE'],
      [programPath, 'x'.repeat(PROBE_MANIFEST.maxFileBytes + 1), 'FILE_TOO_LARGE'],
    ]) expect(saveProjectFile(original, path, text).diagnostics).toContainEqual(expect.objectContaining({ code }))
  })

  it('starts with a buildable API and Dockerfile while all three health routes fail', () => {
    const built = build(run(PROBE_STARTER_FILES))
    expect(built.diagnostics).toEqual([])
    expect(built.artifact.appSpec).toMatchObject({ service: { value: 'contoso-api' }, listeningPort: 8080,
      routes: [{ path: '/api/info', response: { service: { kind: 'member', source: 'AppSettings.ServiceName', value: 'contoso-api' },
        environment: { kind: 'config', key: 'APP_ENV' } } }],
      healthEndpoints: [
        { path: '/health/startup', condition: 'never' }, { path: '/health/ready', condition: 'never' },
        { path: '/health/live', condition: 'never' },
      ] })
    expect(built.artifact.dockerSpec).toMatchObject({ listeningPort: 8080, entrypoint: 'Trainer.Api.dll' })
  })
})

describe('bounded JSON-form Container App YAML', () => {
  it('normalizes a complete supported configuration, including empty probes', () => {
    expect(parseProbeConfiguration(config()).config).toEqual({ image, envVars: { APP_ENV: 'training' },
      cpu: 0.5, memory: '1Gi', minReplicas: 2, maxReplicas: 2, probes })
    expect(parseProbeConfiguration(config([])).config.probes).toEqual([])
    const absent = JSON.parse(config())
    delete absent.properties.template.containers[0].probes
    expect(parseProbeConfiguration(JSON.stringify(absent)).config.probes).toEqual([])
    absent.properties.template.containers[0].probes = null
    expect(parseProbeConfiguration(JSON.stringify(absent)).diagnostics).not.toEqual([])
  })

  it('rejects unsupported fields, duplicate types, invalid ranges and malformed JSON before mutation', () => {
    const valid = JSON.parse(config())
    const candidate = (edit) => { const copy = structuredClone(valid); edit(copy); return JSON.stringify(copy) }
    for (const text of [
      '{ broken', 'properties:\n  template: {}',
      candidate((c) => { c.properties.template.containers.push(structuredClone(c.properties.template.containers[0])) }),
      candidate((c) => { c.properties.template.containers[0].name = 'ignored-name' }),
      candidate((c) => { c.properties.template.containers[0].probes.push(structuredClone(c.properties.template.containers[0].probes[0])) }),
      candidate((c) => { c.properties.template.containers[0].probes[0].tcpSocket = { port: 8080 } }),
      candidate((c) => { c.properties.template.containers[0].probes[0].httpGet.scheme = null }),
      candidate((c) => { c.properties.template.containers[0].probes[0].successThreshold = 2 }),
      candidate((c) => { c.properties.template.scale.minReplicas = 0 }),
      candidate((c) => { c.properties.template.containers[0].resources.cpu = 1 }),
      candidate((c) => { c.properties.extra = true }),
    ]) expect(parseProbeConfiguration(text).diagnostics.length, text).toBeGreaterThan(0)
    const specialName = candidate((c) => { c.properties.template.containers[0].env[0].name = '__proto__' })
    expect(Object.hasOwn(parseProbeConfiguration(specialName).config.envVars, '__proto__')).toBe(true)
  })
})

describe('saved YAML deployment', () => {
  const lab = { ...deployGuidedLab, id: 'probe-test', manifestId: PROBE_MANIFEST.id,
    capabilities: { acrBuild: true, healthProbes: true }, initialProjectFiles: { ...PROBE_SOLUTION_FILES,
      'containerapp.yaml': probeConfiguration({ appName: 'api', image: 'acrguided.azurecr.io/api:v1', probes: [] }) } }
  const apply = (run, action) => applyRunAction(run, action, lab)
  const command = (run, line) => {
    const result = apply(run, { type: 'command', line })
    expect(result.lines.filter((entry) => entry.kind === 'err'), line).toEqual([])
    expect(result.diagnostics, line).toEqual([])
    return result.run
  }
  const setup = () => {
    let current = createBehavioralRun(lab, { attemptId: 'probe-1' })
    for (const task of [lab.tasks[0], lab.tasks[3], lab.tasks[4], lab.tasks[6]]) {
      for (const step of task.solution.steps) current = command(current, step.line)
    }
    current = command(current, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .')
    current = command(current, lab.tasks[7].solution.steps[0].line)
    return current
  }
  const yaml = (items = probes) => probeConfiguration({ appName: 'api', image: 'acrguided.azurecr.io/api:v1', probes: items })
  const app = (run) => run.sandbox.containerApps[0]
  const deployment = (run) => run.runtime.deploymentsByApp[presentContainerApp(app(run)).id]

  it('reads only saved YAML and captures probe config without rebuilding the image', () => {
    let current = setup()
    const firstGeneration = deployment(current).active.generation
    const firstArtifact = deployment(current).active.artifactId
    current = apply(current, { type: 'draft', path: 'containerapp.yaml', text: yaml() }).run
    expect(deployment(current).active.generation).toBe(firstGeneration)
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(current).active.probeConfig.probes).toEqual([])
    const savedGeneration = deployment(current).active.generation
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml' }).run
    expect(deployment(current).active.generation).toBe(savedGeneration)
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(current).active.generation).not.toBe(firstGeneration)
    expect(deployment(current).active.probeConfig).toEqual({ probes, minReplicas: 2, maxReplicas: 2, cpu: 0.5, memory: '1Gi' })
    expect(deployment(current).active.artifactId).toBe(firstArtifact)
    expect(presentContainerApp(app(current)).properties.template.containers[0].probes).toEqual(probes)
    const unchanged = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(unchanged).active.generation).toBe(deployment(current).active.generation)
    const reordered = yaml([...probes].reverse())
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: reordered }).run
    const reorderedRun = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(reorderedRun).active.generation).toBe(deployment(current).active.generation)
  })

  it('validates all YAML before mutation and rejects remote, traversal or mixed update flags', () => {
    let current = setup()
    const before = structuredClone(current.sandbox)
    const generation = deployment(current).active.generation
    const invalid = yaml().replace('"cpu": 0.5', '"cpu": 1')
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: invalid }).run
    for (const path of ['containerapp.yaml', '../containerapp.yaml', 'https://example.test/config.json']) {
      const result = apply(current, { type: 'command', line: `az containerapp update -g rg-aca-guided -n api-guided --yaml ${path}` })
      expect(result.lines.filter((entry) => entry.kind === 'err'), path).not.toEqual([])
      expect(result.run.sandbox).toEqual(before)
      expect(deployment(result.run).active.generation).toBe(generation)
    }
    const mixed = apply(current, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml --image acrguided.azurecr.io/api:v1' })
    expect(mixed.lines.filter((entry) => entry.kind === 'err')).not.toEqual([])
    expect(mixed.run.sandbox).toEqual(before)
  })

  it('keeps the previous active capture when a valid YAML image cannot be pulled', () => {
    let current = setup()
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: yaml() }).run
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    const active = structuredClone(deployment(current).active)
    const missingImage = yaml().replace('api:v1', 'api:missing')
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: missingImage }).run
    const result = apply(current, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' })
    expect(deployment(result.run).status).toBe('failed')
    expect(deployment(result.run).active).toEqual(active)
    expect(deployment(result.run).desired.image).toBe('acrguided.azurecr.io/api:missing')
  })

  it('deploys an omitted probes field as an explicit empty active list', () => {
    let current = setup()
    const absent = JSON.parse(yaml())
    delete absent.properties.template.containers[0].probes
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: JSON.stringify(absent) }).run
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(current).active.probeConfig.probes).toEqual([])
    expect(presentContainerApp(app(current)).properties.template.containers[0].probes).toEqual([])
  })

  it('treats registry and repository case changes as the same image but a new tag as a new deployment', () => {
    let current = setup()
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: yaml() }).run
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    const generation = deployment(current).active.generation
    const artifactId = deployment(current).active.artifactId
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml',
      text: yaml().replace('acrguided.azurecr.io/api:v1', 'ACRGUIDED.azurecr.io/API:v1') }).run
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(current).active.generation).toBe(generation)
    expect(deployment(current).active.artifactId).toBe(artifactId)
    current = command(current, 'az acr build --registry acrguided --image api:v2 --file Dockerfile .')
    current = apply(current, { type: 'save-file', path: 'containerapp.yaml', text: yaml().replace('api:v1', 'api:v2') }).run
    current = command(current, 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml')
    expect(deployment(current).active.generation).not.toBe(generation)
    expect(deployment(current).active.artifactId).not.toBe(artifactId)
  })
})

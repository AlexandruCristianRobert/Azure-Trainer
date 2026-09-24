import { describe, expect, it } from 'vitest'
import { CAPSTONE_MANIFEST, CAPSTONE_STARTER_FILES, CAPSTONE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'

const path = 'src/Trainer.Api/Program.cs'
const settingsPath = 'src/Trainer.Api/appsettings.json'
const run = (files) => ({ nextSequence: 1, project: { manifestId: CAPSTONE_MANIFEST.id,
  savedFiles: structuredClone(files), draftFiles: structuredClone(files), fileVersions: {} },
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })
const build = (state) => buildImage(state, { registryId: 'registry-id', loginServer: 'acrcapstone.azurecr.io', image: 'api:v1' })

describe('Capstone combined application source', () => {
  it('parses all executable contracts from one saved source', () => {
    expect(getProjectManifest(CAPSTONE_MANIFEST.id)).toBe(CAPSTONE_MANIFEST)
    const parsed = parseProject(CAPSTONE_SOLUTION_FILES, CAPSTONE_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec).toMatchObject({
      listeningPort: 8080,
      routes: [{ method: 'GET', path: '/api/info' }, { method: 'GET', path: '/api/work' }, { method: 'POST', path: '/api/summarize' }],
      cpuRoute: { method: 'GET', path: '/api/work', maxUnits: 100, response: 'checksum' },
      healthEndpoints: [{ path: '/health/startup', condition: 'startup' }, { path: '/health/ready', condition: 'ready' }, { path: '/health/live', condition: 'responsive' }],
      foundry: { configured: true, path: '/api/summarize', maxAttempts: 3, timeoutSeconds: 10,
        attemptTimeoutSeconds: 3, honorRetryAfter: true, sdkRetries: 0, identity: 'user-assigned' },
    })
    expect(parseProject(CAPSTONE_STARTER_FILES, CAPSTONE_MANIFEST).appSpec).toBeNull()
  })

  it('rejects comment and string route markers and unsupported executable statements at their location', () => {
    for (const changed of [
      CAPSTONE_SOLUTION_FILES[path].replace('app.MapGet("/health/ready"', '// app.MapGet("/health/ready"'),
      CAPSTONE_SOLUTION_FILES[path].replace('app.MapGet("/health/ready"', '"app.MapGet(\\"/health/ready\\""'),
      CAPSTONE_SOLUTION_FILES[path].replace('app.Run(', 'Console.WriteLine("surprise");\napp.Run('),
    ]) {
      const result = parseProject({ ...CAPSTONE_SOLUTION_FILES, [path]: changed }, CAPSTONE_MANIFEST)
      expect(result.appSpec).toBeNull()
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ path, line: expect.any(Number), column: expect.any(Number) }))
    }
  })

  it('enforces numeric, settings, byte and token bounds on saves and parsing', () => {
    const project = run(CAPSTONE_SOLUTION_FILES).project
    const badNumber = CAPSTONE_SOLUTION_FILES[path].replace('units > 100', 'units > 100000')
    expect(parseProject({ ...CAPSTONE_SOLUTION_FILES, [path]: badNumber }, CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INVALID_CPU_BOUNDS', path, line: expect.any(Number) }))
    expect(parseProject({ ...CAPSTONE_SOLUTION_FILES, [settingsPath]: '{"ListeningPort":8080,"FoundryEndpoint":42}' }, CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INVALID_FOUNDRY_CONFIG', path: settingsPath }))
    expect(saveProjectFile(project, path, 'x'.repeat(CAPSTONE_MANIFEST.maxFileBytes + 1), CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'FILE_TOO_LARGE', path }))
    expect(saveProjectFile(project, path, 'x '.repeat(CAPSTONE_MANIFEST.maxTokens + 1), CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TOKEN_LIMIT', path }))
    expect(saveProjectFile(project, settingsPath, '{broken', CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INVALID_JSON', path: settingsPath }))
    const malformedProject = { ...project, savedFiles: { ...project.savedFiles, [settingsPath]: '{broken' } }
    expect(saveProjectFile(malformedProject, path, CAPSTONE_SOLUTION_FILES[path], CAPSTONE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INVALID_JSON', path: settingsPath }))
  })

  it('captures combined behavior and source hash only on a new build', () => {
    const first = build(run(CAPSTONE_SOLUTION_FILES))
    expect(first.diagnostics).toEqual([])
    const edited = CAPSTONE_SOLUTION_FILES[path].replace('HealthState.Ready', 'HealthState.DependencyAvailable')
    const saved = saveProjectFile(run(CAPSTONE_SOLUTION_FILES).project, path, edited, CAPSTONE_MANIFEST)
    expect(saved.diagnostics).toEqual([])
    expect(first.artifact.appSpec.healthEndpoints[1].condition).toBe('ready')
    const second = build({ ...run(CAPSTONE_SOLUTION_FILES), project: saved.project, artifacts: first.artifacts, nextSequence: 2 })
    expect(second.diagnostics).toEqual([])
    expect(second.artifact.appSpec.healthEndpoints[1].condition).toBe('dependency')
    expect(second.artifact.appSpec.foundry).toEqual(first.artifact.appSpec.foundry)
    expect(second.artifact.sourceHash).not.toBe(first.artifact.sourceHash)
    expect(second.artifact.digest).not.toBe(first.artifact.digest)
    expect(second.artifacts.buildsById[first.artifact.id]).toEqual(first.artifact)
  })
})

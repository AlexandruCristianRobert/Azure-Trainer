import { describe, expect, it } from 'vitest'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { PROBE_MANIFEST, PROBE_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/probes.js'
import { INDEPENDENT_PROBE_MANIFEST, INDEPENDENT_PROBE_STARTER_FILES, INDEPENDENT_PROBE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/probes-independent.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { parseProbeConfiguration } from '../src/lib/project/probes.js'
import { buildImage } from '../src/lib/project/build.js'

const helperPath = 'src/Trainer.Api/HealthState.cs'
const programPath = 'src/Trainer.Api/Program.cs'
const yamlPath = 'containerapp.yaml'
const project = (files) => ({ manifestId: INDEPENDENT_PROBE_MANIFEST.id,
  savedFiles: structuredClone(files), draftFiles: structuredClone(files), fileVersions: {} })
const run = (files) => ({ nextSequence: 1, project: project(files),
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })

describe('Independent probe project fixture', () => {
  it('resolves its own manifest instead of the default project', () => {
    expect(getProjectManifest('containerapps-dotnet-probes-independent-v1')).toBe(INDEPENDENT_PROBE_MANIFEST)
    expect(INDEPENDENT_PROBE_MANIFEST.files).toEqual(PROBE_MANIFEST.files)
    expect(getProjectManifest(PROBE_MANIFEST.id)).toBe(PROBE_MANIFEST)
  })

  it('pins the new readonly helper to 30 seconds while preserving the original 20 seconds', () => {
    expect(INDEPENDENT_PROBE_STARTER_FILES[helperPath]).toContain('TimeSpan.FromSeconds(30)')
    expect(INDEPENDENT_PROBE_SOLUTION_FILES[helperPath]).toBe(INDEPENDENT_PROBE_STARTER_FILES[helperPath])
    expect(INDEPENDENT_PROBE_MANIFEST.fixedFiles[helperPath]).toBe(INDEPENDENT_PROBE_STARTER_FILES[helperPath])
    expect(PROBE_STARTER_FILES[helperPath]).toContain('TimeSpan.FromSeconds(20)')
    expect(PROBE_MANIFEST.fixedFiles[helperPath]).toBe(PROBE_STARTER_FILES[helperPath])
    const modified = { ...INDEPENDENT_PROBE_STARTER_FILES, [helperPath]: PROBE_STARTER_FILES[helperPath] }
    expect(parseProject(modified, INDEPENDENT_PROBE_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED', path: helperPath }))
  })

  it('starts with failing routes and no probes on the independent image', () => {
    const parsed = parseProject(INDEPENDENT_PROBE_STARTER_FILES, INDEPENDENT_PROBE_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.healthEndpoints).toEqual([
      { path: '/health/startup', condition: 'never' },
      { path: '/health/ready', condition: 'never' },
      { path: '/health/live', condition: 'never' },
    ])
    const yaml = parseProbeConfiguration(INDEPENDENT_PROBE_STARTER_FILES[yamlPath])
    expect(yaml.diagnostics).toEqual([])
    expect(yaml.config).toMatchObject({ image: 'acrprobesindependent.azurecr.io/api:v1', minReplicas: 2,
      maxReplicas: 2, probes: [] })
  })

  it('offers three distinct correct solution conditions and builds through the normal API', () => {
    const parsed = parseProject(INDEPENDENT_PROBE_SOLUTION_FILES, INDEPENDENT_PROBE_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.healthEndpoints).toEqual([
      { path: '/health/startup', condition: 'startup' },
      { path: '/health/ready', condition: 'ready' },
      { path: '/health/live', condition: 'responsive' },
    ])
    for (const files of [INDEPENDENT_PROBE_STARTER_FILES, INDEPENDENT_PROBE_SOLUTION_FILES]) {
      const built = buildImage(run(files), { registryId: 'registry-id',
        loginServer: 'acrprobesindependent.azurecr.io', image: 'api:v1' })
      expect(built.diagnostics).toEqual([])
      expect(built.artifact.appSpec.healthEndpoints).toEqual(parseProject(files, INDEPENDENT_PROBE_MANIFEST).appSpec.healthEndpoints)
    }
    const changed = INDEPENDENT_PROBE_SOLUTION_FILES[programPath].replace('HealthState.Ready', 'HealthState.DependencyAvailable')
    const saved = saveProjectFile(project(INDEPENDENT_PROBE_SOLUTION_FILES), programPath, changed)
    expect(saved.diagnostics).toEqual([])
    expect(buildImage({ ...run(INDEPENDENT_PROBE_SOLUTION_FILES), project: saved.project }, {
      registryId: 'registry-id', loginServer: 'acrprobesindependent.azurecr.io', image: 'api:v1',
    }).artifact.appSpec.healthEndpoints[1].condition).toBe('dependency')
  })
})

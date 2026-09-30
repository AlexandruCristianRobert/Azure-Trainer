import { describe, expect, it } from 'vitest'
import { PROJECT_MANIFEST } from '../src/data/templates/containerapps-dotnet/starter.js'
import { PROBE_MANIFEST } from '../src/data/templates/containerapps-dotnet/probes.js'
import { FOUNDRY_MANIFEST, FOUNDRY_STARTER_FILES, FOUNDRY_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/foundry.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'
import { reconcileDeployment, appArmId } from '../src/lib/simulation/runtime.js'

const program = 'src/Trainer.Api/Program.cs'
const settings = 'src/Trainer.Api/appsettings.json'
const source = (files = FOUNDRY_SOLUTION_FILES) => ({ nextSequence: 5,
  project: { manifestId: FOUNDRY_MANIFEST.id, savedFiles: structuredClone(files), draftFiles: structuredClone(files) },
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })
const build = (run) => buildImage(run, { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' })
const edit = (files, path, from, to) => ({ ...files, [path]: files[path].replace(from, to) })

describe('Foundry versioned C# source', () => {
  it('keeps legacy and probe manifests stable while starter builds with unconfigured inference', () => {
    expect(getProjectManifest(PROJECT_MANIFEST.id)).toBe(PROJECT_MANIFEST)
    expect(getProjectManifest(PROBE_MANIFEST.id)).toBe(PROBE_MANIFEST)
    expect(getProjectManifest(FOUNDRY_MANIFEST.id)).toBe(FOUNDRY_MANIFEST)
    expect(FOUNDRY_MANIFEST.id).toBe('containerapps-dotnet-foundry-v1')
    expect(FOUNDRY_STARTER_FILES['src/Trainer.Api/Trainer.Api.csproj']).toContain('OpenAI" Version="2.12.0"')
    expect(FOUNDRY_STARTER_FILES['src/Trainer.Api/Trainer.Api.csproj']).toContain('Azure.Identity" Version="1.21.0"')
    const result = build(source(FOUNDRY_STARTER_FILES))
    expect(result.diagnostics).toEqual([])
    expect(result.artifact.appSpec.foundry).toMatchObject({ configured: false, endpoint: '', deployment: '',
      method: 'POST', path: '/api/summarize', tokenScope: 'https://ai.azure.com/.default', sdkRetries: 0 })
  })

  it('extracts the resource endpoint, deployment and bounded request contract from saved source', () => {
    const parsed = parseProject(FOUNDRY_SOLUTION_FILES, FOUNDRY_MANIFEST)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.appSpec.foundry).toMatchObject({ configured: true,
      endpoint: 'https://foundryguided.services.ai.azure.com/openai/v1/', deployment: 'summarizer-primary',
      method: 'POST', path: '/api/summarize', maxInputLength: 4000, timeoutSeconds: 10,
      tokenScope: 'https://ai.azure.com/.default', sdkRetries: 0, identity: 'user-assigned' })
  })

  it('scopes the pinned Responses experimental warning to the SDK call and rejects its removal', () => {
    const text = FOUNDRY_SOLUTION_FILES[program]
    const disable = text.indexOf('#pragma warning disable OPENAI001')
    const create = text.indexOf('new OpenAIClient(')
    const invoke = text.indexOf('CreateResponseAsync(')
    const restore = text.indexOf('#pragma warning restore OPENAI001')
    expect(disable).toBeGreaterThan(0)
    expect(disable).toBeLessThan(create)
    expect(create).toBeLessThan(invoke)
    expect(invoke).toBeLessThan(restore)
    const removed = edit(FOUNDRY_SOLUTION_FILES, program, '#pragma warning disable OPENAI001', '')
    expect(parseProject(removed, FOUNDRY_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_FOUNDRY_SOURCE' }))
  })

  it('rejects project endpoints and unsupported source, identity, validation, retry or timeout edits', () => {
    const invalid = [
      edit(FOUNDRY_SOLUTION_FILES, settings, '.services.ai.azure.com/openai/v1/', '.services.ai.azure.com/api/projects/demo'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'MapPost', 'MapGet'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'string.IsNullOrWhiteSpace(text)', 'false'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'new ManagedIdentityCredential', 'new DefaultAzureCredential'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'ClientRetryPolicy(0)', 'ClientRetryPolicy(3)'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'TimeSpan.FromSeconds(10)', 'TimeSpan.FromSeconds(60)'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'https://ai.azure.com/.default', 'https://cognitiveservices.azure.com/.default'),
      edit(FOUNDRY_SOLUTION_FILES, program, 'CreateResponseAsync', 'FakeResponseAsync'),
    ]
    for (const files of invalid) expect(parseProject(files, FOUNDRY_MANIFEST).appSpec, files[program]).toBeNull()
  })

  it('captures bounded source timeout edits while rejecting relaxed limits', () => {
    const bounded = edit(FOUNDRY_SOLUTION_FILES, program, 'TimeSpan.FromSeconds(10)', 'TimeSpan.FromSeconds(8)')
    expect(parseProject(bounded, FOUNDRY_MANIFEST).appSpec.foundry.timeoutSeconds).toBe(8)
    const relaxed = edit(FOUNDRY_SOLUTION_FILES, program, 'text.Length > 4000', 'text.Length > 9999')
    expect(parseProject(relaxed, FOUNDRY_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_FOUNDRY_BOUNDS' }))
  })

  it('saves editable configuration and builds only the saved version', () => {
    let run = source(FOUNDRY_STARTER_FILES)
    run.project.draftFiles = structuredClone(FOUNDRY_SOLUTION_FILES)
    expect(build(run).artifact.appSpec.foundry.configured).toBe(false)
    const saved = saveProjectFile(run.project, settings, FOUNDRY_SOLUTION_FILES[settings])
    expect(saved.diagnostics).toEqual([])
    run = { ...run, project: saved.project }
    expect(build(run).artifact.appSpec.foundry.configured).toBe(true)
    expect(build(source(edit(FOUNDRY_SOLUTION_FILES, settings, 'summarizer-primary', 'other-deployment')))
      .artifact.appSpec.foundry.deployment).toBe('other-deployment')
  })
})

describe('Foundry deployment capture', () => {
  const identityA = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/caller-a'
  const identityB = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/caller-b'
  const app = { name: 'api', resourceGroup: 'rg', location: 'eastus', image: 'registry.azurecr.io/api:v1',
    ingress: 'external', targetPort: 8080, envVars: { AZURE_CLIENT_ID: 'client-a' }, userAssigned: identityA, registryIdentity: identityA,
    registryServer: 'registry.azurecr.io' }
  const identity = (id, principalId, clientId) => ({ id, principalId, clientId })
  function readyRun() {
    const initial = source()
    const built = build(initial)
    return { ...initial, artifacts: built.artifacts, nextSequence: built.nextSequence,
      sandbox: { containerRegistries: [{ id: 'registry-id', loginServer: 'registry.azurecr.io' }],
        managedIdentities: [identity(identityA, 'principal-a', 'client-a'), identity(identityB, 'principal-b', 'client-b')],
        roleAssignments: [{ scope: 'registry-id', principalId: 'principal-a', roleName: 'AcrPull' },
          { scope: 'registry-id', principalId: 'principal-b', roleName: 'AcrPull' }],
        containerApps: [app] }, runtime: { deploymentsByApp: {}, logs: [] } }
  }
  it('captures the built config and active app identity; identity changes create a new generation', () => {
    let run = readyRun()
    run = reconcileDeployment(run, app).run
    const active = run.runtime.deploymentsByApp[appArmId(app)].active
    expect(active.appSpec.foundry.deployment).toBe('summarizer-primary')
    expect(active.foundry).toMatchObject({ deployment: 'summarizer-primary', principalId: 'principal-a', identityId: identityA })
    const unchanged = reconcileDeployment(run, app).run
    expect(unchanged.runtime.deploymentsByApp[appArmId(app)].active).toEqual(active)
    const swapped = { ...app, userAssigned: identityB, registryIdentity: identityB, envVars: { AZURE_CLIENT_ID: 'client-b' } }
    const changed = reconcileDeployment(unchanged, swapped).run.runtime.deploymentsByApp[appArmId(app)].active
    expect(changed.generation).not.toBe(active.generation)
    expect(changed.foundry.principalId).toBe('principal-b')
  })

  it('keeps active provenance through draft and saved edits until a rebuilt image is redeployed', () => {
    let run = readyRun()
    run = reconcileDeployment(run, app).run
    const original = structuredClone(run.runtime.deploymentsByApp[appArmId(app)].active)
    const updated = edit(FOUNDRY_SOLUTION_FILES, settings, 'summarizer-primary', 'new-deployment')
    run.project.draftFiles = structuredClone(updated)
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    run.project.savedFiles = structuredClone(updated)
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    const built = build(run)
    run = { ...run, artifacts: built.artifacts, nextSequence: built.nextSequence }
    expect(run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    run = reconcileDeployment(run, app).run
    const active = run.runtime.deploymentsByApp[appArmId(app)].active
    expect(active.artifactId).not.toBe(original.artifactId)
    expect(active.foundry.deployment).toBe('new-deployment')
    expect(reconcileDeployment(run, { ...app, tags: { owner: 'learner' } }).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(active)
  })
})

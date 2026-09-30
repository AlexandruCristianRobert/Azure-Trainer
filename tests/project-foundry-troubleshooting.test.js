import { describe, expect, it } from 'vitest'
import { FOUNDRY_MANIFEST, FOUNDRY_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/foundry.js'
import { TROUBLESHOOTING_FOUNDRY_MANIFEST, TROUBLESHOOTING_FOUNDRY_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/foundry-troubleshooting.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'
import { appArmId, reconcileDeployment } from '../src/lib/simulation/runtime.js'

const settings = 'src/Trainer.Api/appsettings.json'
const program = 'src/Trainer.Api/Program.cs'
const image = 'registry.azurecr.io/api:v1'
const identityId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/caller'
const app = { name: 'api', resourceGroup: 'rg', location: 'eastus', image, ingress: 'external', targetPort: 8080,
  envVars: { AZURE_CLIENT_ID: 'client-a' }, userAssigned: identityId, registryIdentity: identityId,
  registryServer: 'registry.azurecr.io' }
const copy = (value) => structuredClone(value)
const editSettings = (files, changes) => ({ ...files, [settings]: `${JSON.stringify({ ...JSON.parse(files[settings]), ...changes }, null, 2)}\n` })
const runFrom = (files = TROUBLESHOOTING_FOUNDRY_STARTER_FILES) => ({ nextSequence: 5,
  project: { manifestId: TROUBLESHOOTING_FOUNDRY_MANIFEST.id, savedFiles: copy(files), draftFiles: copy(files) },
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
  sandbox: { containerRegistries: [{ id: 'registry-id', loginServer: 'registry.azurecr.io' }],
    managedIdentities: [{ id: identityId, principalId: 'principal-a', clientId: 'client-a' }],
    roleAssignments: [{ scope: 'registry-id', principalId: 'principal-a', roleName: 'AcrPull' }], containerApps: [app] },
  runtime: { deploymentsByApp: {}, logs: [] } })
const build = (run) => buildImage(run, { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' })

describe('troubleshooting Foundry source', () => {
  it('registers a distinct buildable starter with a wrong resource endpoint, deployment and one attempt', () => {
    expect(getProjectManifest(FOUNDRY_MANIFEST.id)).toBe(FOUNDRY_MANIFEST)
    expect(parseProject(FOUNDRY_SOLUTION_FILES, FOUNDRY_MANIFEST).appSpec.foundry.timeoutSeconds).toBe(10)
    expect(getProjectManifest(TROUBLESHOOTING_FOUNDRY_MANIFEST.id)).toBe(TROUBLESHOOTING_FOUNDRY_MANIFEST)
    const result = build(runFrom())
    expect(result.diagnostics).toEqual([])
    expect(result.artifact.appSpec.foundry).toMatchObject({
      configured: true, endpoint: 'https://foundrywrong.services.ai.azure.com/openai/v1/',
      deployment: 'summarizer-missing', maxAttempts: 1, timeoutSeconds: 10,
      attemptTimeoutSeconds: 3, honorRetryAfter: false, sdkRetries: 0,
      tokenScope: 'https://ai.azure.com/.default', identity: 'user-assigned',
    })
  })

  it('captures supported retry settings from saved configuration and rejects out-of-range policy', () => {
    const repaired = editSettings(TROUBLESHOOTING_FOUNDRY_STARTER_FILES, {
      FoundryEndpoint: 'https://foundrylab.services.ai.azure.com/openai/v1/',
      FoundryDeployment: 'summarizer-primary', TotalAttempts: 3,
      TotalBudgetSeconds: 10, AttemptTimeoutSeconds: 3, HonorRetryAfter: true,
    })
    expect(parseProject(repaired, TROUBLESHOOTING_FOUNDRY_MANIFEST).appSpec.foundry).toMatchObject({
      endpoint: 'https://foundrylab.services.ai.azure.com/openai/v1/', deployment: 'summarizer-primary',
      maxAttempts: 3, timeoutSeconds: 10, attemptTimeoutSeconds: 3, honorRetryAfter: true,
    })
    for (const changes of [{ TotalAttempts: 0 }, { TotalAttempts: 4 }, { TotalBudgetSeconds: 11 },
      { AttemptTimeoutSeconds: 4 }, { AttemptTimeoutSeconds: 0 }, { HonorRetryAfter: 'true' },
      { FoundryEndpoint: 'https://foundrylab.services.ai.azure.com/api/projects/demo' }]) {
      expect(build(runFrom(editSettings(repaired, changes))).artifact, JSON.stringify(changes)).toBeNull()
    }
  })

  it('rejects edits to the retry loop, auth, SDK retry, and validation structure', () => {
    for (const [from, to] of [
      ['ClientRetryPolicy(0)', 'ClientRetryPolicy(3)'],
      ['ManagedIdentityCredential(clientId)', 'DefaultAzureCredential()'],
      ['CreateResponseAsync', 'FakeResponseAsync'],
      ['text.Length > 4000', 'text.Length > 9000'],
      ['#pragma warning disable OPENAI001', ''],
      ['attempt <= maxAttempts', 'attempt < maxAttempts'],
    ]) {
      const files = { ...TROUBLESHOOTING_FOUNDRY_STARTER_FILES,
        [program]: TROUBLESHOOTING_FOUNDRY_STARTER_FILES[program].replace(from, to) }
      expect(parseProject(files, TROUBLESHOOTING_FOUNDRY_MANIFEST).diagnostics, from)
        .toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_FOUNDRY_SOURCE' }))
    }
  })

  it('retries exactly the declared transient upstream statuses', () => {
    const source = TROUBLESHOOTING_FOUNDRY_STARTER_FILES[program]
    const filter = /catch \(ClientResultException error\) when \(error\.Status is ([^)]+)\)/.exec(source)?.[1]
    expect(filter?.split(' or ').map(Number)).toEqual([408, 429, 500, 502, 503, 504])
    const unsupported = { ...TROUBLESHOOTING_FOUNDRY_STARTER_FILES,
      [program]: source.replace('error.Status is ', 'error.Status is 401 or ') }
    expect(parseProject(unsupported, TROUBLESHOOTING_FOUNDRY_MANIFEST).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_FOUNDRY_SOURCE' }))
  })

  it('keeps a previous publication and active policy until a valid rebuild is redeployed', () => {
    let run = runFrom()
    const first = build(run)
    run = { ...run, artifacts: first.artifacts, nextSequence: first.nextSequence }
    run = reconcileDeployment(run, app).run
    const original = copy(run.runtime.deploymentsByApp[appArmId(app)].active)
    const repaired = editSettings(TROUBLESHOOTING_FOUNDRY_STARTER_FILES, { TotalAttempts: 3, HonorRetryAfter: true })
    run.project.draftFiles = repaired
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    run.project = saveProjectFile(run.project, settings, repaired[settings]).project
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    const invalid = build({ ...run, project: { ...run.project, savedFiles: editSettings(repaired, { TotalAttempts: 5 }) } })
    expect(invalid.artifact).toBeNull()
    expect(invalid.artifacts).toEqual(run.artifacts)
    const rebuilt = build(run)
    run = { ...run, artifacts: rebuilt.artifacts, nextSequence: rebuilt.nextSequence }
    expect(run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    run = reconcileDeployment(run, app).run
    const active = run.runtime.deploymentsByApp[appArmId(app)].active
    expect(active.appSpec.foundry.maxAttempts).toBe(3)
    expect(active.foundry).toMatchObject({ maxAttempts: 3, honorRetryAfter: true,
      identityId, clientId: 'client-a', principalId: 'principal-a' })
    expect(reconcileDeployment(run, { ...app, tags: { owner: 'learner' } }).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(active)
    const otherIdentityId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/other'
    run.sandbox.managedIdentities.push({ id: otherIdentityId, principalId: 'principal-b', clientId: 'client-b' })
    run.sandbox.roleAssignments.push({ scope: 'registry-id', principalId: 'principal-b', roleName: 'AcrPull' })
    const otherApp = { ...app, userAssigned: otherIdentityId, registryIdentity: otherIdentityId,
      envVars: { AZURE_CLIENT_ID: 'client-b' } }
    const switched = reconcileDeployment(run, otherApp).run.runtime.deploymentsByApp[appArmId(app)].active
    expect(switched.generation).not.toBe(active.generation)
    expect(switched.foundry).toMatchObject({ maxAttempts: 3, honorRetryAfter: true,
      identityId: otherIdentityId, clientId: 'client-b', principalId: 'principal-b' })
  })
})

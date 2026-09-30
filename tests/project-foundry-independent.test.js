import { describe, expect, it } from 'vitest'
import { INDEPENDENT_FOUNDRY_MANIFEST, INDEPENDENT_FOUNDRY_STARTER_FILES, INDEPENDENT_FOUNDRY_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/foundry-independent.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'
import { appArmId, reconcileDeployment } from '../src/lib/simulation/runtime.js'
import { simulateRequest } from '../src/lib/simulation/requests.js'

const program = 'src/Trainer.Api/Program.cs'
const settings = 'src/Trainer.Api/appsettings.json'
const identityId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/inference'
const pullId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/pull'
const app = { name: 'api', resourceGroup: 'rg', image: 'registry.azurecr.io/api:v1', ingress: 'external', targetPort: 8080,
  envVars: { AZURE_CLIENT_ID: 'inference-client' }, userAssigned: [pullId, identityId], registryIdentity: pullId, registryServer: 'registry.azurecr.io' }
const runFrom = (files) => ({ nextSequence: 5, project: { manifestId: INDEPENDENT_FOUNDRY_MANIFEST.id,
  savedFiles: structuredClone(files), draftFiles: structuredClone(files) },
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
  sandbox: { containerRegistries: [{ id: 'registry-id', loginServer: 'registry.azurecr.io' }],
    managedIdentities: [{ id: pullId, principalId: 'pull-principal', clientId: 'pull-client' },
      { id: identityId, principalId: 'inference-principal', clientId: 'inference-client' }],
    roleAssignments: [{ scope: 'registry-id', principalId: 'pull-principal', roleName: 'AcrPull' }], containerApps: [app] },
  runtime: { deploymentsByApp: {}, logs: [] } })
const build = (run) => buildImage(run, { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' })
const configure = (files, changes) => ({ ...files, [settings]: `${JSON.stringify({ ...JSON.parse(files[settings]), ...changes }, null, 2)}\n` })

describe('independent Foundry project', () => {
  it('builds the healthy old API without a brief capability', () => {
    expect(getProjectManifest(INDEPENDENT_FOUNDRY_MANIFEST.id)).toBe(INDEPENDENT_FOUNDRY_MANIFEST)
    const result = build(runFrom(INDEPENDENT_FOUNDRY_STARTER_FILES))
    expect(result.diagnostics).toEqual([])
    expect(result.artifact.appSpec).toMatchObject({ foundry: null, routes: [{ method: 'GET', path: '/api/info' }] })
    const run = runFrom(INDEPENDENT_FOUNDRY_STARTER_FILES)
    const deployed = reconcileDeployment({ ...run, artifacts: result.artifacts, nextSequence: result.nextSequence }, app).run
    expect(simulateRequest(deployed, { appId: appArmId(app), method: 'POST', path: '/api/brief' }))
      .toMatchObject({ status: 404, diagnostic: { code: 'ROUTE_NOT_FOUND' } })
  })

  it.each([
    [2, 5, 1], [3, 8, 2],
  ])('parses a compliant %i attempt, %i second budget, %i second cap policy', (maxAttempts, timeoutSeconds, attemptTimeoutSeconds) => {
    const files = configure(INDEPENDENT_FOUNDRY_SOLUTION_FILES, { TotalAttempts: maxAttempts,
      TotalBudgetSeconds: timeoutSeconds, AttemptTimeoutSeconds: attemptTimeoutSeconds })
    const result = build(runFrom(files))
    expect(result.diagnostics).toEqual([])
    expect(result.artifact.appSpec.foundry).toMatchObject({ contract: 'brief-v1', method: 'POST', path: '/api/brief',
      inputField: 'content', outputField: 'brief', maxInputLength: 4000,
      endpoint: 'https://foundryindependent.services.ai.azure.com/openai/v1/', deployment: 'briefing-secondary',
      maxAttempts, timeoutSeconds, attemptTimeoutSeconds, honorRetryAfter: true,
      identity: 'user-assigned', sdkRetries: 0, tokenScope: 'https://ai.azure.com/.default' })
  })

  it('rejects out-of-contract policy and source bypasses atomically', () => {
    for (const change of [{ TotalAttempts: 1 }, { TotalAttempts: 4 }, { TotalBudgetSeconds: 4 },
      { TotalBudgetSeconds: 9 }, { AttemptTimeoutSeconds: 3 }, { HonorRetryAfter: false },
      { FoundryEndpoint: 'https://foundryindependent.services.ai.azure.com/api/projects/demo' }]) {
      expect(build(runFrom(configure(INDEPENDENT_FOUNDRY_SOLUTION_FILES, change))).artifact, JSON.stringify(change)).toBeNull()
    }
    for (const [from, to] of [['ClientRetryPolicy(0)', 'ClientRetryPolicy(3)'],
      ['ManagedIdentityCredential(clientId)', 'DefaultAzureCredential()'],
      ['CreateResponseAsync', 'FakeResponseAsync'], ['string.IsNullOrWhiteSpace(content)', 'false'],
      ['#pragma warning disable OPENAI001', ''], ['error.Status is 408', 'error.Status is 401 or 408']]) {
      const files = { ...INDEPENDENT_FOUNDRY_SOLUTION_FILES, [program]: INDEPENDENT_FOUNDRY_SOLUTION_FILES[program].replace(from, to) }
      expect(parseProject(files, INDEPENDENT_FOUNDRY_MANIFEST).appSpec, from).toBeNull()
    }
  })

  it('keeps saved, built, and active policy separate while capturing the inference identity', () => {
    let run = runFrom(INDEPENDENT_FOUNDRY_STARTER_FILES)
    const first = build(run)
    run = { ...run, artifacts: first.artifacts, nextSequence: first.nextSequence }
    run = reconcileDeployment(run, app).run
    const original = structuredClone(run.runtime.deploymentsByApp[appArmId(app)].active)
    expect(original.appSpec.foundry).toBeNull()
    run.project.draftFiles = structuredClone(INDEPENDENT_FOUNDRY_SOLUTION_FILES)
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    for (const path of [program, settings]) run.project = saveProjectFile(run.project, path, INDEPENDENT_FOUNDRY_SOLUTION_FILES[path]).project
    expect(reconcileDeployment(run, app).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    const rebuilt = build(run)
    run = { ...run, artifacts: rebuilt.artifacts, nextSequence: rebuilt.nextSequence }
    expect(run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(original)
    run = reconcileDeployment(run, app).run
    const active = run.runtime.deploymentsByApp[appArmId(app)].active
    expect(active.appSpec.foundry.contract).toBe('brief-v1')
    expect(active.foundry).toMatchObject({ identityId, clientId: 'inference-client', principalId: 'inference-principal' })
    expect(reconcileDeployment(run, { ...app, tags: { owner: 'learner' } }).run.runtime.deploymentsByApp[appArmId(app)].active).toEqual(active)
  })
})

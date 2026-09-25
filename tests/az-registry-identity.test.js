import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape, normalizeSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'

const output = (result) => result.lines.filter((line) => line.kind === 'out').map((line) => line.text).join('\n')
const error = (result) => result.lines.filter((line) => line.kind === 'err').map((line) => line.text).join('\n')
const json = (result) => JSON.parse(output(result))
const registryId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-images/providers/Microsoft.ContainerRegistry/registries/acrguided`
const identityId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-images/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-guided`
const withGroup = () => runLine(createSandbox(), 'az group create -n rg-images -l eastus').sandbox
const withRegistry = () => runLine(withGroup(), 'az acr create -g rg-images -n acrguided --sku Basic').sandbox
const withIdentity = (sandbox = withRegistry()) => runLine(sandbox, 'az identity create -g rg-images -n id-guided').sandbox
const buildContext = () => ({ run: { project: { savedFiles: SOLUTION_FILES }, artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} }, nextSequence: 1 }, lab: { capabilities: { acrBuild: true } } })

describe('registry and identity resources', () => {
  it('normalizes legacy sandboxes and validates the new collections', () => {
    const legacy = { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } }
    expect(normalizeSandbox(legacy)).toMatchObject({ containerRegistries: [], managedIdentities: [], roleAssignments: [] })
    expect(legacy).not.toHaveProperty('containerRegistries')
    expect(createSandbox()).toMatchObject({ containerRegistries: [], managedIdentities: [], roleAssignments: [] })
    expect(isSandboxShape({ ...createSandbox(), containerRegistries: [{}] })).toBe(false)
    expect(isSandboxShape({ ...createSandbox(), managedIdentities: [{}] })).toBe(false)
    expect(isSandboxShape({ ...createSandbox(), roleAssignments: [{}] })).toBe(false)
  })

  it('creates, reads and deletes a Basic registry with canonical ARM fields', () => {
    const created = runLine(withGroup(), 'az acr create -g rg-images -n acrguided --sku Basic --tags lesson=guided')
    expect(error(created)).toBe('')
    expect(created.sandbox.containerRegistries[0]).toEqual({ id: registryId, name: 'acrguided', resourceGroup: 'rg-images', location: 'eastus', loginServer: 'acrguided.azurecr.io', sku: 'Basic', tags: { lesson: 'guided' } })
    expect(json(created)).toMatchObject({ id: registryId, name: 'acrguided', loginServer: 'acrguided.azurecr.io', sku: { name: 'Basic' }, type: 'Microsoft.ContainerRegistry/registries' })
    expect(json(runLine(created.sandbox, 'az acr show -g RG-IMAGES -n ACRGUIDED')).id).toBe(registryId)
    expect(json(runLine(created.sandbox, 'az acr list -g rg-images'))).toHaveLength(1)
    const duplicate = runLine(created.sandbox, 'az acr create -g RG-IMAGES -n ACRGUIDED --sku Basic')
    expect(error(duplicate)).toBe('')
    expect(duplicate.sandbox.containerRegistries).toHaveLength(1)
    expect(error(runLine(created.sandbox, 'az acr delete -g rg-images -n acrguided'))).toContain('Pass --yes')
    expect(runLine(created.sandbox, 'az acr delete -g rg-images -n acrguided --yes').sandbox.containerRegistries).toEqual([])
    expect(isSandboxShape(created.sandbox)).toBe(true)
  })

  it('accepts -r as the short registry flag when building a saved image', () => {
    const base = withRegistry()
    const result = runLine(base, 'az acr build -r acrguided -t api:v1 .', buildContext())
    expect(error(result)).toBe('')
    expect(result.effects?.find(effect => effect.type === 'publish-build')?.artifacts.publishedTags['acrguided.azurecr.io/api:v1']).toBe('build-1')
  })

  it('rejects invalid names, sku, and conflicting re-creation without mutation', () => {
    const base = withRegistry()
    for (const line of [
      'az acr create -g rg-images -n aaaa --sku Basic',
      'az acr create -g rg-images -n acr-guided --sku Basic',
      'az acr create -g rg-images -n anotheracrguided --sku Standard',
      'az acr create -g rg-images -n acrguided --sku Basic -l westus',
    ]) {
      const result = runLine(base, line)
      expect(error(result)).not.toBe('')
      expect(result.sandbox).toBe(base)
    }
  })

  it('treats equivalent registry and identity tags as the same mapping regardless of order', () => {
    const registry = runLine(withGroup(), 'az acr create -g rg-images -n acrguided --sku Basic --tags owner=sam lesson=one')
    const registryRepeat = runLine(registry.sandbox, 'az acr create -g rg-images -n acrguided --sku Basic --tags lesson=one owner=sam')
    expect(error(registryRepeat)).toBe('')
    expect(registryRepeat.sandbox.containerRegistries).toEqual(registry.sandbox.containerRegistries)
    const registryConflict = runLine(registry.sandbox, 'az acr create -g rg-images -n acrguided --sku Basic --tags owner=sam lesson=two')
    expect(error(registryConflict)).toContain('tags differ')
    expect(registryConflict.sandbox).toBe(registry.sandbox)

    const identity = runLine(registry.sandbox, 'az identity create -g rg-images -n id-guided --tags owner=sam lesson=one')
    const identityRepeat = runLine(identity.sandbox, 'az identity create -g rg-images -n id-guided --tags lesson=one owner=sam')
    expect(error(identityRepeat)).toBe('')
    expect(identityRepeat.sandbox.managedIdentities).toEqual(identity.sandbox.managedIdentities)
    const identityConflict = runLine(identity.sandbox, 'az identity create -g rg-images -n id-guided --tags owner=sam lesson=two')
    expect(error(identityConflict)).toContain('tags differ')
    expect(identityConflict.sandbox).toBe(identity.sandbox)
  })

  it('creates identity with distinct ARM, client and principal IDs and consistent duplicate identity', () => {
    const created = runLine(withRegistry(), 'az identity create -g rg-images -n id-guided')
    expect(error(created)).toBe('')
    const identity = created.sandbox.managedIdentities[0]
    expect(identity).toMatchObject({ id: identityId, name: 'id-guided', resourceGroup: 'rg-images', location: 'eastus' })
    expect(new Set([identity.id, identity.clientId, identity.principalId]).size).toBe(3)
    expect(identity.clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(identity.principalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(json(runLine(created.sandbox, 'az identity show -g RG-IMAGES -n ID-GUIDED')).principalId).toBe(identity.principalId)
    expect(json(runLine(created.sandbox, 'az identity list -g rg-images'))).toHaveLength(1)
    const duplicate = runLine(created.sandbox, 'az identity create -g RG-IMAGES -n ID-GUIDED')
    expect(duplicate.sandbox.managedIdentities).toEqual(created.sandbox.managedIdentities)
    const conflict = runLine(created.sandbox, 'az identity create -g rg-images -n id-guided -l westus')
    expect(error(conflict)).toContain('cannot be changed')
    expect(conflict.sandbox).toBe(created.sandbox)
    expect(error(runLine(created.sandbox, 'az identity delete -g rg-images -n id-guided'))).toContain('Pass --yes')
    expect(runLine(created.sandbox, 'az identity delete -g rg-images -n id-guided --yes').sandbox.managedIdentities).toEqual([])
    expect(isSandboxShape(created.sandbox)).toBe(true)
  })

  it('derives repeatable, distinct synthetic identity and role IDs', () => {
    const first = withIdentity()
    const second = withIdentity()
    expect(first.managedIdentities[0].clientId).toBe(second.managedIdentities[0].clientId)
    expect(first.managedIdentities[0].principalId).toBe(second.managedIdentities[0].principalId)
    expect(first.managedIdentities[0].clientId).not.toBe(first.managedIdentities[0].principalId)
    const principalId = first.managedIdentities[0].principalId
    const command = `az role assignment create --assignee-object-id ${principalId} --role AcrPull --scope ${registryId}`
    const assignment1 = runLine(first, command).sandbox.roleAssignments[0]
    const assignment2 = runLine(second, command).sandbox.roleAssignments[0]
    expect(assignment1.id).toBe(assignment2.id)
    expect(assignment1.id).not.toBe(principalId)
  })
})

describe('AcrPull role assignments', () => {
  it('grants only the exact registry scope to an existing identity principal and lists case-insensitively', () => {
    const base = withIdentity()
    const principalId = base.managedIdentities[0].principalId
    const created = runLine(base, `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId.toUpperCase()}`)
    expect(error(created)).toBe('')
    expect(created.sandbox.roleAssignments).toHaveLength(1)
    expect(created.sandbox.roleAssignments[0]).toMatchObject({ principalId, principalType: 'ServicePrincipal', roleName: 'AcrPull', scope: registryId })
    expect(json(created)).toMatchObject({ principalId, principalType: 'ServicePrincipal', roleDefinitionName: 'AcrPull', scope: registryId })
    expect(json(runLine(created.sandbox, `az role assignment list --scope ${registryId}`))).toHaveLength(1)
    expect(error(runLine(created.sandbox, `az role assignment list --scope ${registryId}/repositories/api`))).toContain('scope')
    const duplicate = runLine(created.sandbox, `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`)
    expect(duplicate.sandbox.roleAssignments).toEqual(created.sandbox.roleAssignments)
    const deleted = runLine(created.sandbox, `az role assignment delete --assignee-object-id ${principalId} --role AcrPull --scope ${registryId}`)
    expect(error(deleted)).toBe('')
    expect(deleted.sandbox.roleAssignments).toEqual([])
    expect(isSandboxShape(created.sandbox)).toBe(true)
  })

  it('rejects unknown principals, roles, and malformed scope atomically', () => {
    const base = withIdentity()
    const principalId = base.managedIdentities[0].principalId
    for (const line of [
      `az role assignment create --assignee-object-id 00000000-0000-4000-8000-000000000000 --role AcrPull --scope ${registryId}`,
      `az role assignment create --assignee-object-id ${principalId} --role Owner --scope ${registryId}`,
      `az role assignment create --assignee-object-id ${principalId} --role AcrPull --scope ${registryId}/repositories/api`,
      `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type User --role AcrPull --scope ${registryId}`,
    ]) {
      const result = runLine(base, line)
      expect(error(result)).not.toBe('')
      expect(result.sandbox).toBe(base)
      expect(base.roleAssignments).toEqual([])
    }
  })

  it('preserves learner Key Vault role assignment routing', () => {
    const group = withGroup()
    const vault = runLine(group, 'az keyvault create -g rg-images -n guided-vault').sandbox
    const scope = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-images/providers/Microsoft.KeyVault/vaults/guided-vault`
    const assigned = runLine(vault, `az role assignment create --assignee-object-id a37a00c7-d689-4b5d-a8c8-1d75f307d5ef --role 'Key Vault Secrets Officer' --scope ${scope}`)
    expect(error(assigned)).toBe('')
    expect(json(runLine(assigned.sandbox, `az role assignment list --scope ${scope}`))).toHaveLength(1)
    expect(assigned.sandbox.roleAssignments).toEqual([])
    expect(assigned.sandbox.keyVaults[0].roleAssignments).toHaveLength(1)
  })

  it('cleans role assignments referencing a deleted identity across resource groups', () => {
    let base = withIdentity()
    base = runLine(base, 'az group create -n rg-other -l eastus').sandbox
    const principalId = base.managedIdentities[0].principalId
    const otherRegistry = runLine(base, 'az acr create -g rg-other -n anotheracr --sku Basic').sandbox
    const otherScope = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-other/providers/Microsoft.ContainerRegistry/registries/anotheracr`
    const assigned = runLine(otherRegistry, `az role assignment create --assignee-object-id ${principalId} --role AcrPull --scope ${otherScope}`).sandbox
    const removed = runLine(assigned, 'az group delete -n rg-images --yes')
    expect(error(removed)).toBe('')
    expect(removed.sandbox.roleAssignments).toEqual([])
    expect(removed.sandbox.managedIdentities).toEqual([])
    const groupDeleted = removed
    expect(error(groupDeleted)).toBe('')
    expect(groupDeleted.sandbox.containerRegistries.map((registry) => registry.name)).toEqual(['anotheracr'])
    expect(isSandboxShape(groupDeleted.sandbox)).toBe(true)
  })
})

describe('ACR build simulation', () => {
  it('publishes a saved project via a typed effect without mutating context', () => {
    const sandbox = withRegistry()
    const context = buildContext()
    const before = JSON.stringify(context)
    const built = runLine(sandbox, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .', context)
    expect(error(built)).toBe('')
    expect(built.sandbox).toBe(sandbox)
    expect(context).toEqual(JSON.parse(before))
    expect(built.effects).toHaveLength(1)
    expect(built.effects[0]).toMatchObject({ type: 'publish-build', nextSequence: 2, artifacts: { publishedTags: { 'acrguided.azurecr.io/api:v1': 'build-1' } } })
    expect(json(built)).toMatchObject({ id: 'build-1', image: { loginServer: 'acrguided.azurecr.io', repository: 'api', tag: 'v1' } })
    expect(json(runLine(sandbox, 'az acr repository list --name acrguided', { ...context, run: { ...context.run, artifacts: built.effects[0].artifacts } }))).toEqual(['api'])
    expect(json(runLine(sandbox, 'az acr repository show-tags --name acrguided --repository api', { ...context, run: { ...context.run, artifacts: built.effects[0].artifacts } }))).toEqual(['v1'])
  })

  it('reports unsupported remote context and source errors without publication', () => {
    const sandbox = withRegistry()
    const context = buildContext()
    const remote = runLine(sandbox, 'az acr build --registry acrguided --image api:v1 --file Dockerfile https://example.com/repo', context)
    expect(error(remote)).toContain('local context')
    expect(remote.effects ?? []).toEqual([])
    const broken = { ...context, run: { ...context.run, project: { savedFiles: { ...SOLUTION_FILES, Dockerfile: 'RUN arbitrary command' } } } }
    const failed = runLine(sandbox, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .', broken)
    expect(error(failed)).toContain('Dockerfile')
    expect(failed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'Dockerfile', code: expect.any(String), line: expect.any(Number), column: expect.any(Number) })]))
    expect(failed.effects ?? []).toEqual([])
    expect(error(runLine(sandbox, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .'))).toContain('guided')
    expect(error(runLine(sandbox, 'az group show -n rg-images unexpected'))).toContain('unrecognized arguments')
  })

  it('deletion emits publication removal while retaining immutable build artifacts', () => {
    const sandbox = withRegistry()
    const built = runLine(sandbox, 'az acr build --registry acrguided --image api:v1 --file Dockerfile .', buildContext())
    const deleted = runLine(sandbox, 'az acr delete -g rg-images -n acrguided --yes')
    expect(deleted.effects).toEqual([{ type: 'delete-registry-publications', registryIds: [registryId] }])
    expect(built.effects[0].artifacts.buildsById['build-1']).toBeDefined()
  })
})

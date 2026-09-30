import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape, normalizeSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createResourceGroup, deleteResourceGroup } from '../src/lib/sandbox/ops.js'
import { createIdentity } from '../src/lib/sandbox/identity.js'
import {
  createFoundryAccount, getFoundryAccount, listFoundryAccounts, deleteFoundryAccount,
  createFoundryProject, getFoundryProject, listFoundryProjects,
  createFoundryDeployment, getFoundryDeployment, listFoundryDeployments,
} from '../src/lib/sandbox/foundry.js'
import { createFoundryRoleAssignment, listFoundryRoleAssignments, deleteFoundryRoleAssignment, isFoundryAccountScope } from '../src/lib/sandbox/roleAssignments.js'

const base = () => createResourceGroup(createSandbox(), { name: 'rg-ai', location: 'eastus' }).sandbox
const accountId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-ai/providers/Microsoft.CognitiveServices/accounts/aiguided`
const account = (sandbox = base()) => createFoundryAccount(sandbox, { resourceGroup: 'rg-ai', name: 'aiguided', sku: 'S0', identity: { type: 'SystemAssigned' }, allowProjectManagement: true }).sandbox

describe('Foundry sandbox resources', () => {
  it('creates deterministic account, project and deployment resources and survives normalization', () => {
    const created = createFoundryAccount(base(), { resourceGroup: 'rg-ai', name: 'aiguided', sku: 'S0', identity: { type: 'SystemAssigned' }, allowProjectManagement: true })
    expect(created.resource).toMatchObject({ id: accountId, kind: 'AIServices', location: 'eastus', sku: 'S0', endpoint: 'https://aiguided.services.ai.azure.com/openai/v1/', identity: { type: 'SystemAssigned' }, allowProjectManagement: true })
    const withProject = createFoundryProject(created.sandbox, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-project' }).sandbox
    const withDeployment = createFoundryDeployment(withProject, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-model', modelName: 'gpt-5-mini', modelVersion: '2025-08-07', sku: 'GlobalStandard' }).sandbox
    expect(getFoundryProject(withDeployment, 'rg-ai', 'aiguided', 'summary-project').id).toBe(`${accountId}/projects/summary-project`)
    expect(getFoundryDeployment(withDeployment, 'rg-ai', 'aiguided', 'summary-model')).toMatchObject({ id: `${accountId}/deployments/summary-model`, modelName: 'gpt-5-mini', modelVersion: '2025-08-07', sku: 'GlobalStandard' })
    expect(getFoundryAccount(withDeployment, 'RG-AI', 'AIGUIDED').endpoint).toBe(created.resource.endpoint)
    expect(listFoundryAccounts(withDeployment, 'rg-ai')).toHaveLength(1)
    expect(listFoundryProjects(withDeployment, 'rg-ai', 'aiguided')).toHaveLength(1)
    expect(listFoundryDeployments(withDeployment, 'rg-ai', 'aiguided')).toHaveLength(1)
    expect(normalizeSandbox(JSON.parse(JSON.stringify(withDeployment)))).toEqual(withDeployment)
    expect(isSandboxShape(withDeployment)).toBe(true)
    expect(normalizeSandbox(base()).foundryAccounts).toEqual([])
  })

  it('rejects malformed and duplicate child resources without changing input', () => {
    const original = account()
    const project = createFoundryProject(original, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-project' }).sandbox
    for (const name of ['bad/name', 'summary-project']) {
      expect(() => createFoundryProject(project, { resourceGroup: 'rg-ai', accountName: 'aiguided', name })).toThrow()
    }
    const deployed = createFoundryDeployment(project, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-model', modelName: 'gpt-5-mini', modelVersion: '2025-08-07', sku: 'GlobalStandard' }).sandbox
    for (const options of [
      { name: 'summary-model', modelName: 'gpt-5-mini', modelVersion: '2025-08-07', sku: 'GlobalStandard' },
      { name: 'bad/name', modelName: 'gpt-5-mini', modelVersion: '2025-08-07', sku: 'GlobalStandard' },
      { name: 'other-model', modelName: 'unknown', modelVersion: '2025-08-07', sku: 'GlobalStandard' },
    ]) expect(() => createFoundryDeployment(deployed, { resourceGroup: 'rg-ai', accountName: 'aiguided', ...options })).toThrow()
    expect(deployed.foundryAccounts[0].projects).toHaveLength(1)
    expect(deployed.foundryAccounts[0].deployments).toHaveLength(1)
    expect(isSandboxShape({ ...deployed, foundryAccounts: [{ ...deployed.foundryAccounts[0], deployments: [{ name: '../bad' }] }] })).toBe(false)
  })

  it('requires the supported account configuration', () => {
    const sandbox = base()
    for (const options of [
      { resourceGroup: 'missing', name: 'aiguided', sku: 'S0' },
      { resourceGroup: 'rg-ai', name: 'bad/name', sku: 'S0' },
      { resourceGroup: 'rg-ai', name: 'aiguided', sku: 'F0' },
      { resourceGroup: 'rg-ai', name: 'aiguided', location: 'nowhere', sku: 'S0' },
      { resourceGroup: 'rg-ai', name: 'aiguided', sku: 'S0', identity: { type: 'UserAssigned', principalId: 'forged' } },
    ]) expect(() => createFoundryAccount(sandbox, options)).toThrow()
    expect(sandbox.foundryAccounts).toEqual([])
  })

  it('requires an explicitly enabled project-management flag and account management identity', () => {
    const withoutFlag = createFoundryAccount(base(), { resourceGroup: 'rg-ai', name: 'aiguided', identity: { type: 'SystemAssigned' } }).sandbox
    expect(withoutFlag.foundryAccounts[0].allowProjectManagement).toBe(false)
    expect(() => createFoundryProject(withoutFlag, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-project' })).toThrow()
    const withoutIdentity = createFoundryAccount(base(), { resourceGroup: 'rg-ai', name: 'aiguided', allowProjectManagement: true }).sandbox
    expect(() => createFoundryProject(withoutIdentity, { resourceGroup: 'rg-ai', accountName: 'aiguided', name: 'summary-project' })).toThrow()
    expect(() => createFoundryAccount(base(), { resourceGroup: 'rg-ai', name: 'aiguided', allowProjectManagement: 'true' })).toThrow()
    const enabled = account()
    expect(isSandboxShape({ ...enabled, foundryAccounts: [{ ...enabled.foundryAccounts[0], allowProjectManagement: 'true' }] })).toBe(false)
    expect(isSandboxShape(withoutFlag)).toBe(true)
  })

  it('rejects a persisted account with no location or a forged management principal', () => {
    const created = account()
    const resource = created.foundryAccounts[0]
    expect(isSandboxShape({ ...created, foundryAccounts: [{ ...resource, location: null }] })).toBe(false)
    expect(isSandboxShape({ ...created, foundryAccounts: [{ ...resource, identity: { type: 'SystemAssigned', principalId: '00000000-0000-4000-8000-000000000000' } }] })).toBe(false)
  })

  it('grants exact account-scoped access to the app identity and cleans it on delete', () => {
    expect(isFoundryAccountScope(accountId)).toBe(true)
    expect(isFoundryAccountScope(`${accountId}/projects/summary-project`)).toBe(false)
    const withAccount = account()
    const withAppIdentity = createIdentity(withAccount, { resourceGroup: 'rg-ai', name: 'app-id' }).sandbox
    const principalId = withAppIdentity.managedIdentities[0].principalId
    const created = createFoundryRoleAssignment(withAppIdentity, { scope: accountId, role: 'Cognitive Services User', principalId })
    expect(created.resource).toMatchObject({ scope: accountId, principalId, roleName: 'Cognitive Services User', roleDefinitionId: 'a97b65f3-24c7-4388-baec-2e87135dc908' })
    expect(created.resource.principalId).not.toBe(withAppIdentity.foundryAccounts[0].identity.principalId)
    const alternate = createFoundryRoleAssignment(created.sandbox, { scope: accountId, role: 'Cognitive Services OpenAI User', principalId })
    expect(alternate.resource.id).not.toBe(created.resource.id)
    expect(createFoundryRoleAssignment(withAppIdentity, { scope: accountId, role: 'Cognitive Services User', principalId }).resource.id).toBe(created.resource.id)
    expect(createFoundryRoleAssignment(created.sandbox, { scope: accountId, role: 'Cognitive Services User', principalId }).existed).toBe(true)
    expect(listFoundryRoleAssignments(created.sandbox, { scope: accountId, principalId })).toHaveLength(1)
    expect(isSandboxShape(created.sandbox)).toBe(true)
    for (const options of [
      { scope: `${accountId}/projects/summary-project`, role: 'Cognitive Services User', principalId },
      { scope: accountId, role: 'AcrPull', principalId },
      { scope: accountId, role: 'Cognitive Services User', principalId: '00000000-0000-4000-8000-000000000000' },
    ]) expect(() => createFoundryRoleAssignment(created.sandbox, options)).toThrow()
    expect(deleteFoundryRoleAssignment(created.sandbox, { scope: accountId, role: 'Cognitive Services User', principalId }).sandbox.roleAssignments).toEqual([])
    expect(deleteFoundryAccount(created.sandbox, { resourceGroup: 'rg-ai', name: 'aiguided' }).sandbox.roleAssignments).toEqual([])
    expect(deleteResourceGroup(created.sandbox, { name: 'rg-ai' }).sandbox.foundryAccounts).toEqual([])
  })
})

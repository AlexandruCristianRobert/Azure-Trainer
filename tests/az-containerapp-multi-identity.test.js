import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape, normalizeSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const output = (result) => result.lines.filter((line) => line.kind === 'out').map((line) => line.text).join('\n')
const error = (result) => result.lines.filter((line) => line.kind === 'err').map((line) => line.text).join('\n')
const json = (result) => JSON.parse(output(result))
const command = (sandbox, line) => {
  const result = runLine(sandbox, line)
  expect(error(result)).toBe('')
  return result.sandbox
}

function setup() {
  let sandbox = createSandbox()
  for (const line of [
    'az group create -n rg-app -l eastus',
    'az group create -n rg-id -l eastus',
    'az acr create -g rg-app -n example --sku Basic',
    'az containerapp env create -g rg-app -n app-env',
    'az identity create -g rg-id -n pull-id',
    'az identity create -g rg-id -n inference-id',
  ]) sandbox = command(sandbox, line)
  const [pull, inference] = sandbox.managedIdentities
  sandbox = command(sandbox, `az role assignment create --assignee-object-id ${pull.principalId} --role AcrPull --scope ${sandbox.containerRegistries[0].id}`)
  sandbox = command(sandbox, `az containerapp create -g rg-app -n service-api --environment app-env --image example.azurecr.io/api:v1 --user-assigned ${pull.id.toUpperCase()} --registry-server example.azurecr.io --registry-identity ${pull.id.toUpperCase()}`)
  return { sandbox, pull, inference }
}

describe('Container App user-assigned identity assignment', () => {
  it('adds a second existing identity without replacing the pull identity or changing the app template', () => {
    const { sandbox, pull, inference } = setup()
    expect(sandbox.containerApps[0].userAssigned).toBe(pull.id)
    const before = json(runLine(sandbox, 'az containerapp show -g rg-app -n service-api'))
    const assigned = runLine(sandbox, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id}`)
    expect(error(assigned)).toBe('')
    expect(assigned.sandbox.containerApps[0].userAssigned).toEqual([pull.id, inference.id])
    expect(assigned.sandbox.containerApps[0].registryIdentity).toBe(pull.id)
    expect(json(assigned).userAssignedIdentities).toEqual({ [pull.id]: {}, [inference.id]: {} })
    expect(json(runLine(assigned.sandbox, 'az containerapp identity show -g rg-app -n service-api'))).toEqual(json(assigned))
    const after = json(runLine(assigned.sandbox, 'az containerapp show -g rg-app -n service-api'))
    expect(after.properties.template).toEqual(before.properties.template)
    expect(isSandboxShape(assigned.sandbox)).toBe(true)
  })

  it('treats duplicate assignment as a semantic no-op and rejects unknown identities and targets atomically', () => {
    const { sandbox, pull, inference } = setup()
    const assigned = command(sandbox, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id}`)
    const duplicate = runLine(assigned, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id.toUpperCase()}`)
    expect(error(duplicate)).toBe('')
    expect(duplicate.sandbox).toBe(assigned)
    expect(duplicate.events ?? []).toEqual([])
    expect(assigned.containerApps[0].userAssigned).toEqual([pull.id, inference.id])
    const reloaded = normalizeSandbox(JSON.parse(JSON.stringify(assigned)))
    expect(json(runLine(reloaded, 'az containerapp identity show -g rg-app -n service-api')).userAssignedIdentities)
      .toEqual({ [pull.id]: {}, [inference.id]: {} })
    for (const line of [
      'az containerapp identity assign -g rg-app -n service-api --user-assigned /subscriptions/unknown/resourceGroups/rg-id/providers/Microsoft.ManagedIdentity/userAssignedIdentities/inference-id',
      'az containerapp identity assign -g rg-app -n service-api --user-assigned inference-id',
      `az containerapp identity assign -g rg-app -n missing-api --user-assigned ${inference.id}`,
      `az containerapp identity assign -g missing-rg -n service-api --user-assigned ${inference.id}`,
    ]) {
      const rejected = runLine(assigned, line)
      expect(error(rejected)).not.toBe('')
      expect(rejected.sandbox).toBe(assigned)
    }
  })

  it('detaches deleted inference and pull identities while preserving the other attachment', () => {
    const { sandbox, pull, inference } = setup()
    const both = command(sandbox, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id}`)
    const withoutInference = command(both, 'az identity delete -g rg-id -n inference-id --yes')
    expect(withoutInference.containerApps[0]).toMatchObject({ userAssigned: pull.id, registryIdentity: pull.id })
    expect(withoutInference.managedIdentities.map((identity) => identity.id)).toEqual([pull.id])
    const withoutPull = command(both, 'az identity delete -g rg-id -n pull-id --yes')
    expect(withoutPull.containerApps[0]).toMatchObject({ userAssigned: inference.id, registryIdentity: null })
    expect(withoutPull.managedIdentities.map((identity) => identity.id)).toEqual([inference.id])
    expect(isSandboxShape(withoutPull)).toBe(true)
  })

  it('group deletion detaches identities from apps in other groups and removes their grants', () => {
    const { sandbox, pull, inference } = setup()
    const both = command(sandbox, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id}`)
    const deleted = command(both, 'az group delete -n rg-id --yes')
    expect(deleted.containerApps[0]).toMatchObject({ userAssigned: null, registryIdentity: null })
    expect(deleted.managedIdentities).toEqual([])
    expect(deleted.roleAssignments).toEqual([])
    expect(deleted.containerApps).toHaveLength(1)
    expect(isSandboxShape(deleted)).toBe(true)
    expect(pull.id).not.toBe(inference.id)
  })

  it('rejects malformed saved identity collections and canonicalizes valid ID casing on reload', () => {
    const { sandbox, pull, inference } = setup()
    const both = command(sandbox, `az containerapp identity assign -g rg-app -n service-api --user-assigned ${inference.id}`)
    const malformed = [
      [pull.id, pull.id.toUpperCase()],
      [pull.id, 'unknown'],
      [pull.id, 4],
      Array.from({ length: 33 }, () => pull.id),
    ]
    for (const ids of malformed) {
      const candidate = { ...both, containerApps: [{ ...both.containerApps[0], userAssigned: ids }] }
      expect(isSandboxShape(candidate)).toBe(false)
    }
    const cased = { ...both, containerApps: [{ ...both.containerApps[0], userAssigned: [pull.id.toUpperCase(), inference.id.toUpperCase()], registryIdentity: pull.id.toUpperCase() }] }
    expect(isSandboxShape(cased)).toBe(true)
    expect(normalizeSandbox(cased).containerApps[0]).toMatchObject({ userAssigned: [pull.id, inference.id], registryIdentity: pull.id })
  })
})

import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape, normalizeSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
const ENV_ID = '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-containerapps/providers/Microsoft.App/managedEnvironments/env-contoso'

function withEnvironment() {
  let sandbox = runLine(createSandbox(), 'az group create -n rg-containerapps -l westeurope').sandbox
  return runLine(sandbox, 'az containerapp env create -g rg-containerapps -n env-contoso').sandbox
}

function withApp() {
  const result = runLine(withEnvironment(), 'az containerapp create -g rg-containerapps -n ca-contoso-api --environment env-contoso --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80')
  expect(err(result)).toBe('')
  return result.sandbox
}

describe('Container Apps sandbox model', () => {
  it('creates and normalizes Container Apps collections without mutating legacy state', () => {
    expect(createSandbox()).toMatchObject({ containerAppEnvironments: [], containerApps: [] })
    const legacy = { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } }
    expect(isSandboxShape(legacy)).toBe(true)
    expect(isSandboxShape({ ...legacy, containerApps: {} })).toBe(false)
    const normalized = normalizeSandbox(legacy)
    expect(normalized).toMatchObject({ containerAppEnvironments: [], containerApps: [] })
    expect(legacy).not.toHaveProperty('containerApps')
  })
})

describe('az containerapp env', () => {
  it('accepts ARM environment-name characters and rejects whitespace or path separators', () => {
    const sandbox = runLine(createSandbox(), 'az group create -n rg-containerapps -l westeurope').sandbox
    const created = runLine(sandbox, "az containerapp env create -g rg-containerapps -n 'env_demo.1(test)'")
    expect(err(created)).toBe('')
    expect(created.sandbox.containerAppEnvironments[0].name).toBe('env_demo.1(test)')
    for (const name of ['env/invalid', 'env invalid']) {
      const invalid = runLine(sandbox, `az containerapp env create -g rg-containerapps -n '${name}'`)
      expect(err(invalid)).toContain('managed environment name')
      expect(invalid.sandbox).toBe(sandbox)
    }
  })

  it('creates, reads, lists, and deletes an environment through runLine', () => {
    const created = runLine(runLine(createSandbox(), 'az group create -n rg-containerapps -l westeurope').sandbox, 'az containerapp env create -g rg-containerapps -n env-contoso')
    expect(err(created)).toBe('')
    expect(JSON.parse(out(created))).toMatchObject({
      name: 'env-contoso', resourceGroup: 'rg-containerapps', location: 'westeurope',
      id: ENV_ID, type: 'Microsoft.App/managedEnvironments', properties: { provisioningState: 'Succeeded' },
    })
    expect(created.events).toEqual([{ type: 'created', resourceType: 'containerAppEnvironment', name: 'env-contoso', resourceGroup: 'rg-containerapps' }])
    expect(JSON.parse(out(runLine(created.sandbox, 'az containerapp env show -g rg-containerapps -n env-contoso'))).id).toBe(ENV_ID)
    expect(JSON.parse(out(runLine(created.sandbox, 'az containerapp env list -g rg-containerapps')))).toHaveLength(1)
    expect(err(runLine(created.sandbox, 'az containerapp env delete -g rg-containerapps -n env-contoso'))).toContain('Pass --yes')
    const deleted = runLine(created.sandbox, 'az containerapp env delete -g rg-containerapps -n env-contoso --yes')
    expect(deleted.sandbox.containerAppEnvironments).toEqual([])
    expect(deleted.events).toEqual([{ type: 'deleted', resourceType: 'containerAppEnvironment', name: 'env-contoso', resourceGroup: 'rg-containerapps' }])
  })
})

describe('az containerapp', () => {
  it('creates with defaults and ARM-shaped ingress/template output', () => {
    const result = runLine(withEnvironment(), 'az containerapp create -g rg-containerapps -n ca-contoso-api --environment env-contoso --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80')
    expect(err(result)).toBe('')
    const app = JSON.parse(out(result))
    expect(app).toMatchObject({
      name: 'ca-contoso-api', resourceGroup: 'rg-containerapps', type: 'Microsoft.App/containerApps',
      properties: {
        configuration: { ingress: { external: true, targetPort: 80, fqdn: expect.stringContaining('.azurecontainerapps.io') } },
        template: {
          containers: [{ image: 'mcr.microsoft.com/k8se/quickstart:latest', resources: { cpu: 0.5, memory: '1Gi' } }],
          scale: { minReplicas: 0, maxReplicas: 10, rules: [] },
        },
      },
    })
    expect(app.properties).toMatchObject({
      environmentId: ENV_ID,
      configuration: { activeRevisionsMode: 'Single', ingress: { allowInsecure: false } },
    })
    expect(result.events).toEqual([{ type: 'created', resourceType: 'containerApp', name: 'ca-contoso-api', resourceGroup: 'rg-containerapps' }])
  })

  it('updates replica limits and upserts named HTTP rules while preserving unrelated rules', () => {
    let sandbox = withApp()
    sandbox = runLine(sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name keep --scale-rule-type http --scale-rule-http-concurrency 10').sandbox
    const updated = runLine(sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --min-replicas 0 --max-replicas 5 --scale-rule-name http-requests --scale-rule-type http --scale-rule-http-concurrency 50')
    expect(err(updated)).toBe('')
    expect(updated.sandbox.containerApps[0]).toMatchObject({ minReplicas: 0, maxReplicas: 5, scaleRules: [
      { name: 'keep', http: { metadata: { concurrentRequests: '10' } } },
      { name: 'http-requests', http: { metadata: { concurrentRequests: '50' } } },
    ] })
    const upserted = runLine(updated.sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name HTTP-REQUESTS --scale-rule-type http --scale-rule-http-concurrency 75')
    expect(upserted.sandbox.containerApps[0].scaleRules).toHaveLength(2)
    expect(upserted.sandbox.containerApps[0].scaleRules[1]).toMatchObject({ name: 'http-requests', http: { metadata: { concurrentRequests: '75' } } })
  })

  it('defaults a named scale rule to HTTP concurrency 10', () => {
    const updated = runLine(withApp(), 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name default-http')
    expect(err(updated)).toBe('')
    expect(updated.sandbox.containerApps[0].scaleRules).toEqual([{ name: 'default-http', http: { metadata: { concurrentRequests: '10' } } }])
    expect(err(runLine(withApp(), 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-type http'))).toContain('--scale-rule-name')
    expect(out(runLine(createSandbox(), 'az containerapp update --help'))).toContain('Default: http')
  })

  it('resolves an environment ID across resource groups and rejects deletion while it is in use', () => {
    let sandbox = withEnvironment()
    sandbox = runLine(sandbox, 'az group create -n rg-apps -l northeurope').sandbox
    const created = runLine(sandbox, `az containerapp create -g rg-apps -n ca-contoso-api --environment ${ENV_ID} --image mcr.microsoft.com/k8se/quickstart:latest`)
    expect(err(created)).toBe('')
    expect(created.sandbox.containerApps[0]).toMatchObject({ resourceGroup: 'rg-apps', environment: 'env-contoso', environmentResourceGroup: 'rg-containerapps', location: 'westeurope' })
    expect(err(runLine(created.sandbox, 'az containerapp env delete -g rg-containerapps -n env-contoso --yes'))).toContain('cannot be deleted while it is used')
    expect(err(runLine(created.sandbox, 'az group delete -n rg-containerapps --yes'))).toContain('is used by')
    const removed = runLine(created.sandbox, 'az containerapp delete -g rg-apps -n ca-contoso-api --yes')
    expect(err(removed)).toBe('')
    expect(runLine(removed.sandbox, 'az group delete -n rg-containerapps --yes').sandbox.containerAppEnvironments).toEqual([])
  })

  it('requires a Sandbox subscription ID in environment resource IDs', () => {
    const foreignId = ENV_ID.replace('7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37', '00000000-0000-0000-0000-000000000000')
    const result = runLine(withEnvironment(), `az containerapp create -g rg-containerapps -n ca-contoso-api --environment ${foreignId} --image image`)
    expect(err(result)).toContain('subscription')
    expect(result.sandbox.containerApps).toEqual([])
  })

  it('accepts valid short app names and rejects 32-character or double-hyphen app names', () => {
    const environment = withEnvironment()
    expect(err(runLine(environment, 'az containerapp create -g rg-containerapps -n a --environment env-contoso --image image'))).toBe('')
    expect(err(runLine(environment, `az containerapp create -g rg-containerapps -n ${'a'.repeat(32)} --environment env-contoso --image image`))).toContain('container app name')
    expect(err(runLine(environment, 'az containerapp create -g rg-containerapps -n ca--api --environment env-contoso --image image'))).toContain('container app name')
  })

  it('preserves an existing environment location and prevents app environment moves', () => {
    let sandbox = runLine(createSandbox(), 'az group create -n rg-check -l westeurope').sandbox
    sandbox = runLine(sandbox, 'az containerapp env create -g rg-check -n env-check -l northeurope').sandbox
    sandbox = runLine(sandbox, 'az containerapp create -g rg-check -n ca-check --environment env-check --image image').sandbox
    const retagged = runLine(sandbox, 'az containerapp env create -g rg-check -n env-check --tags owner=review')
    expect(err(retagged)).toBe('')
    expect(retagged.sandbox.containerAppEnvironments[0]).toMatchObject({ location: 'northeurope', tags: { owner: 'review' } })
    expect(retagged.sandbox.containerApps[0].location).toBe('northeurope')

    const conflictingLocation = runLine(retagged.sandbox, 'az containerapp env create -g rg-check -n env-check -l westeurope')
    expect(err(conflictingLocation)).toContain('cannot be changed')
    expect(conflictingLocation.sandbox).toBe(retagged.sandbox)

    const withSecondEnvironment = runLine(retagged.sandbox, 'az containerapp env create -g rg-check -n env-other').sandbox
    const moved = runLine(withSecondEnvironment, 'az containerapp create -g rg-check -n ca-check --environment env-other --image image:v2')
    expect(err(moved)).toContain('cannot be changed')
    expect(moved.sandbox).toBe(withSecondEnvironment)
    expect(moved.sandbox.containerApps[0]).toMatchObject({ environment: 'env-check', image: 'image' })
  })

  it('checks every environment before cascading a resource group and cascades same-group apps', () => {
    let sandbox = runLine(createSandbox(), 'az group create -n rg-containerapps -l westeurope').sandbox
    sandbox = runLine(sandbox, 'az containerapp env create -g rg-containerapps -n env-unused').sandbox
    sandbox = runLine(sandbox, 'az containerapp env create -g rg-containerapps -n env-host').sandbox
    sandbox = runLine(sandbox, 'az group create -n rg-apps -l northeurope').sandbox
    sandbox = runLine(sandbox, `az containerapp create -g rg-apps -n ca-cross-group --environment /subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-containerapps/providers/Microsoft.App/managedEnvironments/env-host --image image`).sandbox
    const blocked = runLine(sandbox, 'az group delete -n rg-containerapps --yes')
    expect(err(blocked)).toContain('ca-cross-group')
    expect(blocked.sandbox).toBe(sandbox)

    let contained = runLine(createSandbox(), 'az group create -n rg-contained -l westeurope').sandbox
    contained = runLine(contained, 'az containerapp env create -g rg-contained -n env-contained').sandbox
    contained = runLine(contained, 'az containerapp create -g rg-contained -n ca-contained --environment env-contained --image image').sandbox
    const deleted = runLine(contained, 'az group delete -n rg-contained --yes')
    expect(deleted.sandbox).toMatchObject({ resourceGroups: [], containerAppEnvironments: [], containerApps: [] })
  })

  it('rejects invalid updates atomically and reports unsupported arguments or rule types', () => {
    const sandbox = withApp()
    const invalidMax = runLine(sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --max-replicas 0')
    expect(err(invalidMax)).toContain('max replicas')
    expect(invalidMax.sandbox).toBe(sandbox)
    expect(invalidMax.sandbox.containerApps[0]).toMatchObject({ minReplicas: 0, maxReplicas: 10 })
    expect(err(runLine(sandbox, 'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name queue --scale-rule-type azure-queue --scale-rule-http-concurrency 10'))).toContain('Only HTTP scale rules are supported')
    expect(err(runLine(sandbox, 'az containerapp create -g rg-containerapps -n ca-other --environment env-contoso --image image --cpu 1'))).toContain('unrecognized arguments: --cpu 1')
  })

  it('supports groups and commands help plus required parent failures', () => {
    expect(out(runLine(createSandbox(), 'az containerapp --help'))).toContain('env')
    expect(out(runLine(createSandbox(), 'az containerapp create --help'))).toContain('--scale-rule-http-concurrency')
    expect(err(runLine(createSandbox(), 'az containerapp env create -g missing -n env-contoso'))).toContain("Resource group 'missing' could not be found")
    expect(err(runLine(createSandbox(), 'az containerapp create -g missing -n ca-contoso-api --environment env-contoso --image image'))).toContain("Resource group 'missing' could not be found")
  })
})

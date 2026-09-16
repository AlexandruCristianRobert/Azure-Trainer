import { describe, expect, it } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

function out(r) { return r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n') }
function err(r) { return r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n') }

describe('shell dispatcher', () => {
  it('clear, blank, unknown commands', () => {
    const sb = createSandbox()
    expect(runLine(sb, 'clear').clear).toBe(true)
    expect(runLine(sb, '   ').lines).toEqual([])
    expect(err(runLine(sb, 'kubectl get pods'))).toBe('bash: kubectl: command not found')
    expect(err(runLine(sb, 'az group create --name "oops'))).toBe("bash: unexpected EOF while looking for matching `\"'")
  })
  it('bare az prints the banner and base commands', () => {
    const r = runLine(createSandbox(), 'az')
    expect(out(r)).toContain('Welcome to the cool new Azure CLI!')
    expect(out(r)).toContain('group')
    expect(out(r)).toContain('servicebus')
  })
  it('az --version / az version', () => {
    expect(out(runLine(createSandbox(), 'az --version'))).toContain('azure-cli')
    expect(JSON.parse(out(runLine(createSandbox(), 'az version')))['azure-cli']).toBe('2.78.0')
  })
  it('unknown group / command wording with suggestion', () => {
    expect(err(runLine(createSandbox(), 'az servicebus quene create'))).toBe("'quene' is misspelled or not recognized by the system.\nThe most similar choice to 'quene' is:\n        queue")
    expect(err(runLine(createSandbox(), 'az frobnicate'))).toBe("'frobnicate' is misspelled or not recognized by the system.")
  })
  it('group help and command help', () => {
    expect(out(runLine(createSandbox(), 'az group --help'))).toContain('Group\n    az group : Manage resource groups and template deployments.')
    expect(out(runLine(createSandbox(), 'az group create -h'))).toContain('Command\n    az group create : Create a new resource group.')
    expect(out(runLine(createSandbox(), 'az servicebus'))).toContain('Group\n    az servicebus')
  })
})

describe('az account / configure / login', () => {
  it('account show returns the Sandbox subscription', () => {
    const r = runLine(createSandbox(), 'az account show')
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ id: SUBSCRIPTION_ID, name: 'Sandbox', state: 'Enabled', isDefault: true })
    expect(JSON.parse(out(runLine(createSandbox(), 'az account list')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(createSandbox(), 'az login')))).toHaveLength(1)
  })
  it('configure defaults', () => {
    let sb = createSandbox()
    const r = runLine(sb, 'az configure --defaults group=rg-orders location=westeurope')
    expect(r.lines).toEqual([])
    sb = r.sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: 'westeurope' })
    expect(JSON.parse(out(runLine(sb, 'az configure --list-defaults')))).toEqual([{ name: 'group', source: 'sandbox', value: 'rg-orders' }, { name: 'location', source: 'sandbox', value: 'westeurope' }])
    expect(err(runLine(sb, 'az configure'))).toContain('interactive')
  })
})

describe('az group', () => {
  it('create → sorted JSON, event, latency', () => {
    const r = runLine(createSandbox(), 'az group create --name rg-orders --location westeurope')
    expect(r.latencyMs).toBe(800)
    expect(r.events).toEqual([{ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }])
    const j = JSON.parse(out(r))
    expect(j).toEqual({ id: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-orders`, location: 'westeurope', managedBy: null, name: 'rg-orders', properties: { provisioningState: 'Succeeded' }, tags: null, type: 'Microsoft.Resources/resourceGroups' })
    expect(out(r).split('\n')[1]).toBe(`  "id": "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-orders",`)
  })
  it('accepts -g as alias for --name and "West Europe"', () => {
    const r = runLine(createSandbox(), 'az group create -g rg-orders -l "West Europe"')
    expect(err(r)).toBe('')
    expect(r.sandbox.resourceGroups[0].location).toBe('westeurope')
  })
  it('missing args and ARM errors are formatted like az', () => {
    expect(err(runLine(createSandbox(), 'az group create --name rg-orders'))).toBe('the following arguments are required: --location/-l')
    expect(err(runLine(createSandbox(), 'az group show --name rg-x'))).toBe("(ResourceGroupNotFound) Resource group 'rg-x' could not be found.\nCode: ResourceGroupNotFound\nMessage: Resource group 'rg-x' could not be found.")
  })
  it('show / list / exists / delete', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(JSON.parse(out(runLine(sb, 'az group show -n rg-orders'))).name).toBe('rg-orders')
    expect(JSON.parse(out(runLine(sb, 'az group list')))).toHaveLength(1)
    expect(out(runLine(sb, 'az group exists -n rg-orders'))).toBe('true')
    expect(out(runLine(sb, 'az group exists -n nope'))).toBe('false')
    expect(err(runLine(sb, 'az group delete -n rg-orders'))).toBe('Operation cancelled. Pass --yes to confirm deletion in the Sandbox.')
    const r = runLine(sb, 'az group delete -n rg-orders --yes')
    expect(r.lines).toEqual([])
    expect(r.sandbox.resourceGroups).toHaveLength(0)
    expect(r.events).toEqual([{ type: 'deleted', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }])
  })
  it('delete events carry the canonical stored casing, not the user-typed casing', () => {
    const sb = runLine(createSandbox(), 'az group create -n RG-Orders -l westeurope').sandbox
    const r = runLine(sb, 'az group delete -n rg-orders --yes')
    expect(r.events).toEqual([{ type: 'deleted', resourceType: 'resourceGroup', name: 'RG-Orders', resourceGroup: 'RG-Orders' }])
  })
  it('re-create on an existing group emits updated, not created', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    const r = runLine(sb, 'az group create -n rg-orders -l northeurope')
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }])
    expect(JSON.parse(out(r)).location).toBe('northeurope')
  })
  it('honours the configured default group on show', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    sb = runLine(sb, 'az configure --defaults group=rg-orders').sandbox
    const r = runLine(sb, 'az group show')
    expect(JSON.parse(out(r)).name).toBe('rg-orders')
  })
})

describe('global arguments (Controller Ruling AA)', () => {
  it('-o json / jsonc are accepted no-ops; other formats are rejected', () => {
    const sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(out(runLine(sb, 'az group list -o json'))).toBe(out(runLine(sb, 'az group list')))
    expect(err(runLine(sb, 'az group list -o table'))).toBe("argument --output/-o: only 'json' is available in the Sandbox Cloud Shell.")
  })
  it('--query is not available in the Sandbox Cloud Shell', () => {
    const sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(err(runLine(sb, 'az group list --query name'))).toBe('--query is not available in the Sandbox Cloud Shell.')
  })
  it('--verbose --debug --only-show-errors are accepted no-ops', () => {
    const sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    const r = runLine(sb, 'az group list --verbose --debug --only-show-errors')
    expect(err(r)).toBe('')
    expect(JSON.parse(out(r))).toHaveLength(1)
  })
  it('--subscription accepts the Sandbox id/name and rejects anything else', () => {
    expect(err(runLine(createSandbox(), 'az account show --subscription Sandbox'))).toBe('')
    expect(err(runLine(createSandbox(), `az account show --subscription ${SUBSCRIPTION_ID}`))).toBe('')
    expect(err(runLine(createSandbox(), 'az account show --subscription nope'))).toBe("The subscription of 'nope' doesn't exist in cloud 'AzureCloud'.")
  })
})

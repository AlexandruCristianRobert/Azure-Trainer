import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
const withGroup = () => runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox

describe('az servicebus namespace', () => {
  it('create with defaults', () => {
    const r = runLine(withGroup(), 'az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders')
    expect(err(r)).toBe('')
    expect(r.latencyMs).toBe(2500)
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ name: 'sb-contoso-orders', location: 'westeurope', resourceGroup: 'rg-orders', sku: { name: 'Standard', tier: 'Standard' }, serviceBusEndpoint: 'https://sb-contoso-orders.servicebus.windows.net:443/', status: 'Active' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }])
  })
  it('create with --sku and --location, invalid sku', () => {
    const r = runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic -l northeurope')
    expect(JSON.parse(out(r))).toMatchObject({ sku: { name: 'Basic' }, location: 'northeurope' })
    expect(err(runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Gold'))).toBe("argument --sku: invalid choice: 'Gold' (choose from 'Basic', 'Premium', 'Standard')")
  })
  it('uses the configured default group', () => {
    let sb = withGroup()
    sb = runLine(sb, 'az configure --defaults group=rg-orders').sandbox
    const r = runLine(sb, 'az servicebus namespace create -n sb-contoso-orders')
    expect(err(r)).toBe('')
    expect(r.sandbox.namespaces[0].resourceGroup).toBe('rg-orders')
  })
  it('requires args and reports missing group', () => {
    expect(err(runLine(withGroup(), 'az servicebus namespace create -n sb-contoso-orders'))).toBe('the following arguments are required: --resource-group/-g')
    expect(err(runLine(withGroup(), 'az servicebus namespace create -g rg-x -n sb-contoso-orders'))).toContain("(ResourceGroupNotFound) Resource group 'rg-x' could not be found.")
  })
  it('show / list / exists / update / delete', () => {
    let sb = runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic').sandbox
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace show -g rg-orders -n sb-contoso-orders'))).name).toBe('sb-contoso-orders')
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace list')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace list -g rg-orders')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace exists -n sb-contoso-orders')))).toEqual({ message: null, nameAvailable: false, reason: 'NameInUse' })
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace exists -n sb-other-name')))).toEqual({ message: null, nameAvailable: true, reason: null })
    const u = runLine(sb, 'az servicebus namespace update -g rg-orders -n sb-contoso-orders --sku Standard')
    expect(JSON.parse(out(u)).sku.name).toBe('Standard')
    expect(u.events).toEqual([{ type: 'updated', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }])
    const d = runLine(u.sandbox, 'az servicebus namespace delete -g rg-orders -n sb-contoso-orders')
    expect(d.lines).toEqual([])
    expect(d.sandbox.namespaces).toHaveLength(0)
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'namespace' })
  })
  it('has help', () => {
    expect(out(runLine(createSandbox(), 'az servicebus namespace create --help'))).toContain('--sku')
  })
  it('re-create on an existing namespace emits updated, not created', () => {
    let sb = runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders').sandbox
    const r = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Premium')
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }])
    expect(JSON.parse(out(r)).sku.name).toBe('Premium')
  })
})

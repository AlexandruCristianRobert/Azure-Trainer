import { describe, expect, it } from 'vitest'
import { resolveBlade } from '../src/lib/bladeResolve.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const LIST = { kind: 'resource-groups' }
const RG = { kind: 'resource-group', name: 'rg-orders' }
const NS = { kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders', tab: 'topics' }

describe('resolveBlade', () => {
  it('keeps blades whose target exists', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders').sandbox
    expect(resolveBlade(NS, sb)).toEqual(NS)
    expect(resolveBlade(RG, sb)).toEqual(RG)
    expect(resolveBlade(LIST, sb)).toEqual(LIST)
  })
  it('falls back to the parent when the target is gone', () => {
    const sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(resolveBlade(NS, sb)).toEqual(RG)
    expect(resolveBlade(RG, createSandbox())).toEqual(LIST)
    expect(resolveBlade(NS, createSandbox())).toEqual(LIST)
  })
  it('defaults the namespace tab to queues', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders').sandbox
    expect(resolveBlade({ kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders' }, sb).tab).toBe('queues')
  })
})

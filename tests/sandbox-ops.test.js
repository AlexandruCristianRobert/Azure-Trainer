import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { AzError } from '../src/lib/sandbox/errors.js'
import * as ops from '../src/lib/sandbox/ops.js'

function withNamespace(sku = 'Standard') {
  let sb = createSandbox()
  sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
  sb = ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku }).sandbox
  return sb
}

describe('resource groups', () => {
  it('creates a group and does not mutate the input', () => {
    const sb0 = createSandbox()
    const { sandbox, resource } = ops.createResourceGroup(sb0, { name: 'rg-orders', location: 'West Europe' })
    expect(sb0.resourceGroups).toHaveLength(0)
    expect(sandbox.resourceGroups).toHaveLength(1)
    expect(resource).toMatchObject({ name: 'rg-orders', location: 'westeurope', tags: null })
    expect(typeof resource.createdAt).toBe('string')
  })
  it('is idempotent on re-create (PUT semantics) and updates location', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'northeurope', tags: { env: 'dev' } }).sandbox
    expect(sb.resourceGroups).toHaveLength(1)
    expect(sb.resourceGroups[0]).toMatchObject({ location: 'northeurope', tags: { env: 'dev' } })
  })
  it('rejects unknown locations with an ARM error', () => {
    expect(() => ops.createResourceGroup(createSandbox(), { name: 'rg', location: 'marsnorth' })).toThrow(AzError)
    try { ops.createResourceGroup(createSandbox(), { name: 'rg', location: 'marsnorth' }) } catch (e) {
      expect(e.code).toBe('LocationNotAvailableForResourceGroup')
      expect(e.kind).toBe('arm')
    }
  })
  it('rejects invalid names', () => {
    expect(() => ops.createResourceGroup(createSandbox(), { name: 'bad name!', location: 'westeurope' })).toThrow(/ResourceGroupNotValid|invalid/i)
  })
  it('getResourceGroup throws ResourceGroupNotFound', () => {
    try { ops.getResourceGroup(createSandbox(), 'rg-x'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceGroupNotFound')
      expect(e.message).toBe("Resource group 'rg-x' could not be found.")
    }
  })
  it('deletes a group with everything inside it', () => {
    let sb = withNamespace()
    sb = ops.deleteResourceGroup(sb, { name: 'rg-orders' }).sandbox
    expect(sb.resourceGroups).toHaveLength(0)
    expect(sb.namespaces).toHaveLength(0)
  })
})

describe('namespaces', () => {
  it('creates with Standard default sku and the group location', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    const { resource } = ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders' })
    expect(resource).toMatchObject({ name: 'sb-contoso-orders', resourceGroup: 'rg-orders', location: 'westeurope', sku: 'Standard', queues: [], topics: [] })
  })
  it('requires the group to exist', () => {
    try { ops.createNamespace(createSandbox(), { resourceGroup: 'rg-x', name: 'sb-abcdef' }); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceGroupNotFound')
    }
  })
  it('validates the namespace name', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'ab' })).toThrow(/namespace is invalid/)
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: '1abcdef' })).toThrow(/namespace is invalid/)
  })
  it('rejects unknown sku', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku: 'Gold' })).toThrow(/sku/i)
  })
  it('updates sku and looks up by group + name', () => {
    let sb = withNamespace('Basic')
    sb = ops.updateNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku: 'Standard' }).sandbox
    expect(ops.getNamespace(sb, 'rg-orders', 'sb-contoso-orders').sku).toBe('Standard')
    try { ops.getNamespace(sb, 'rg-orders', 'sb-nope'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceNotFound')
      expect(e.message).toContain("'Microsoft.ServiceBus/namespaces/sb-nope' under resource group 'rg-orders' was not found")
    }
  })
  it('lists namespaces, optionally by group', () => {
    let sb = withNamespace()
    sb = ops.createResourceGroup(sb, { name: 'rg-two', location: 'eastus' }).sandbox
    sb = ops.createNamespace(sb, { resourceGroup: 'rg-two', name: 'sb-second-ns' }).sandbox
    expect(ops.listNamespaces(sb)).toHaveLength(2)
    expect(ops.listNamespaces(sb, 'rg-two')).toHaveLength(1)
  })
})

describe('queues', () => {
  it('creates with az defaults and applies overrides', () => {
    const sb = withNamespace()
    const { resource } = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
    expect(resource).toMatchObject({ name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, lockDuration: 'PT1M', maxSizeInMegabytes: 1024, status: 'Active', requiresSession: false })
  })
  it('update keeps unspecified properties', () => {
    let sb = withNamespace()
    sb = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', maxDeliveryCount: 5 }).sandbox
    sb = ops.updateQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', deadLetteringOnMessageExpiration: true }).sandbox
    expect(ops.getQueue(sb, 'rg-orders', 'sb-contoso-orders', 'orders')).toMatchObject({ maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
  })
  it('delete and list', () => {
    let sb = withNamespace()
    sb = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders' }).sandbox
    expect(ops.listQueues(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(1)
    sb = ops.deleteQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders' }).sandbox
    expect(ops.listQueues(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(0)
    try { ops.getQueue(sb, 'rg-orders', 'sb-contoso-orders', 'orders'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('NotFound')
    }
  })
})

describe('topics, subscriptions, rules', () => {
  it('refuses topics on Basic tier with the az wording', () => {
    const sb = withNamespace('Basic')
    try { ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('BadRequest')
      expect(e.message).toBe("SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.")
    }
  })
  it('creates topic, subscription with $Default rule, then a custom rule', () => {
    let sb = withNamespace()
    sb = ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    sb = ops.createSubscription(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', name: 'eu-orders' }).sandbox
    const sub = ops.getSubscription(sb, 'rg-orders', 'sb-contoso-orders', 'order-events', 'eu-orders')
    expect(sub.rules).toEqual([expect.objectContaining({ name: '$Default', filterType: 'SqlFilter', sqlExpression: '1=1' })])
    sb = ops.createRule(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders', name: 'eu-filter', sqlExpression: "region = 'EU'" }).sandbox
    sb = ops.deleteRule(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders', name: '$Default' }).sandbox
    const rules = ops.listRules(sb, 'rg-orders', 'sb-contoso-orders', 'order-events', 'eu-orders')
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: 'eu-filter', filterType: 'SqlFilter', sqlExpression: "region = 'EU'" })
  })
  it('topic/subscription/rule lookups throw NotFound with the entity path', () => {
    const sb = withNamespace()
    try { ops.getTopic(sb, 'rg-orders', 'sb-contoso-orders', 'nope'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('NotFound')
      expect(e.message).toContain("Entity 'sb-contoso-orders:Topic:nope' was not found")
    }
  })
  it('deleting a topic removes its subscriptions; deleting a namespace removes entities', () => {
    let sb = withNamespace()
    sb = ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    sb = ops.createSubscription(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', name: 'eu-orders' }).sandbox
    sb = ops.deleteTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    expect(ops.listTopics(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(0)
    sb = ops.deleteNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders' }).sandbox
    expect(sb.namespaces).toHaveLength(0)
  })
})

describe('defaults', () => {
  it('stores az configure defaults', () => {
    let sb = createSandbox()
    sb = ops.setDefaults(sb, { group: 'rg-orders' }).sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: null })
    sb = ops.setDefaults(sb, { location: 'westeurope' }).sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: 'westeurope' })
  })
})

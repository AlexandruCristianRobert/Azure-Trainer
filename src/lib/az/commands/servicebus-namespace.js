import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentNamespace } from '../arm.js'

const NAME = ARG.name('Name of Namespace.')
const SKU = { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['Basic', 'Premium', 'Standard'], dest: 'sku', help: 'Namespace SKU.', defaultValue: 'Standard' }
const CAPACITY = { name: '--capacity', aliases: [], required: false, kind: 'int', dest: 'capacity', help: 'Number of message units. This property is only applicable to namespaces of Premium SKU.' }

const nsEvent = (type, ns) => event(type, 'namespace', { name: ns.name, resourceGroup: ns.resourceGroup })

export const namespaceGroup = defineGroup(['servicebus', 'namespace'], 'Manage Azure Service Bus Namespace.', {
  create: defineCommand(['servicebus', 'namespace', 'create'], 'Create a Service Bus Namespace.', {
    latencyMs: LATENCY.namespace,
    args: [NAME, ARG.resourceGroup, ARG.location(false), SKU, CAPACITY, ARG.tags],
    examples: [{ summary: 'Create a Service Bus Namespace.', command: 'az servicebus namespace create --resource-group myresourcegroup --name mynamespace --location westus --tags tag1=value1 tag2=value2 --sku Standard' }],
    run: ({ sandbox }, v) => {
      const existed = sandbox.namespaces.some((n) => n.resourceGroup.toLowerCase() === v.resourceGroup.toLowerCase() && n.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name, location: v.location, sku: v.sku ?? 'Standard', tags: v.tags ?? null })
      return { sandbox: next, output: presentNamespace(resource), events: [nsEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['servicebus', 'namespace', 'show'], 'Get a description for the specified namespace.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, v) => ({ sandbox, output: presentNamespace(ops.getNamespace(sandbox, v.resourceGroup, v.name)) }),
  }),
  list: defineCommand(['servicebus', 'namespace', 'list'], 'List all the available namespaces within the subscription by resource group & default.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, v) => ({ sandbox, output: ops.listNamespaces(sandbox, v.resourceGroup ?? null).map(presentNamespace) }),
  }),
  exists: defineCommand(['servicebus', 'namespace', 'exists'], 'Check the give namespace name availability.', {
    args: [NAME],
    run: ({ sandbox }, v) => {
      const taken = sandbox.namespaces.some((n) => n.name.toLowerCase() === v.name.toLowerCase())
      return { sandbox, output: taken ? { message: null, nameAvailable: false, reason: 'NameInUse' } : { message: null, nameAvailable: true, reason: null } }
    },
  }),
  update: defineCommand(['servicebus', 'namespace', 'update'], 'Update a service namespace.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.resourceGroup, SKU, CAPACITY, ARG.tags],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.updateNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name, sku: v.sku, tags: v.tags })
      return { sandbox: next, output: presentNamespace(resource), events: [nsEvent('updated', resource)] }
    },
  }),
  delete: defineCommand(['servicebus', 'namespace', 'delete'], 'Delete an existing namespace. This operation also removes all associated resources under the namespace.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.resourceGroup, ARG.noWait],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.name)
      const { sandbox: next } = ops.deleteNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name })
      return { sandbox: next, output: null, events: [nsEvent('deleted', ns)] }
    },
  }),
})

import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentResourceGroup } from '../arm.js'
import { AzError } from '../../sandbox/errors.js'

const GROUP_NAME = { name: '--name', aliases: ['-n', '--resource-group', '-g'], required: true, kind: 'string', dest: 'name', defaultsKey: 'group', help: 'Name of the new resource group.' }

export const groupGroup = defineGroup(['group'], 'Manage resource groups and template deployments.', {
  create: defineCommand(['group', 'create'], 'Create a new resource group.', {
    latencyMs: LATENCY.group,
    args: [GROUP_NAME, ARG.location(true), ARG.tags],
    examples: [{ summary: 'Create a new resource group in the West US region.', command: 'az group create -l westus -n MyResourceGroup' }],
    run: ({ sandbox }, v) => {
      const existed = sandbox.resourceGroups.some((g) => g.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createResourceGroup(sandbox, { name: v.name, location: v.location, tags: v.tags ?? null })
      return { sandbox: next, output: presentResourceGroup(resource), events: [event(existed ? 'updated' : 'created', 'resourceGroup', { name: resource.name, resourceGroup: resource.name })] }
    },
  }),
  show: defineCommand(['group', 'show'], 'Gets a resource group.', {
    args: [GROUP_NAME],
    run: ({ sandbox }, v) => ({ sandbox, output: presentResourceGroup(ops.getResourceGroup(sandbox, v.name)) }),
  }),
  list: defineCommand(['group', 'list'], 'List resource groups.', {
    run: ({ sandbox }) => ({ sandbox, output: ops.listResourceGroups(sandbox).map(presentResourceGroup) }),
  }),
  exists: defineCommand(['group', 'exists'], 'Check the existence of a resource group.', {
    args: [GROUP_NAME],
    run: ({ sandbox }, v) => ({ sandbox, output: sandbox.resourceGroups.some((g) => g.name.toLowerCase() === v.name.toLowerCase()) ? 'true' : 'false' }),
  }),
  delete: defineCommand(['group', 'delete'], 'Delete a resource group.', {
    latencyMs: LATENCY.mutate,
    args: [GROUP_NAME, ARG.yes, ARG.noWait],
    run: ({ sandbox }, v) => {
      const g = ops.getResourceGroup(sandbox, v.name)
      if (!v.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
      const registryIds = (sandbox.containerRegistries ?? []).filter((registry) => registry.resourceGroup.toLowerCase() === g.name.toLowerCase()).map((registry) => registry.id)
      const { sandbox: next } = ops.deleteResourceGroup(sandbox, { name: v.name })
      return { sandbox: next, output: null, events: [event('deleted', 'resourceGroup', { name: g.name, resourceGroup: g.name })], ...(registryIds.length ? { effects: [{ type: 'delete-registry-publications', registryIds }] } : {}) }
    },
  }),
})

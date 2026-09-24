import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as identities from '../../sandbox/identity.js'
import { presentIdentity } from '../registry-arm.js'
import { AzError } from '../../sandbox/errors.js'

const NAME = ARG.name('Name of the user-assigned managed identity.')
const identityEvent = (type, identity) => event(type, 'managedIdentity', { name: identity.name, resourceGroup: identity.resourceGroup })

export const identityGroup = defineGroup(['identity'], 'Manage simulated user-assigned managed identities.', {
  create: defineCommand(['identity', 'create'], 'Create a user-assigned managed identity.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(false), ARG.tags],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, existed } = identities.createIdentity(sandbox, values)
      return { sandbox: next, output: presentIdentity(resource), events: [identityEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['identity', 'show'], 'Show a user-assigned managed identity.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentIdentity(identities.getIdentity(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['identity', 'list'], 'List user-assigned managed identities.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: identities.listIdentities(sandbox, values.resourceGroup ?? null).map(presentIdentity) }),
  }),
  delete: defineCommand(['identity', 'delete'], 'Delete a managed identity and its role assignments; existing deployments keep captured images.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
      const { sandbox: next, resource } = identities.deleteIdentity(sandbox, values)
      return { sandbox: next, output: null, events: [identityEvent('deleted', resource)] }
    },
  }),
})

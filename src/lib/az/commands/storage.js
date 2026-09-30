import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as functions from '../../sandbox/functions.js'
import { AzError } from '../../sandbox/errors.js'
import { presentStorageAccount } from '../functions-arm.js'

const NAME = ARG.name('Name of the storage account.')
const SKU = { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['Standard_LRS', 'Standard_ZRS'], dest: 'sku', help: 'Storage account SKU.', defaultValue: 'Standard_LRS' }
const KIND = { name: '--kind', aliases: [], required: false, kind: 'string', choices: ['StorageV2'], dest: 'kind', help: 'Storage account kind.', defaultValue: 'StorageV2' }
const storageEvent = (type, account) => event(type, 'storageAccount', { name: account.name, resourceGroup: account.resourceGroup })

function requireYes(values) {
  if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
}

const accountGroup = defineGroup(['storage', 'account'], 'Manage storage accounts.', {
  create: defineCommand(['storage', 'account', 'create'], 'Create a storage account.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(false), SKU, KIND, ARG.tags],
    run: ({ sandbox }, values) => {
      const existing = sandbox.storageAccounts.find((account) => account.name.toLowerCase() === String(values.name).toLowerCase())
      const { sandbox: next, resource } = functions.createStorageAccount(sandbox, values)
      return { sandbox: next, output: presentStorageAccount(resource), events: [storageEvent(existing ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['storage', 'account', 'show'], 'Show a storage account.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentStorageAccount(functions.getStorageAccount(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['storage', 'account', 'list'], 'List storage accounts.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: functions.listStorageAccounts(sandbox, values.resourceGroup ?? null).map(presentStorageAccount) }),
  }),
  delete: defineCommand(['storage', 'account', 'delete'], 'Delete a storage account.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const { sandbox: next, resource } = functions.deleteStorageAccount(sandbox, values)
      return { sandbox: next, output: null, events: [storageEvent('deleted', resource)] }
    },
  }),
})

export const storageGroup = defineGroup(['storage'], 'Manage Azure Storage resources.', { account: accountGroup })

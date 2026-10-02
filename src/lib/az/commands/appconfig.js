import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as config from '../../sandbox/appconfiguration.js'
import { presentAppConfiguration, presentAppConfigurationValue } from '../appconfiguration-arm.js'
import { AzError } from '../../sandbox/errors.js'

const NAME = ARG.name('Name of the App Configuration store.')
const option = (name, dest, required = false) => ({ name: `--${name}`, aliases: [], required, kind: 'string', dest, help: `Exact ${name}.` })
const KEY = option('key', 'key', true)
const LABEL = option('label', 'label')
const VALUE = option('value', 'value', true)
const CONTENT_TYPE = option('content-type', 'contentType')
const SECRET = option('secret-identifier', 'secretIdentifier', true)
const configEvent = (store, type = 'updated') => event(type, 'appConfiguration', { name: store.name, resourceGroup: store.resourceGroup })
const setCommand = (command, fields) => defineCommand(['appconfig', 'kv', command], 'Set a bounded setting or Key Vault reference.', {
  latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroupOptional, KEY, LABEL, ...fields, ARG.yes],
  run: ({ sandbox }, values) => {
    if (!values.yes) throw new AzError('Cancelled', 'Pass --yes to write a setting in the Sandbox.', { kind: 'cli' })
    const { sandbox: next, resource } = config.setAppConfigurationValue(sandbox, values)
    return { sandbox: next, output: presentAppConfigurationValue(resource), events: [configEvent(config.getAppConfiguration(next, values.resourceGroup, values.name))] }
  },
})
export const appconfigGroup = defineGroup(['appconfig'], 'Manage bounded App Configuration stores.', {
  create: defineCommand(['appconfig', 'create'], 'Create an App Configuration store.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(false), ARG.tags,
      { ...option('sku', 'sku'), choices: ['Free', 'Standard'], defaultValue: 'Free' }],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, existed } = config.createAppConfiguration(sandbox, values)
      return { sandbox: next, output: presentAppConfiguration(resource), events: [configEvent(resource, existed ? 'updated' : 'created')] }
    },
  }),
  show: defineCommand(['appconfig', 'show'], 'Show an App Configuration store.', {
    args: [NAME, ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: presentAppConfiguration(config.getAppConfiguration(sandbox, values.resourceGroup, values.name)) }),
  }),
  kv: defineGroup(['appconfig', 'kv'], 'Manage labeled configuration values.', {
    set: setCommand('set', [VALUE, CONTENT_TYPE]),
    'set-keyvault': setCommand('set-keyvault', [SECRET]),
    show: defineCommand(['appconfig', 'kv', 'show'], 'Show an exact labeled setting.', {
      args: [NAME, ARG.resourceGroupOptional, KEY, LABEL],
      run: ({ sandbox }, values) => {
        const settings = config.listAppConfigurationValues(sandbox, values)
        if (!settings.length) throw new AzError('KeyNotFound', 'The exact labeled setting was not found.')
        return { sandbox, output: presentAppConfigurationValue(settings[0]) }
      },
    }),
    list: defineCommand(['appconfig', 'kv', 'list'], 'List settings at an exact label.', {
      args: [NAME, ARG.resourceGroupOptional, LABEL],
      run: ({ sandbox }, values) => ({ sandbox, output: config.listAppConfigurationValues(sandbox, values).map(presentAppConfigurationValue) }),
    }),
  }),
})

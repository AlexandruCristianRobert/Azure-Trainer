import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as functions from '../../sandbox/functions.js'
import { presentAppSettings, presentCors, presentFunctionApp } from '../functions-arm.js'

const NAME = ARG.name('Name of the Function App.')
const STORAGE_ACCOUNT = { name: '--storage-account', aliases: [], required: true, kind: 'string', dest: 'storageAccount', help: 'Name of the storage account used by the Function App.' }
const FLEX_LOCATION = { name: '--flexconsumption-location', aliases: [], required: true, kind: 'string', dest: 'flexconsumptionLocation', help: 'Location for the Flex Consumption Function App.' }
const RUNTIME = { name: '--runtime', aliases: [], required: true, kind: 'string', choices: ['node', 'python'], dest: 'runtime', help: 'Function runtime.' }
const RUNTIME_VERSION = { name: '--runtime-version', aliases: [], required: true, kind: 'string', choices: ['22', '3.12'], dest: 'runtimeVersion', help: 'Function runtime version.' }
const FUNCTIONS_VERSION = { name: '--functions-version', aliases: [], required: false, kind: 'string', choices: ['4'], dest: 'functionsVersion', help: 'Azure Functions version.', defaultValue: '4' }
const OS_TYPE = { name: '--os-type', aliases: [], required: false, kind: 'string', choices: ['Linux'], dest: 'osType', help: 'Operating system for Flex Consumption.', defaultValue: 'Linux' }
const SETTINGS = { name: '--settings', aliases: [], required: true, kind: 'raw', dest: 'settings', help: 'One or more custom KEY=VALUE application settings.' }
const SETTING_NAMES = { name: '--setting-names', aliases: [], required: true, kind: 'raw', dest: 'settingNames', help: 'One or more custom application setting names.' }
const ALLOWED_ORIGINS = { name: '--allowed-origins', aliases: ['-a'], required: false, kind: 'raw', dest: 'allowedOrigins', help: 'Space-separated CORS origins.' }
const functionAppEvent = (type, app) => event(type, 'functionApp', { name: app.name, resourceGroup: app.resourceGroup })

const appSettingsGroup = defineGroup(['functionapp', 'config', 'appsettings'], 'Manage custom Function App application settings.', {
  set: defineCommand(['functionapp', 'config', 'appsettings', 'set'], 'Set custom Function App application settings.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, SETTINGS],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = functions.setFunctionAppSettings(sandbox, values)
      return { sandbox: next, output: presentAppSettings(resource), events: [functionAppEvent('updated', resource)] }
    },
  }),
  list: defineCommand(['functionapp', 'config', 'appsettings', 'list'], 'List custom Function App application settings.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentAppSettings(functions.getFunctionApp(sandbox, values.resourceGroup, values.name), { includeValues: true }) }),
  }),
  delete: defineCommand(['functionapp', 'config', 'appsettings', 'delete'], 'Delete custom Function App application settings.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, SETTING_NAMES],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = functions.deleteFunctionAppSettings(sandbox, values)
      return { sandbox: next, output: presentAppSettings(resource), events: [functionAppEvent('updated', resource)] }
    },
  }),
})

const configGroup = defineGroup(['functionapp', 'config'], 'Manage Function App configuration.', { appsettings: appSettingsGroup })

const corsGroup = defineGroup(['functionapp', 'cors'], 'Manage Function App CORS settings.', {
  add: defineCommand(['functionapp', 'cors', 'add'], 'Add allowed CORS origins.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, { ...ALLOWED_ORIGINS, required: true }],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = functions.addFunctionAppCors(sandbox, values)
      return { sandbox: next, output: presentCors(resource.cors), events: [functionAppEvent('updated', resource)] }
    },
  }),
  remove: defineCommand(['functionapp', 'cors', 'remove'], 'Remove allowed CORS origins, or clear all when none are specified.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, { ...ALLOWED_ORIGINS, required: true }],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = functions.removeFunctionAppCors(sandbox, values)
      return { sandbox: next, output: presentCors(resource.cors), events: [functionAppEvent('updated', resource)] }
    },
  }),
  show: defineCommand(['functionapp', 'cors', 'show'], 'Show allowed CORS origins.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentCors(functions.getFunctionAppCors(sandbox, values.resourceGroup, values.name)) }),
  }),
})

export const functionappGroup = defineGroup(['functionapp'], 'Manage Azure Function Apps.', {
  create: defineCommand(['functionapp', 'create'], 'Create a Flex Consumption Function App.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, STORAGE_ACCOUNT, FLEX_LOCATION, RUNTIME, RUNTIME_VERSION, FUNCTIONS_VERSION, OS_TYPE, ARG.tags],
    run: ({ sandbox }, values) => {
      const existing = sandbox.functionApps.find((app) => app.name.toLowerCase() === String(values.name).toLowerCase())
      const { sandbox: next, resource } = functions.createFunctionApp(sandbox, values)
      return { sandbox: next, output: presentFunctionApp(resource), events: [functionAppEvent(existing ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['functionapp', 'show'], 'Show a Function App.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentFunctionApp(functions.getFunctionApp(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['functionapp', 'list'], 'List Function Apps.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: functions.listFunctionApps(sandbox, values.resourceGroup ?? null).map(presentFunctionApp) }),
  }),
  delete: defineCommand(['functionapp', 'delete'], 'Delete a Function App.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = functions.deleteFunctionApp(sandbox, values)
      return { sandbox: next, output: null, events: [functionAppEvent('deleted', resource)] }
    },
  }),
  config: configGroup,
  cors: corsGroup,
})

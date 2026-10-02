import { parseMessagingProject, messagingError } from './python.js'
import { executeMessagingProgram } from './vm.js'
import { finiteJson, plainObject, validateMessagingState } from './state.js'
import { SUBSCRIPTION_ID, isSandboxShape } from '../sandbox/model.js'
import { getFunctionApp, getStorageAccount } from '../sandbox/functions.js'
import { getQueue } from '../sandbox/ops.js'
import { parseEventGridFunctionEndpoint } from '../sandbox/eventgrid-validation.js'
import { MESSAGING_RUNTIME_FILES } from '../../data/templates/messaging-python/runtime.js'
import { messagingExecutionEnvelope } from './execute.js'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const lower = value => value.toLowerCase()
const fail = (message, path = 'function_app.py', code = 'MESSAGING_CONFIG') => { throw messagingError(code, message, { path, line: 1, column: 1 }) }
const appIdentity = app => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Web/sites/${app.name}`.toLowerCase()

/** One synchronous, bounded host start. Captured source is evidence data, never executable persisted IR. */
export function runMessagingFunctions(run, lab) {
  let entry = 'function_app.py'
  try {
    const config = lab.messagingInput?.functions
    if (!plainObject(config) || !finiteJson(config) || Object.keys(config).some(key => !['appId', 'entry'].includes(key)) || typeof config.appId !== 'string') fail('Select the actual training Function App ARM identity.')
    entry = config.entry ?? entry
    if (typeof entry !== 'string' || !/^(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*\.py$/.test(entry)) fail('Select a portable Python Functions entry.')
    if (!isSandboxShape(run.sandbox) || !validateMessagingState(run.runtime.messaging)) fail('Invalid Function App resource or messaging state.', entry)
    const target = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft.Web\/sites\/([^/]+)$/i.exec(config.appId)
    if (!target || lower(target[1]) !== lower(SUBSCRIPTION_ID)) fail('Function App identity must resolve the supplied subscription.', entry)
    const app = getFunctionApp(run.sandbox, target[2], target[3])
    if (app.runtime !== 'python' || app.runtimeVersion !== '3.12' || app.functionsVersion !== '4' || app.os !== 'Linux' || app.hostingPlan !== 'FlexConsumption') fail('The host requires the supported Python 3.12 Functions 4 app.', entry)
    getStorageAccount(run.sandbox, app.storageResourceGroup, app.storageAccount)
    const files = run.project.savedFiles
    const readConfig = path => {
      if (typeof files[path] !== 'string' || new TextEncoder().encode(files[path]).length > 128 * 1024) fail('Host configuration is missing or exceeds 128 KiB.', path)
      let value
      try { value = JSON.parse(files[path]) } catch { fail('Host configuration must be valid JSON.', path) }
      if (!plainObject(value) || !finiteJson(value)) fail('Host configuration must be a JSON object.', path)
      return value
    }
    if (readConfig('host.json').version !== '2.0') fail('host.json must use version 2.0.', 'host.json')
    const settings = readConfig('local.settings.json')
    if (settings.IsEncrypted !== false || !plainObject(settings.Values) || settings.Values.FUNCTIONS_WORKER_RUNTIME !== 'python'
      || settings.Values.AzureWebJobsStorage !== 'UseDevelopmentStorage=true') fail('Use the Python worker and simulated UseDevelopmentStorage=true storage setting.', 'local.settings.json')
    const parsed = parseMessagingProject(files, { entry, mode: 'functions', fixedFiles: MESSAGING_RUNTIME_FILES })
    if (parsed.diagnostics.length) return messagingExecutionEnvelope(run, entry, { state: run.runtime.messaging, trace: [], output: [], diagnostics: parsed.diagnostics })
    const program = parsed.program, appId = appIdentity(app), bindings = []
    for (const handler of program.handlers) {
      if (handler.kind !== 'servicebus') continue
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(handler.connection)) fail('Connection must be a supported identity setting prefix.', handler.path)
      const key = `${handler.connection}__fullyQualifiedNamespace`, endpoint = settings.Values[key]
      if (typeof endpoint !== 'string' || (own(app.appSettings, key) && app.appSettings[key] !== endpoint)) fail('The trigger requires a coherent simulated namespace identity setting.', 'local.settings.json')
      const namespaces = run.sandbox.namespaces.filter(ns => lower(`${ns.name}.servicebus.windows.net`) === lower(endpoint))
      if (namespaces.length !== 1) fail('The connection namespace must resolve an actual training namespace.', 'local.settings.json')
      const ns = namespaces[0], queue = getQueue(run.sandbox, ns.resourceGroup, ns.name, handler.queueName)
      if (queue.requiresSession || ['Disabled', 'ReceiveDisabled'].includes(queue.status)) fail('This bounded queue trigger requires an enabled non-session queue.', handler.path)
      bindings.push({ functionId: handler.functionId, target: { resourceGroup: ns.resourceGroup, namespace: ns.name, queue: queue.name } })
    }
    for (const topic of run.sandbox.eventGridTopics) for (const subscription of topic.eventSubscriptions) {
      if (subscription.endpointType !== 'AzureFunction') continue
      const endpoint = parseEventGridFunctionEndpoint(subscription.endpoint)
      if (lower(endpoint.resourceGroup) !== lower(app.resourceGroup) || lower(endpoint.app) !== lower(app.name)) continue
      if (!program.handlers.some(handler => handler.kind === 'eventgrid' && lower(handler.functionName) === lower(endpoint.functionName))) fail('AzureFunction subscription target must name an actual registered Event Grid Function.', entry)
    }
    const paths = [...new Set([...program.sourcePaths, ...Object.keys(MESSAGING_RUNTIME_FILES), 'host.json', 'local.settings.json'])].sort()
    const sources = Object.fromEntries(paths.map(path => [path, files[path]]))
    const sourceVersions = Object.fromEntries(paths.map(path => [path, run.project.fileVersions?.[path] ?? 0]))
    const previous = run.runtime.messaging.hosts[appId]
    if ((!previous && Object.keys(run.runtime.messaging.hosts).length >= 16) || (previous?.generation ?? 0) >= Number.MAX_SAFE_INTEGER) fail('Host record or generation limit reached.', entry, 'MESSAGING_LIMIT')
    const record = { appId, entry, generation: (previous?.generation ?? 0) + 1, status: 'stopped', startedAtMs: run.runtime.messaging.timeMs, sources, sourceVersions, handlers: program.handlers.map(handler => ({ ...handler })) }
    const state = { ...run.runtime.messaging, hosts: { ...run.runtime.messaging.hosts, [appId]: record } }
    if (!validateMessagingState(state)) fail('Captured host source/revision metadata is invalid.', entry)
    program.host = { appId, bindings }
    const result = executeMessagingProgram({ program, state, sandbox: run.sandbox, input: lab.messagingInput ?? {} })
    return messagingExecutionEnvelope(run, entry, result)
  } catch (error) {
    const diagnostic = error.diagnostic ?? { code: 'MESSAGING_CONFIG', message: error.message, path: entry, line: 1, column: 1 }
    return messagingExecutionEnvelope(run, entry, { state: run.runtime.messaging, trace: [], output: [], diagnostics: [diagnostic] })
  }
}

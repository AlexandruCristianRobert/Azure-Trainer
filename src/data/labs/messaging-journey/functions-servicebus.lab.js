import { FUNCTIONS_SERVICEBUS_STARTER_FILES, FUNCTIONS_SERVICEBUS_SOLUTION_FILES } from '../../templates/messaging-python/functions.js'
import { functionsMetadata, messagingTask, file, command, functionsReady, functionsPaths, functionsResources, functionsReadme, functionsExerciseTask, FUNCTION_APP_ID, ORDERS_ID, receiptApplicationWork, exactOrder } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

export const createFunctionAppTask = (prepareStorage = true) => messagingTask({ id: 'python-function-app',
  text: `Create func-orders in rg-messaging with Python 3.12, Functions 4, Linux and Flex Consumption in West Europe, using stmessagingorders. ${prepareStorage ? 'First create that StorageV2 Standard_LRS account in the same group/location.' : 'The storage account is supplied independently.'}`,
  rationale: { concept: 'Python Functions host prerequisites', what: 'Pairs an actual Python runtime and supported host with its storage account.', why: 'The Python v2 app needs coherent runtime and storage configuration before its bindings can run.', without: 'A missing storage account or incompatible runtime prevents the host from starting.', csharp: 'C# Functions also needs host storage, but Python uses its own worker/runtime version.' },
  check: functionsReady,
  solution: { steps: [
    ...(prepareStorage ? [command('az storage account create --resource-group rg-messaging --name stmessagingorders --location westeurope --sku Standard_LRS --kind StorageV2')] : []),
    command('az functionapp create --resource-group rg-messaging --name func-orders --storage-account stmessagingorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12 --functions-version 4 --os-type Linux'),
  ] },
})
export const configureFunctionsHostTask = (files, resourceIds = functionsResources) => messagingTask({ id: 'python-host-settings',
  text: 'Configure host.json version 2.0 and local.settings.json for the Python worker, IsEncrypted false, simulated AzureWebJobsStorage UseDevelopmentStorage=true and ServiceBusConnection__fullyQualifiedNamespace sb-orders.servicebus.windows.net. Save the files; the final func start verifies these settings with the actual handlers. No credentials belong in this exercise.',
  rationale: { concept: 'Identity setting and saved host configuration', what: 'Resolves the queue decorator connection prefix against a real supplied namespace.', why: 'The host reparses saved settings and source together on each bounded start.', without: 'A mismatched namespace, worker or storage setting prevents receipt processing.', csharp: 'The connection prefix serves the same binding purpose as C# ServiceBusTrigger Connection.' },
  paths: [...functionsPaths, ...(files['clients.py'] ? ['clients.py'] : [])], resourceIds, check: functionsReady,
  solution: { steps: [file('host.json', files['host.json']), file('local.settings.json', files['local.settings.json'])] },
})
export function processedFunctionOrder(measurement) {
  const [row] = measurement.receipts.servicebus
  return measurement.receipts.servicebus.length === 1 && row.entityId === ORDERS_ID && row.messageId === 'm1'
    && receiptApplicationWork(measurement, row, { id: 'o1', region: 'EU', quantity: 2 })
    && measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind)).length === 2
    && exactOrder(measurement.effects.after.workByOrder, { o1: 1 })
    && exactOrder(measurement.effects.after.processed?.o1, { id: 'o1', region: 'EU', quantity: 2 })
    && Object.keys(measurement.effects.after.processed ?? {}).length === 1
}
const settings = configureFunctionsHostTask(FUNCTIONS_SERVICEBUS_SOLUTION_FILES)
const process = messagingTask({ id: 'servicebus-function',
  text: 'Write ProcessOrder in function_app.py using @app.function_name and @app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection"), with a func.ServiceBusMessage annotation. Decode the actual msg.get_body().decode("utf-8") through json.loads, reject nonpositive quantity, guard processed order IDs, perform work then record success. Run func start after saving. The host completes m1 (o1, EU, quantity 2) only when your handler succeeds.',
  rationale: { concept: 'Queue trigger and host settlement', what: 'A Python v2 decorator binds a typed Function handler to actual queue deliveries.', why: 'Work and its success marker must finish before successful invocation permits host completion.', without: 'A no-op loses business work; throwing causes abandon/redelivery instead of completion.', csharp: 'Unlike SDK CompleteMessageAsync, ordinary Python func.ServiceBusMessage relies on host completion after success; C# trigger auto-completion is a comparable host policy.' },
  hints: ['Use the received body, not a reconstructed order dictionary.', 'Do not call SDK complete_message on func.ServiceBusMessage.'],
  paths: functionsPaths, resourceIds: functionsResources, check: functionsReady,
  solution: { steps: [file('function_app.py', FUNCTIONS_SERVICEBUS_SOLUTION_FILES['function_app.py']), command('func start')] },
})
export const functionsServicebusLab = {
  ...functionsMetadata, id: 'messaging-functions-servicebus', title: 'Simulated: Process queue orders with a Python Function', journeyOrder: 10, minutes: 35,
  brief: 'Write Python v2 queue decorators and a receipt-bound handler, configure Python host/storage/settings, then run func start. Independent prepared rg-messaging, Standard sb-orders and one unprocessed m1 are supplied; new storage, Function App, host settings and handler are unfinished. No previous Lab required. Host execution, identity and storage are bounded simulations.',
  initialProjectFiles: { ...FUNCTIONS_SERVICEBUS_STARTER_FILES, 'README.md': functionsReadme('Prepared rg-messaging in West Europe, Standard sb-orders and active orders (maxDeliveryCount 5) with m1 carrying o1/EU/quantity2. Storage and func-orders do not exist. New decorators/handler and host settings are unfinished. No work, evidence, host or execution journal is prepared. This Lab processes the queue only; it does not construct an Event Grid publisher.') },
  initializeSimulation: run => seedMessagingStage(run, 'functions-servicebus'), tasks: [createFunctionAppTask(), settings, process],
  messagingInput: { functions: { appId: FUNCTION_APP_ID } },
  messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }], tasks: [functionsExerciseTask(settings, processedFunctionOrder), functionsExerciseTask(process, processedFunctionOrder)] },
}

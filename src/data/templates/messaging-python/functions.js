import { EVENTGRID_STARTER_FILES, EVENTGRID_SOLUTION_FILES } from './eventgrid.js'
import { SERVICEBUS_STARTER_FILES } from './servicebus.js'
export { MESSAGING_RUNTIME_FILES } from './runtime.js'
export { MESSAGING_MANIFEST } from './manifest.js'

const header = `import json
import azure.functions as func
from azure.eventgrid import EventGridEvent
from clients import publisher
from training_runtime import perform_order_work, record_processed, was_processed, record_notification

app = func.FunctionApp()
`
const orderBinding = `
@app.function_name(name="ProcessOrder")
@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")
def process_order(msg: func.ServiceBusMessage):
`
const eventBinding = `
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify_order(event: func.EventGridEvent):
`
export const FUNCTIONS_STARTER_FILES = Object.freeze({
  ...EVENTGRID_STARTER_FILES,
  'function_app.py': header + orderBinding + '    raise ValueError("Finish the Service Bus Function")\n' + eventBinding + '    raise ValueError("Finish the Event Grid Function")\n',
  'host.json': '{\n  "version": "2.0"\n}\n',
  'local.settings.json': '{\n  "IsEncrypted": false,\n  "Values": {\n    "FUNCTIONS_WORKER_RUNTIME": "python",\n    "AzureWebJobsStorage": "UseDevelopmentStorage=true",\n    "ServiceBusConnection__fullyQualifiedNamespace": "sb-orders.servicebus.windows.net"\n  }\n}\n',
  'README.md': EVENTGRID_STARTER_FILES['README.md'] + '\nFunctions uses Python 3.12, Functions 4 and the v2 decorator model. func start captures saved source and registered handlers for one bounded host run; save edits and start again to capture a new revision. This simulated identity/storage configuration contains no real secret. Ordinary ServiceBusMessage handlers auto-complete only on success; exceptions redeliver within broker limits. Event Grid Functions receive actual envelopes and failed invocations retry with logical simulator ticks. No background service, network or deployment runs.\n',
})
export const FUNCTIONS_SOLUTION_FILES = Object.freeze({
  ...EVENTGRID_SOLUTION_FILES,
  ...FUNCTIONS_STARTER_FILES,
  'worker.py': EVENTGRID_SOLUTION_FILES['worker.py'],
  'events.py': EVENTGRID_SOLUTION_FILES['events.py'],
  'handler.py': EVENTGRID_SOLUTION_FILES['handler.py'],
  'function_app.py': header + orderBinding + `    order = json.loads(msg.get_body().decode("utf-8"))
    if not was_processed(order["id"]):
        perform_order_work(order)
        record_processed(order)
        event = EventGridEvent(subject="/orders/" + order["region"] + "/" + order["id"],
                              event_type="Contoso.OrderProcessed", data={"order_id": order["id"], "region": order["region"]},
                              data_version="1.0", id="order-" + order["id"])
        publisher.send([event])
` + eventBinding + `    order = event.get_json()
    record_notification(event.id, order["order_id"])
`,
})

// Journey stages are independent: only the capstone starts from an empty app.
const busHeader = `import json
import azure.functions as func
from training_runtime import perform_order_work, record_processed, was_processed

app = func.FunctionApp()
`
const busWork = `    order = json.loads(msg.get_body().decode("utf-8"))
    if order["quantity"] <= 0:
        raise ValueError("Order quantity must be positive")
    if not was_processed(order["id"]):
        perform_order_work(order)
        record_processed(order)
`
const publishWork = busWork + `        event = EventGridEvent(subject="/orders/" + order["region"] + "/" + order["id"],
                              event_type="Contoso.OrderProcessed",
                              data={"order_id": order["id"], "region": order["region"], "quantity": order["quantity"]},
                              data_version="1.0", id="e-" + order["id"])
        publisher.send([event])
`
const notifyWork = `    data = event.get_json()
    record_notification(event.id, data["order_id"])
`
const configs = { 'host.json': FUNCTIONS_STARTER_FILES['host.json'], 'local.settings.json': FUNCTIONS_STARTER_FILES['local.settings.json'] }
const unfinishedConfigs = { 'host.json': '{}\n', 'local.settings.json': '{"IsEncrypted": false, "Values": {}}\n' }
const manifestScaffold = {
  ...SERVICEBUS_STARTER_FILES,
  'producer.py': '# Queue inputs are supplied by this independent lab fixture.\n',
  'worker.py': '# This lab uses the Function host, rather than the SDK worker.\n',
  'events.py': '# This lab publishes within the actual work Function when required.\n',
  'handler.py': '# This lab uses the Event Grid Function when required.\n',
}
export const FUNCTIONS_SERVICEBUS_STARTER_FILES = Object.freeze({
  ...manifestScaffold, ...unfinishedConfigs,
  'function_app.py': busHeader + '\n# Register and implement ProcessOrder using the Python v2 queue decorator.\n',
})
export const FUNCTIONS_SERVICEBUS_SOLUTION_FILES = Object.freeze({
  ...FUNCTIONS_SERVICEBUS_STARTER_FILES, ...configs, 'function_app.py': busHeader + orderBinding + busWork,
})
export const FUNCTIONS_EVENTGRID_STARTER_FILES = Object.freeze({
  ...manifestScaffold, 'clients.py': EVENTGRID_STARTER_FILES['clients.py'], ...configs,
  'function_app.py': header + orderBinding + publishWork + '\n# Add the new NotifyOrder Event Grid Function.\n',
})
export const FUNCTIONS_EVENTGRID_SOLUTION_FILES = Object.freeze({
  ...FUNCTIONS_EVENTGRID_STARTER_FILES, 'function_app.py': header + orderBinding + publishWork + eventBinding + notifyWork,
})
export const FUNCTIONS_CAPSTONE_STARTER_FILES = Object.freeze({
  ...manifestScaffold, 'clients.py': EVENTGRID_STARTER_FILES['clients.py'], ...unfinishedConfigs,
  'function_app.py': 'import azure.functions as func\n\napp = func.FunctionApp()\n',
})
export const FUNCTIONS_CAPSTONE_PROCESS_SOURCE = header + orderBinding + publishWork
export const FUNCTIONS_CAPSTONE_SOLUTION_FILES = Object.freeze({
  ...FUNCTIONS_CAPSTONE_STARTER_FILES, ...configs, 'function_app.py': FUNCTIONS_EVENTGRID_SOLUTION_FILES['function_app.py'],
})

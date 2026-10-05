import { CONTEXT_SOURCE, observabilityProjectFiles } from './telemetry.js'

export const CAPSTONE_FUNCTION_SOURCE = CONTEXT_SOURCE
  .replace('from training_runtime import perform_order_work, record_processed', 'from training_runtime import perform_order_work, record_processed, was_processed\nfrom azure.appconfiguration.provider import load, SettingSelector\nlogger = logging.getLogger("orders")\nlogger.setLevel(logging.INFO)')
  .replace('    # Convert the actual external', '    if was_processed(order["id"]):\n        return\n    # Convert the actual external')
  .replace('        secret = client.get_secret("notification-api-key")\n        send_notification(event.id, data["order_id"], secret.value, "email")', `        credential = DefaultAzureCredential()
        config = load(endpoint="https://ac-orders.azconfig.io", credential=credential,
            selects=[SettingSelector(key_filter="Orders:*", label_filter="production")], keyvault_credential=credential)
        result = send_notification(event.id, data["order_id"], config["Orders:ApiKey"], config["Orders:Channel"])
        if result["status_code"] == 202:
            logger.info("Notification accepted", extra={"app.order_id": data["order_id"], "app.channel": result["channel"], "app.status_code": result["status_code"]})`)

export const CAPSTONE_QUERY_SOURCE = `from training_runtime import query_telemetry

def main():
    query = "AppRequests | where Name == 'NotifyOrder' | summarize Notifications=count(), Failures=countif(Success == false), MeanMs=avg(DurationMs)"
    return query_telemetry(query)
`
export function capstoneProjectFiles(brief) {
  const files = observabilityProjectFiles(brief, 'def main():\n    # Query the final exported notification dataset after func start.\n    return None\n', true)
  files['README.md'] = files['README.md'].replace('Save function_app.py and run func start for this compact exercise.', 'Save function_app.py and worker.py; run func start followed by python worker.py for this combined exercise.')
    .replace('reset for a fresh one-command exercise.', 'reset for a fresh combined exercise.')
  files['function_app.py'] = `import json
import azure.functions as func
from azure.eventgrid import EventGridEvent
from clients import publisher
from training_runtime import perform_order_work, record_processed, was_processed
app = func.FunctionApp()

@app.function_name(name="ProcessOrder")
@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")
def process_order(msg: func.ServiceBusMessage):
    order = json.loads(msg.get_body().decode("utf-8"))
    if not was_processed(order["id"]):
        perform_order_work(order)
        record_processed(order)
        publisher.send(EventGridEvent("/orders/EU/" + order["id"], "Contoso.OrderProcessed", {"order_id": order["id"]}, "1.0", id="e-" + order["id"]))

@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify_order(event: func.EventGridEvent):
    # Add the production reference consumer, correlated span and safe log.
    pass
`
  files['README.md'] += '\nCapstone: save both function_app.py and worker.py before verification. One combined exercise uses func start followed by python worker.py. The second command queries the final host exports; it does not produce new workload. A repeated business ID must create no second work, event or notification. Reset restores both fresh messages. Newly assigned secure notification, instrumentation and aggregate query are unfinished.\n'
  return files
}

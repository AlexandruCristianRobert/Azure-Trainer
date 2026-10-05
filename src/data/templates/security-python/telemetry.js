import { TRAINER_CONNECTION_STRING } from '../../../lib/observability/export.js'
import { securityProjectFiles, securityReadme } from './security.js'

export const TELEMETRY_IMPORTS = `from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace, propagate, metrics
from opentelemetry.trace import SpanKind, Status, StatusCode
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification, advance_security_fixture, query_telemetry
import logging
configure_azure_monitor(connection_string="${TRAINER_CONNECTION_STRING}", logger_name="orders")
tracer = trace.get_tracer("orders")
client = SecretClient("https://kv-orders.vault.azure.net", DefaultAzureCredential())
`
export const SETUP_SOURCE = TELEMETRY_IMPORTS + `
def main():
    with tracer.start_as_current_span("NotifyOrder"):
        secret = client.get_secret("notification-api-key")
        return send_notification("e-o1", "o1", secret.value, "email")
`
export const SPANS_SOURCE = TELEMETRY_IMPORTS + `
def main():
    with tracer.start_as_current_span("NotifyOrder", attributes={"app.order_id": "o1", "app.attempt": 1}) as span:
        secret = client.get_secret("notification-api-key")
        accepted = send_notification("e-o1", "o1", secret.value, "email")
    # Disclosed trainer control rotates the actual vault key and provider acceptance.
    advance_security_fixture()
    with tracer.start_as_current_span("NotifyOrder", attributes={"app.order_id": "o1", "app.attempt": 2}) as span:
        rejected = send_notification("e-o1", "o1", secret.value, "email")
        if rejected["status_code"] != 202:
            span.set_status(Status(StatusCode.ERROR))
            span.record_exception(ValueError("Notification rejected"))
`
export const LOGGING_SOURCE = TELEMETRY_IMPORTS + `logger = logging.getLogger("orders")
logger.setLevel(logging.INFO)

def main():
    with tracer.start_as_current_span("NotifyOrder", attributes={"app.order_id": "o1"}):
        secret = client.get_secret("notification-api-key")
        result = send_notification("e-o1", "o1", secret.value, "email")
        if result["status_code"] == 202:
            logger.info("Notification accepted", extra={"app.order_id": "o1", "app.channel": result["channel"], "app.status_code": result["status_code"]})
`
export const FAILURE_QUERY = "AppDependencies | where Name == 'NotifyOrder' and Success == false | project OrderId=tostring(Properties['app.order_id']), OperationId, DurationMs"
export const FAILURE_STARTER = SPANS_SOURCE.replace('def main():', 'def produce_telemetry():') + `
# Earlier-stage instrumentation above is supplied; it executes now, never seeded rows.
def main():
    produce_telemetry()
    # Write and execute the failure query here.
    return None
`
export const FAILURE_SOURCE = FAILURE_STARTER.replace('    # Write and execute the failure query here.\n    return None', `    query = "${FAILURE_QUERY}"\n    return query_telemetry(query)`)
export const CONTEXT_CLIENTS = `from azure.identity import DefaultAzureCredential
from azure.eventgrid import EventGridPublisherClient
publisher = EventGridPublisherClient("https://evgt-orders.westeurope-1.eventgrid.azure.net/api/events", DefaultAzureCredential())
`
export const CONTEXT_SOURCE = TELEMETRY_IMPORTS + `import json
import azure.functions as func
from azure.eventgrid import EventGridEvent
from clients import publisher
from training_runtime import perform_order_work, record_processed
app = func.FunctionApp()

@app.function_name(name="ProcessOrder")
@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")
def process_order(msg: func.ServiceBusMessage):
    order = json.loads(msg.get_body().decode("utf-8"))
    # Convert the actual external Service Bus Diagnostic-Id to a W3C carrier.
    incoming = {"traceparent": msg.application_properties["Diagnostic-Id"]}
    with tracer.start_as_current_span("ProcessOrder", context=propagate.extract(incoming), kind=SpanKind.CONSUMER, attributes={"app.order_id": order["id"]}):
        perform_order_work(order)
        record_processed(order)
        carrier = {}
        with tracer.start_as_current_span("PublishOrder", kind=SpanKind.PRODUCER):
            propagate.inject(carrier)
            publisher.send(EventGridEvent("/orders/EU/" + order["id"], "Contoso.OrderProcessed", {"order_id": order["id"], "trace_context": carrier}, "1.0", id="e-" + order["id"]))

@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify_order(event: func.EventGridEvent):
    data = event.get_json()
    with tracer.start_as_current_span("NotifyOrder", context=propagate.extract(data["trace_context"]), kind=SpanKind.CONSUMER, attributes={"app.order_id": data["order_id"]}):
        secret = client.get_secret("notification-api-key")
        send_notification(event.id, data["order_id"], secret.value, "email")
`
export const CONTEXT_STARTER = CONTEXT_SOURCE
  .replace('context=propagate.extract(incoming)', 'context=None')
  .replace('propagate.inject(carrier)', '# TODO: inject the active publishing span into carrier.\n            pass')
  .replace('context=propagate.extract(data["trace_context"])', 'context=None')

export const METRICS_QUERY = "AppDependencies | where Name == 'NotifyAttempt' | summarize MeanMs=avg(DurationMs), MaxMs=max(DurationMs), Attempts=count(), Retries=countif(toint(Properties['app.attempt']) > 1), Failures=countif(Success == false) | extend FailureRate=todouble(Failures) / Attempts"
export const METRICS_SOURCE = TELEMETRY_IMPORTS + `import json
from azure.servicebus import ServiceBusClient
bus = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())
meter = metrics.get_meter("orders")
attempts = meter.create_counter("orders.attempts")
failures = meter.create_counter("orders.failures")
latency = meter.create_histogram("orders.duration", unit="ms")
SUMMARY_QUERY = "${METRICS_QUERY}"

def main():
    receiver = bus.get_queue_receiver("orders")
    for turn in [1, 2]:
        for message in receiver.receive_messages(max_message_count=1):
            order = json.loads(str(message))
            with tracer.start_as_current_span("NotifyAttempt", attributes={"app.order_id": order["id"], "app.attempt": message.delivery_count}) as span:
                secret = client.get_secret("notification-api-key")
                if message.delivery_count == 1:
                    advance_security_fixture()
                result = send_notification("e-" + order["id"], order["id"], secret.value, "email")
                attempts.add(1, attributes={"app.order_id": order["id"], "app.attempt": message.delivery_count})
                if result["status_code"] != 202:
                    failures.add(1, attributes={"app.order_id": order["id"], "app.attempt": message.delivery_count})
                    span.set_status(Status(StatusCode.ERROR))
                    receiver.abandon_message(message)
                else:
                    receiver.complete_message(message)
    # DurationMs comes from actual exported logical operation costs, not a wall clock.
    durations = query_telemetry("AppDependencies | where Name == 'NotifyAttempt' | project DurationMs")
    for row in durations["rows"]:
        latency.record(row["DurationMs"])
    return query_telemetry(SUMMARY_QUERY)
`
export function observabilityProjectFiles(brief, worker, context = false) {
  const files = securityProjectFiles(securityReadme(brief) + `
Observability vocabulary: AppRequests holds SERVER/CONSUMER spans; AppDependencies
holds other spans; AppTraces is structured logging; AppExceptions omits exception
text; AppMetrics contains individual counter/histogram measurements. OperationId
is the trace ID, Id is a span ID, ParentId links its parent. The destination is
pre-provisioned ai-orders. DurationMs is deterministic logical operation cost,
never wall-clock latency, network timing, production performance or Azure SLA.
KQL is evaluated over actual exported rows with typed query receipts. A print or
constant total cannot establish aggregate lineage. Re-running appends telemetry;
reset for a fresh one-command exercise. No seeded telemetry proves completion.
For query-derived histogram credit, pass the returned numeric DurationMs cell
directly to record(). Assignments preserve its private query/row/column linkage.
Arithmetic and string/JSON serialization produce ordinary values and lose that
direct-cell linkage. Public query returns remain ordinary JSON numbers. Literal
metric values are supported, but do not establish query-derived consumption.
`, worker)
  if (context) {
    files['README.md'] = files['README.md'].replace('Save worker.py and run python worker.py', 'Save function_app.py and run func start')
      .replace('but these Labs run worker.py.', 'and this Lab runs func start.')
    files['function_app.py'] = CONTEXT_STARTER
    files['clients.py'] = CONTEXT_CLIENTS
    const settings = JSON.parse(files['local.settings.json'])
    settings.Values.ServiceBusConnection__fullyQualifiedNamespace = 'sb-orders.servicebus.windows.net'
    files['local.settings.json'] = JSON.stringify(settings, null, 2)
    files['README.md'] += '\nThis Lab uses func start and function_app.py + clients.py. The supplied active m1 carries an external Diagnostic-Id, not an earlier completion. Convert it to traceparent, explicitly extract for ProcessOrder, inject in PublishOrder and explicitly extract event.data trace_context in NotifyOrder. Host roots also exist: inheriting them alone does not prove this exercise. Host settings use telemetryMode OpenTelemetry, ai-orders connection and PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY=false with manual configure_azure_monitor.\n'
  }
  return files
}

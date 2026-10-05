import { SERVICEBUS_SOLUTION_FILES } from '../messaging-python/servicebus.js'
import { HTTP_RUNTIME_FILES } from './runtime.js'
export { HTTP_WORKER_SOURCE } from './runtime.js'

export const HTTP_PREFIX = `import json
import azure.functions as func
from order_store import OrderStatusRepository
from azure.servicebus import ServiceBusMessage
from clients import bus

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
store = OrderStatusRepository()

`
export const HTTP_HEALTH_SOURCE = `@app.route(route="health", methods=["GET"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"status":"ok"}), mimetype="application/json")

`
export const HTTP_STATUS_SOURCE = `@app.route(route="orders/{id}", methods=["GET"])
def get_order(req: func.HttpRequest) -> func.HttpResponse:
    record = store.get(req.route_params["id"])
    if record is None:
        return func.HttpResponse("Order not found", status_code=404)
    return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}), mimetype="application/json")

`
export const HTTP_VALIDATION_SOURCE = `def valid_order(order):
    if not isinstance(order, dict):
        return False
    if len(order) != 3:
        return False
    order_id = order.get("id")
    region = order.get("region")
    quantity = order.get("quantity")
    if not isinstance(order_id, str):
        return False
    if len(order_id) < 1 or len(order_id) > 64:
        return False
    if order_id[0] not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789":
        return False
    for character in order_id:
        if character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-":
            return False
    if region not in ["EU", "US"]:
        return False
    if isinstance(quantity, bool) or not isinstance(quantity, int):
        return False
    if quantity < 1 or quantity > 100:
        return False
    return True

`
const parseOrder = `    try:
        order = req.get_json()
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)
    if not valid_order(order):
        return func.HttpResponse("Invalid order", status_code=400)
`
export const HTTP_SEND_SOURCE = `    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"]))
    return func.HttpResponse(json.dumps({"id":order["id"],"status":"pending"}), status_code=202, headers={"Location":"/api/orders/" + order["id"]}, mimetype="application/json")
`
export const HTTP_RETRY_SOURCE = `    record = store.get(order["id"])
    if record is not None:
        if record.region != order["region"] or record.quantity != order["quantity"]:
            return func.HttpResponse("Order conflicts", status_code=409)
        return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}), status_code=200, headers={"Location":"/api/orders/" + order["id"]}, mimetype="application/json")
`
const postHeader = `@app.route(route="orders", methods=["POST"])
def post_order(req: func.HttpRequest) -> func.HttpResponse:
`
const unfinished = (route, name, methods) => `@app.route(route="${route}", methods=["${methods}"])
def ${name}(req: func.HttpRequest) -> func.HttpResponse:
    # Construct the assigned handler; the supplied baseline carries no HTTP proof.
    raise ValueError("Finish this handler")
`
export const HTTP_SOLUTION_SOURCES = Object.freeze({
  start: HTTP_PREFIX + HTTP_HEALTH_SOURCE,
  status: HTTP_PREFIX + HTTP_HEALTH_SOURCE + HTTP_STATUS_SOURCE,
  validation: HTTP_PREFIX + HTTP_HEALTH_SOURCE + HTTP_STATUS_SOURCE + HTTP_VALIDATION_SOURCE + postHeader + parseOrder + '    return func.HttpResponse(json.dumps(order), mimetype="application/json")\n',
  enqueue: HTTP_PREFIX + HTTP_HEALTH_SOURCE + HTTP_STATUS_SOURCE + HTTP_VALIDATION_SOURCE + postHeader + parseOrder + HTTP_SEND_SOURCE,
  retries: HTTP_PREFIX + HTTP_HEALTH_SOURCE + HTTP_STATUS_SOURCE + HTTP_VALIDATION_SOURCE + postHeader + parseOrder + HTTP_RETRY_SOURCE + HTTP_SEND_SOURCE,
})
export const HTTP_STARTER_SOURCES = Object.freeze({
  start: HTTP_PREFIX + unfinished('health', 'health', 'GET'),
  status: HTTP_PREFIX + HTTP_HEALTH_SOURCE + unfinished('orders/{id}', 'get_order', 'GET'),
  validation: HTTP_PREFIX + HTTP_HEALTH_SOURCE + HTTP_STATUS_SOURCE + unfinished('orders', 'post_order', 'POST'),
  enqueue: HTTP_SOLUTION_SOURCES.validation,
  retries: HTTP_SOLUTION_SOURCES.enqueue,
})
export function httpProjectFiles(stage) {
  if (!Object.hasOwn(HTTP_STARTER_SOURCES, stage)) throw new Error(`Unknown HTTP stage: ${stage}`)
  return { ...SERVICEBUS_SOLUTION_FILES, ...HTTP_RUNTIME_FILES,
    'function_app.py': HTTP_STARTER_SOURCES[stage],
    'local.settings.json': JSON.stringify({ IsEncrypted: false, Values: {
      FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true',
      ServiceBusConnection__fullyQualifiedNamespace: 'sb-orders.servicebus.windows.net', ENVIRONMENT: 'local',
    } }, null, 2),
    'README.md': `# Order HTTP API: ${stage}\n\nIndependent supplied resources: rg-messaging, Standard sb-orders, active orders queue (maxDeliveryCount 5), StorageV2 Standard_LRS stmessagingorders, and func-orders (Python 3.12, Functions 4, Linux Flex Consumption, West Europe). clients.py and protected worker.py/order_store.py/training_runtime.py are supplied. ${stage === 'status' ? 'One actual unprocessed queue input o1/EU/quantity2 is supplied for pending status; it is not an HTTP acceptance or read proof.' : 'The queue begins empty.'}\n\nNew HTTP behavior is unfinished. Save function_app.py, then func start captures saved sources; edits require another capture. curl and python worker.py execute bounded browser simulations with no network, OS server, Python process or installed Azure SDK. HTTP never runs the worker implicitly. The repository reads actual queue/processed state; it is a teaching view, not a production database or distributed transaction. Only 50 executions/100 requests/16 captures are supported; reset clears proof. Direct repository fields must reach the response to earn read credit; transforming a field can lose this provenance.\n\nBounded syntax limitation: a leading unparenthesized not combined with and/or is diagnosed; use (not condition) or other_condition, not (condition or other_condition), or separate if statements to express the intended grouping. Authored validation uses separate checks. The host records a value-free input classification for distinct invalid-case verification; it never supplies an automatic 400. Browser storage provenance is not cryptographic protection against coherent wholesale rewriting.\n`,
  }
}

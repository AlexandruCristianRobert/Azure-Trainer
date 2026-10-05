import { HTTP_SOLUTION_SOURCES, HTTP_SEND_SOURCE, httpProjectFiles } from './api.js'

export const HTTP_CLOUD_SETTINGS = Object.freeze({ ENVIRONMENT: 'published',
  ServiceBusConnection__fullyQualifiedNamespace: 'sb-orders.servicebus.windows.net' })
export const HTTP_ENVIRONMENT_SOURCE = `@app.route(route="environment", methods=["GET"])
def environment(req: func.HttpRequest) -> func.HttpResponse:
    environment = os.getenv("ENVIRONMENT", "unset")
    return func.HttpResponse(json.dumps({"environment":environment}), mimetype="application/json")

`
export const HTTP_PUBLISH_SOURCE = 'import os\n' + HTTP_SOLUTION_SOURCES.retries + HTTP_ENVIRONMENT_SOURCE
export const HTTP_KEYS_SOURCE = HTTP_PUBLISH_SOURCE.replace('route="orders", methods=["POST"]',
  'route="orders", methods=["POST"], auth_level=func.AuthLevel.FUNCTION')
export const HTTP_BINDING_SEND_SOURCE = `    output.set(json.dumps(order))
    return func.HttpResponse(json.dumps({"id":order["id"],"status":"pending"}), status_code=202, headers={"Location":"/api/orders/" + order["id"]}, mimetype="application/json")
`
export const HTTP_BINDING_SOURCE = HTTP_KEYS_SOURCE
  .replace('def post_order(req: func.HttpRequest) -> func.HttpResponse:',
    '@app.service_bus_queue_output(arg_name="output", queue_name="orders", connection="ServiceBusConnection")\ndef post_order(req: func.HttpRequest, output: func.Out[str]) -> func.HttpResponse:')
  .replace(HTTP_SEND_SOURCE, HTTP_BINDING_SEND_SOURCE)
export const HTTP_HOSTING_SOLUTION_SOURCES = Object.freeze({ publish: HTTP_PUBLISH_SOURCE,
  keys: HTTP_KEYS_SOURCE, binding: HTTP_BINDING_SOURCE })
export const HTTP_HOSTING_STARTER_SOURCES = Object.freeze({
  publish: 'import os\n' + HTTP_SOLUTION_SOURCES.retries + `@app.route(route="environment", methods=["GET"])
def environment(req: func.HttpRequest) -> func.HttpResponse:
    # Construct the assigned settings response from an executed environment read.
    raise ValueError("Finish the environment handler")
`,
  keys: HTTP_PUBLISH_SOURCE,
  binding: HTTP_KEYS_SOURCE,
})
export function httpHostingProjectFiles(stage) {
  if (!Object.hasOwn(HTTP_HOSTING_STARTER_SOURCES, stage)) throw new Error(`Unknown HTTP hosting stage: ${stage}`)
  const files = httpProjectFiles('retries')
  return { ...files, 'function_app.py': HTTP_HOSTING_STARTER_SOURCES[stage],
    'README.md': files['README.md'] + `\n# Hosting stage: ${stage}\n\nValidated POST, repository-first retries, status, the SDK client and protected worker are independently supplied prerequisites. ${stage === 'publish' ? 'Write the environment response and configure actual cloud app settings.' : 'The environment response and actual published ENVIRONMENT/ServiceBusConnection namespace settings are supplied prerequisites.'} ${stage === 'keys' ? 'POST is initially anonymous: construct its function-level authorization.' : stage === 'binding' ? 'POST initially uses the SDK sender: replace that operation with Out[str] and the queue-output decorator.' : ''} No HTTP capture, request, acceptance or completion proof is seeded.\n\nfunc azure functionapp publish func-orders captures saved sources for https://func-orders.azurewebsites.net; func start captures the local sources and local.settings.json for localhost:7071. These commands model deployment/requests in the browser, with no network, Azure deployment or Python process. The deterministic app address is a teaching address. Cloud settings are read from the actual modeled Function App on each invocation; local settings remain the captured local snapshot. Saving code requires publish/start again.\n\nFunction-level cloud routes check only the supplied dummy x-functions-key header before the handler. Ordinary local Core Tools key enforcement is disabled. Authored demo-only Solution commands deliberately include the fixture key; public evidence/responses and authored explanation prompts exclude its value. This Lab does not teach user identity or production secret management.\n\nOut[str].set stages one value; normal validated response completion flushes it through the actual queue. Failed flush returns 503 with no staged acceptance. This differs from a completed SDK send, which remains accepted if the handler later fails. Neither path runs the worker automatically.\n`,
  }
}

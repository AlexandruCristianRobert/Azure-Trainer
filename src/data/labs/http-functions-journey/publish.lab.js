import { HTTP_PUBLISH_SOURCE, httpHostingProjectFiles } from '../../templates/http-functions-python/hosting.js'
import { httpTask, httpLab, file, command, httpGet, httpCloudGet, httpEnvironmentRead } from './helpers.js'
import { seedHttpStage } from './seeds.js'

const published = measurement => httpEnvironmentRead(measurement, 'published', 'published')
const task = httpTask({ id: 'capture-published-settings',
  text: 'Complete GET environment: call os.getenv("ENVIRONMENT", "unset") and return its actual value in the JSON environment field with application/json. Save function_app.py. Configure the actual func-orders application settings ENVIRONMENT=published and ServiceBusConnection__fullyQualifiedNamespace=sb-orders.servicebus.windows.net. Capture local source with func start and request /api/environment locally; publish saved source with func azure functionapp publish func-orders and request the same route at the modeled cloud address. Observe local versus published. Cloud reads current app settings on invocation; local reads its captured local.settings.json. Editing saved source requires another publish/start.',
  rationale: { concept: 'Saved deployment source and environment-specific configuration',
    what: 'Captures the source for a modeled deployment and consumes an actual environment read in the response.',
    why: 'One Order API can run with distinct local and published configuration without embedding environment values in its handler.',
    without: 'An unused getenv or hard-coded response hides configuration errors; a save without publish leaves the captured source running.',
    csharp: 'A C# isolated worker reads an application setting through Environment.GetEnvironmentVariable or injected configuration and returns JSON with HttpResponseData. Deployment capture and local/cloud settings remain separate from the Python syntax. This is bounded browser simulation, not an Azure deployment pipeline.' },
  hints: ['Pass the read value directly to json.dumps to retain consumption provenance.', 'Set actual cloud app settings before the two requests so both observations share the current resource generation.'],
  solution: { steps: [file('function_app.py', HTTP_PUBLISH_SOURCE),
    command('az functionapp config appsettings set -g rg-messaging -n func-orders --settings ENVIRONMENT=published ServiceBusConnection__fullyQualifiedNamespace=sb-orders.servicebus.windows.net'),
    command('func start'), httpGet('environment'), command('func azure functionapp publish func-orders'), httpCloudGet('environment')] },
  currentCheck: published,
  episodeCheck: observations => observations.some(measurement => httpEnvironmentRead(measurement, 'local', 'local'))
    && observations.some(published),
})
export const httpPublishLab = httpLab({ stage: 'publish', order: 6, title: 'Simulated: Publish the Order API and read app settings',
  brief: 'Supply the new environment response and actual cloud settings on a complete independent validated SDK/retry/status API. App, storage, queue and protected worker/repository prerequisites are supplied; the environment handler is unfinished and no HTTP host/request/proof is seeded.',
  files: httpHostingProjectFiles('publish'), task, currentCheck: published, initialize: run => seedHttpStage(run, 'publish') })

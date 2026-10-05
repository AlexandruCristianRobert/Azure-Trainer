import { SECURITY_RUNTIME_FILES } from './runtime.js'
import { TRAINER_CONNECTION_STRING } from '../../../lib/observability/export.js'

// Disclosed baseline version metadata, never a credential or identity identifier.
export const OLD_SECRET_VERSION = '00000000000040008000000000000101'
export const SECURITY_STARTER_SOURCE = `def main():
    # Read through the attached runtime identity and consume the result.
    return None
`
const secretImports = `from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification
`
export const SECRET_SOLUTION_SOURCE = secretImports + `
def main():
    credential = DefaultAzureCredential()
    client = SecretClient(vault_url="https://kv-orders.vault.azure.net", credential=credential)
    secret = client.get_secret("notification-api-key")
    return send_notification("e-o1", "o1", secret.value, "email")
`
export const ROTATION_SOLUTION_SOURCE = secretImports + `from training_runtime import advance_security_fixture
OLD_VERSION = "${OLD_SECRET_VERSION}"

def main():
    credential = DefaultAzureCredential()
    client = SecretClient(vault_url="https://kv-orders.vault.azure.net", credential=credential)
    old = client.get_secret("notification-api-key", version=OLD_VERSION)
    old_version = old.properties.version
    # The learner-created v2 exists; the fixture changes provider acceptance only.
    advance_security_fixture()
    latest = client.get_secret("notification-api-key")
    accepted = send_notification("e-o1", "o1", latest.value, "email")
    retired = client.get_secret("notification-api-key", version=old_version)
    rejected = send_notification("e-o1", "o1", retired.value, "email")
    return {"latest_status": accepted["status_code"], "old_status": rejected["status_code"]}
`
const configImports = `from azure.identity import DefaultAzureCredential
from azure.appconfiguration.provider import load, SettingSelector, WatchKey
from training_runtime import send_notification, advance_security_fixture
`
export const CONFIGURATION_SOLUTION_SOURCE = configImports + `
def main():
    credential = DefaultAzureCredential()
    config = load(endpoint="https://ac-orders.azconfig.io", credential=credential,
        selects=[SettingSelector(key_filter="Orders:*", label_filter="production")],
        keyvault_credential=credential)
    return send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
`
export const REFRESH_SOLUTION_SOURCE = configImports + `
def main():
    credential = DefaultAzureCredential()
    config = load(endpoint="https://ac-orders.azconfig.io", credential=credential,
        selects=[SettingSelector(key_filter="Orders:*", label_filter="production")],
        refresh_on=[WatchKey("Orders:Sentinel", label="production")], refresh_interval=30,
        keyvault_credential=credential, secret_refresh_interval=60)
    send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
    # 60 seconds: channel/sentinel change and independent private key rotation.
    advance_security_fixture()
    config.refresh()
    send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
    # Another 60 seconds: only the secret rotates; sentinel stays unchanged.
    advance_security_fixture()
    config.refresh()
    return send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
`
export function securityProjectFiles(readme, worker = SECURITY_STARTER_SOURCE) {
  return {
    ...Object.fromEntries(['clients.py', 'producer.py', 'events.py', 'handler.py', 'function_app.py'].map(path => [path, '# Supplied empty module; not used by this script exercise.\n'])),
    'worker.py': worker,
    'host.json': JSON.stringify({ version: '2.0', telemetryMode: 'OpenTelemetry' }, null, 2),
    'local.settings.json': JSON.stringify({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true',
      APPLICATIONINSIGHTS_CONNECTION_STRING: TRAINER_CONNECTION_STRING, PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false' } }, null, 2),
    ...SECURITY_RUNTIME_FILES, 'README.md': readme,
  }
}
export const securityReadme = baseline => `# Order Processing: secure notification (simulated)

${baseline}

Demo only: do not enter real credentials. No Python installation, Azure/network
calls or production SDK executes. Earlier prerequisites are independently supplied
as configuration, with no effects, hosts, operation journal or completion proof.
Save worker.py and run python worker.py for this compact exercise. Reset restores
the baseline and clears proof. Values stay in the modeled vault or private handles;
never print, return, log or serialize a secret. Public responses contain status and
channel only. Provisioning as the learner does not grant the application authority.

Supported subset: DefaultAzureCredential selects an actual attached managed
identity; SecretClient.get_secret(name, version?) returns an opaque value and
properties.version metadata. App Configuration load uses SettingSelector lists,
exact labels, keyvault_credential, WatchKey lists, refresh_interval and independent
secret_refresh_interval. Call config.refresh() explicitly on the same provider.
send_notification is a protected demo consumer returning 202 for a retrieved,
accepted key or 401 otherwise. advance_security_fixture is a disclosed authored
trainer control, changing private resources/provider acceptance and logical time
only; it is not an Azure API. No caller-supplied fixture changes are accepted.
Python lists are supported here, sets are not. Execution is synchronous and bounded
to 50 commands, 500 security records/telemetry rows and 128 KiB extension state.

Protected requirements/runtime contain telemetry and query metadata too:
configure_azure_monitor explicitly chooses the ai-orders trainer destination;
tracer/logger/meter operations export bounded simulated rows. query_telemetry
returns {rows} from retained ai-orders exports using bounded where/project/extend/
summarize/order by/take; unsupported imports, options and KQL produce diagnostics.
No fake production SDK or remote query service runs. Functions host files select
OpenTelemetry and manual Python instrumentation, but these Labs run worker.py.

Python-to-C#: DefaultAzureCredential and SecretClient mirror the same identity
and GetSecret concepts. SettingSelector/load parallels selected labeled settings;
refresh() parallels requesting a provider refresh, not recreating the provider.
Each Task Rationale explains what/why/without and its C# comparison. Solutions
and rationale use the existing independently collapsed UI; explanation prompts
are authored concepts, locally copyable without workspace data.
`

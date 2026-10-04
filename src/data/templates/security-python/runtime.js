import { MESSAGING_RUNTIME_FILES } from '../messaging-python/runtime.js'

export const SECURITY_RUNTIME_FILES = Object.freeze({
  'requirements.txt': MESSAGING_RUNTIME_FILES['requirements.txt'] + 'azure-keyvault-secrets\nazure-appconfiguration-provider\nazure-monitor-opentelemetry\nopentelemetry-api\n',
  'training_runtime.py': MESSAGING_RUNTIME_FILES['training_runtime.py'] + `
def send_notification(event_id, order_id, api_key, channel):
    """Trainer demo provider. Authorizes an actually retrieved opaque secret.
    Returns status_code 202 or 401; never calls a network service.
    """
    pass

def advance_security_fixture():
    """Disclosed trainer control: apply the next authored resource change and
    advance logical time in this execution only. Does not send notifications.
    Configuration selectors/watch keys use lists; Python sets are unsupported.
    """
    pass
`,
})

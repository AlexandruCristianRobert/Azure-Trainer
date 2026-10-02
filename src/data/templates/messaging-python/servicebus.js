import { MESSAGING_RUNTIME_FILES } from './runtime.js'
export { MESSAGING_RUNTIME_FILES } from './runtime.js'
export { MESSAGING_MANIFEST } from './manifest.js'

const clients = `from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient

# Simulated trainer identity: this does not prove real Azure permissions.
credential = DefaultAzureCredential()
bus = ServiceBusClient("sb-orders.servicebus.windows.net", credential=credential)
`
const producer = `from azure.servicebus import ServiceBusMessage
from clients import bus
import json

def main():
    order = {"id": "o1", "region": "EU"}
    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id="m1"))
`
const workerHeader = `from clients import bus
from training_runtime import perform_order_work, record_processed, was_processed
import json

`
export const SERVICEBUS_STARTER_FILES = Object.freeze({
  ...MESSAGING_RUNTIME_FILES,
  'clients.py': clients,
  'producer.py': producer,
  'worker.py': workerHeader + `def main():
    with bus.get_queue_receiver(queue_name="orders", max_wait_time=1) as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            # Do the work, record it, then settle the actual received message.
            raise ValueError("Finish the order worker")
`,
  'events.py': 'def main():\n    raise ValueError("Finish the event publisher in its Lab")\n',
  'handler.py': 'def main():\n    raise ValueError("Finish the event handler in its Lab")\n',
  'function_app.py': '# Functions decorators are introduced in the Functions Lab.\n',
  'host.json': '{\n  "version": "2.0"\n}\n',
  'local.settings.json': '{\n  "IsEncrypted": false,\n  "Values": {"FUNCTIONS_WORKER_RUNTIME": "python"}\n}\n',
  'README.md': '# Orders and notifications\n\nThis is a bounded browser simulation of synchronous Python SDK calls. No Python process, network request, or Azure credential is used. DefaultAzureCredential represents a simulated trainer identity and is not proof of Azure permission.\n\nRun producer.py and then complete worker.py. Use the actual received message when settling. Unsettled PeekLock messages remain locked until logical time expires. The teaching record store is bounded and is not production durability or an exactly-once guarantee.\n',
})

export const SERVICEBUS_SOLUTION_FILES = Object.freeze({
  ...SERVICEBUS_STARTER_FILES,
  'worker.py': workerHeader + `def main():
    with bus.get_queue_receiver(queue_name="orders", max_wait_time=1) as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            if not was_processed(order["id"]):
                perform_order_work(order)
                record_processed(order)
            receiver.complete_message(message)
`,
})

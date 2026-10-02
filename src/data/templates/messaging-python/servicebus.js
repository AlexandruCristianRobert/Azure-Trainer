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

// Stage-specific files keep each independent Lab's new code unfinished.
const unfinishedProducer = `from azure.servicebus import ServiceBusMessage
from clients import bus
import json

def main():
    # Send order o1 (EU, quantity 2) as message m1 to orders.
    raise ValueError("Finish the order producer")
`
const foundationProducer = `from azure.servicebus import ServiceBusMessage
from clients import bus
import json

def main():
    order = {"id": "o1", "region": "EU", "quantity": 2}
    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id="m1"))
`
export const SERVICEBUS_SEND_STARTER_FILES = Object.freeze({ ...SERVICEBUS_STARTER_FILES, 'producer.py': unfinishedProducer })
export const SERVICEBUS_SEND_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_SEND_STARTER_FILES, 'producer.py': foundationProducer })
export const SERVICEBUS_RECEIVE_STARTER_FILES = Object.freeze({ ...SERVICEBUS_STARTER_FILES, 'producer.py': foundationProducer })
export const SERVICEBUS_RECEIVE_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_RECEIVE_STARTER_FILES, 'worker.py': SERVICEBUS_SOLUTION_FILES['worker.py'] })

const quarantineWorker = workerHeader + `def process_orders():
    with bus.get_queue_receiver(queue_name="orders", max_wait_time=1) as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            if order["quantity"] <= 0:
                receiver.dead_letter_message(message, reason="InvalidOrder", error_description="Quantity must be positive")
            else:
                if not was_processed(order["id"]):
                    perform_order_work(order)
                    record_processed(order)
                receiver.complete_message(message)

def main():
    process_orders()
`
const recoveryDriver = `from azure.servicebus import ServiceBusMessage, ServiceBusSubQueue
from clients import bus
from worker import process_orders
import json

def main():
    # One bounded exercise: quarantine, repair the real DLQ receipt, process resend.
    process_orders()
    with bus.get_queue_receiver(queue_name="orders", sub_queue=ServiceBusSubQueue.DEAD_LETTER) as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            print(message.message_id, message.dead_letter_reason)
            order["quantity"] = 1
            with bus.get_queue_sender(queue_name="orders") as sender:
                sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=message.message_id + "-recovered"))
            receiver.complete_message(message)
    process_orders()
`
export const SERVICEBUS_DEADLETTER_STARTER_FILES = Object.freeze({
  ...SERVICEBUS_STARTER_FILES,
  'worker.py': workerHeader + `def process_orders():
    # Reject nonpositive quantity; otherwise work, record and complete.
    raise ValueError("Finish validation and settlement")

def main():
    process_orders()
`,
  'producer.py': `from worker import process_orders

def main():
    # Run the worker, repair actual DLQ receipts, then process corrected resends.
    raise ValueError("Finish the recovery driver")
`,
})
export const SERVICEBUS_DEADLETTER_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_DEADLETTER_STARTER_FILES, 'worker.py': quarantineWorker, 'producer.py': recoveryDriver })

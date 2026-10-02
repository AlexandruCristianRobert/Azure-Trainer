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

export const SERVICEBUS_IDEMPOTENCY_STARTER_FILES = Object.freeze({
  ...SERVICEBUS_RECEIVE_STARTER_FILES,
  'worker.py': workerHeader + `def main():
    # Guard before work; complete both new and duplicate order deliveries.
    raise ValueError("Finish the duplicate-safe worker")
`,
})
export const SERVICEBUS_IDEMPOTENCY_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_IDEMPOTENCY_STARTER_FILES, 'worker.py': SERVICEBUS_SOLUTION_FILES['worker.py'] })

const topicProducer = `from azure.servicebus import ServiceBusMessage
from clients import bus
from worker import process_subscriptions
import json

def main():
    with bus.get_topic_sender(topic_name="order-work") as sender:
        eu = {"id": "o1", "region": "EU", "quantity": 2}
        us = {"id": "o2", "region": "US", "quantity": 1}
        sender.send_messages(ServiceBusMessage(json.dumps(eu), message_id="eu1", application_properties={"region": eu["region"]}))
        sender.send_messages(ServiceBusMessage(json.dumps(us), message_id="us1", application_properties={"region": us["region"]}))
    process_subscriptions()
`
const topicWorker = workerHeader + `def consume_subscription(name):
    with bus.get_subscription_receiver(topic_name="order-work", subscription_name=name) as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            perform_order_work(order)
            record_processed(order)
            receiver.complete_message(message)

def process_subscriptions():
    consume_subscription("eu-orders")
    consume_subscription("all-orders")

def main():
    process_subscriptions()
`
export const SERVICEBUS_TOPICS_STARTER_FILES = Object.freeze({
  ...SERVICEBUS_RECEIVE_SOLUTION_FILES,
  'producer.py': `from clients import bus
from worker import process_subscriptions

def main():
    # Publish EU and US orders with region application properties, then consume.
    raise ValueError("Finish the topic producer")
`,
  'worker.py': workerHeader + `def process_subscriptions():
    # Independently consume eu-orders and all-orders.
    raise ValueError("Finish the subscription consumers")

def main():
    process_subscriptions()
`,
})
export const SERVICEBUS_TOPICS_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_TOPICS_STARTER_FILES, 'producer.py': topicProducer, 'worker.py': topicWorker })

const sessionProducer = `from azure.servicebus import ServiceBusMessage
from clients import bus
from worker import process_steps
import json

def main():
    with bus.get_queue_sender(queue_name="order-steps") as sender:
        first = {"id": "o1", "region": "EU", "quantity": 2, "step": 1}
        other = {"id": "o2", "region": "EU", "quantity": 1, "step": 1}
        second = {"id": "o1", "region": "EU", "quantity": 2, "step": 2}
        sender.send_messages(ServiceBusMessage(json.dumps(first), message_id="o1-step1", session_id=first["id"]))
        sender.send_messages(ServiceBusMessage(json.dumps(other), message_id="o2-step1", session_id=other["id"]))
        sender.send_messages(ServiceBusMessage(json.dumps(second), message_id="o1-step2", session_id=second["id"]))
    process_steps()
`
const sessionWorker = workerHeader + `def process_steps():
    with bus.get_queue_receiver(queue_name="order-steps", session_id="o1") as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            # Each distinct step is work; a whole-order guard would skip step 2.
            perform_order_work(order)
            record_processed(order)
            receiver.complete_message(message)

def main():
    process_steps()
`
export const SERVICEBUS_SESSIONS_STARTER_FILES = Object.freeze({
  ...SERVICEBUS_IDEMPOTENCY_SOLUTION_FILES,
  'producer.py': `from clients import bus
from worker import process_steps

def main():
    # Send o1 step 1, o2 step 1, o1 step 2 with each order's session ID.
    raise ValueError("Finish the session producer")
`,
  'worker.py': workerHeader + `def process_steps():
    # Receive explicit session o1 and process its two distinct steps in order.
    raise ValueError("Finish the session worker")

def main():
    process_steps()
`,
})
export const SERVICEBUS_SESSIONS_SOLUTION_FILES = Object.freeze({ ...SERVICEBUS_SESSIONS_STARTER_FILES, 'producer.py': sessionProducer, 'worker.py': sessionWorker })

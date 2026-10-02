import { SERVICEBUS_STARTER_FILES } from './servicebus.js'
export { MESSAGING_RUNTIME_FILES } from './runtime.js'
export { MESSAGING_MANIFEST } from './manifest.js'

// Event Grid stage retains the earlier prepared rg-messaging/sb-orders namespace.
// Existing Service Bus-only templates do not construct this publisher.
const clients = SERVICEBUS_STARTER_FILES['clients.py'] + `
from azure.eventgrid import EventGridPublisherClient

# Simulated endpoint. No Azure token or network request.
publisher = EventGridPublisherClient("https://evgt-orders.westeurope-1.eventgrid.azure.net/api/events", credential)
`
const events = `from azure.eventgrid import EventGridEvent
from clients import publisher

def main():
    event = EventGridEvent(subject="/orders/eu/o1", event_type="Contoso.OrderProcessed",
                          data={"order_id": "o1"}, data_version="1.0", id="e1")
    publisher.send([event])
`
const handlerHeader = `from training_runtime import record_notification, handler_status, deliver_events

`
export const EVENTGRID_STARTER_FILES = Object.freeze({
  ...SERVICEBUS_STARTER_FILES,
  'clients.py': clients,
  'events.py': 'def main():\n    raise ValueError("Finish the Event Grid publisher")\n',
  'handler.py': handlerHeader + `def handle_event(event):
    raise ValueError("Finish the Event Grid handler")

def main():
    # Trainer callback bridge, not an Azure SDK webhook deployment API.
    deliver_events(handle_event)
`,
  'README.md': SERVICEBUS_STARTER_FILES['README.md'] + '\nThe Event Grid stage retains the prepared rg-messaging/sb-orders namespace and adds evgt-orders. Its clients.py exports both bus and publisher. Run python events.py to publish facts and python handler.py to invoke main() once. The protected deliver_events callback bridge drains registered notifications and bounded retries using logical simulator ticks, with no real waits or webhook deployment. Handler source receives the actual event id, subject, type and data and returns an integer HTTP status. This simulator timing is not the Azure retry schedule and does not promise FIFO or exactly-once delivery.\n',
})
export const EVENTGRID_SOLUTION_FILES = Object.freeze({
  ...EVENTGRID_STARTER_FILES,
  'events.py': events,
  'handler.py': handlerHeader + `def handle_event(event):
    order_id = event.data["order_id"]
    status = handler_status(order_id)
    if status == 200:
        record_notification(event.id, order_id)
    return status

def main():
    # Bounded retries use logical simulator ticks, without real waits.
    deliver_events(handle_event)
`,
})

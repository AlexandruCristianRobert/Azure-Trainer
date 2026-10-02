// Protected teaching scaffold, not a production persistence or identity service.
export const MESSAGING_RUNTIME_FILES = Object.freeze({
  'requirements.txt': 'azure-servicebus\nazure-identity\nazure-eventgrid\nazure-functions\n',
  'training_runtime.py': `"""Bounded trainer record store. No production durability or exactly-once guarantee.
The browser supplies these helpers and fixture-controlled handler status.
perform_order_work is deliberately separate from the idempotent processed marker.
"""
_processed = {}
_work = {}
_notifications = {}

def perform_order_work(order):
    key = order["id"]
    _work[key] = _work.get(key, 0) + 1

def record_processed(order):
    key = order["id"]
    if key not in _processed:
        _processed[key] = order

def was_processed(order_id):
    return order_id in _processed

def record_notification(event_id, order_id):
    if event_id not in _notifications:
        _notifications[event_id] = order_id

def handler_status(order_id):
    return 200
`,
})

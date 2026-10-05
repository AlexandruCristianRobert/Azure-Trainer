import { MESSAGING_RUNTIME_FILES } from '../messaging-python/runtime.js'

export const HTTP_RUNTIME_FILES = Object.freeze({
  ...MESSAGING_RUNTIME_FILES,
  'order_store.py': `"""Trainer-supplied read view over actual queue and processed order state.
This is a bounded browser simulation, not a production database or Azure SDK.
get(order_id) returns a read-only record with id, region, quantity and status,
or None when no matching order exists. Requests never run the worker implicitly.
"""
class OrderStatusRepository:
    def get(self, order_id):
        raise NotImplementedError("Provided by the bounded trainer runtime")
`,
})

import { createResourceGroup, createNamespace, createQueue } from '../../../lib/sandbox/ops.js'
import { applyServiceBusOperation } from '../../../lib/messaging/servicebus.js'
import { ORDERS_TARGET } from './helpers.js'
import { createStorageAccount } from '../../../lib/sandbox/functions.js'

/** Independent fixtures contain configuration and active inputs, never proof. */
export function seedMessagingStage(run, stage) {
  if (!['send', 'receive', 'deadletter', 'idempotency', 'topics', 'sessions', 'publish-events', 'event-filters', 'event-recovery'].includes(stage)) throw new Error(`Unknown messaging fixture: ${stage}`)
  let sandbox = run.sandbox, messaging = run.runtime.messaging
  if (stage !== 'send') {
    sandbox = createResourceGroup(sandbox, { name: 'rg-messaging', location: 'westeurope' }).sandbox
    sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders', sku: 'Standard' }).sandbox
    sandbox = createQueue(sandbox, { resourceGroup: ORDERS_TARGET.resourceGroup, namespace: ORDERS_TARGET.namespace, name: ORDERS_TARGET.queue, maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true }).sandbox
    const inputs = ['topics', 'sessions', 'publish-events', 'event-filters', 'event-recovery'].includes(stage) ? [] : [{ messageId: 'm1', order: { id: 'o1', region: 'EU', quantity: 2 } }]
    if (stage === 'deadletter') inputs.push({ messageId: 'bad', order: { id: 'o2', region: 'EU', quantity: 0 } })
    if (stage === 'idempotency') inputs.push({ messageId: 'm1-retry', order: { id: 'o1', region: 'EU', quantity: 2 } })
    for (const input of inputs) {
      const result = applyServiceBusOperation(messaging, sandbox, { kind: 'send', target: ORDERS_TARGET, message: { messageId: input.messageId, body: JSON.stringify(input.order), properties: {} } })
      if (result.diagnostics.length) throw new Error('Messaging input fixture could not be prepared.')
      messaging = result.state
    }
  }
  if (stage === 'event-recovery') {
    sandbox = createStorageAccount(sandbox, { resourceGroup: 'rg-messaging', name: 'stmessagingorders' }).sandbox
    sandbox.storageAccounts.find(row => row.name === 'stmessagingorders').blobContainers = ['event-deadletters']
  }
  return { sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
}

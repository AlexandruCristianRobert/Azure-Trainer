import { createResourceGroup, createNamespace, createQueue } from '../../../lib/sandbox/ops.js'
import { createStorageAccount, createFunctionApp } from '../../../lib/sandbox/functions.js'
import { applyServiceBusOperation } from '../../../lib/messaging/servicebus.js'
import { ORDERS_TARGET, HTTP_ORDER } from './helpers.js'

/** Genuine prerequisites only; no HTTP extension, request or execution proof. */
export function seedHttpStage(run, stage) {
  if (!['start', 'status', 'validation', 'enqueue', 'retries', 'publish', 'keys', 'binding', 'capstone'].includes(stage)) throw new Error(`Unknown HTTP fixture: ${stage}`)
  let sandbox = createResourceGroup(run.sandbox, { name: 'rg-messaging', location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders', sku: 'Standard' }).sandbox
  sandbox = createQueue(sandbox, { ...ORDERS_TARGET, name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true }).sandbox
  sandbox = createStorageAccount(sandbox, { resourceGroup: 'rg-messaging', name: 'stmessagingorders', location: 'westeurope', kind: 'StorageV2', sku: 'Standard_LRS' }).sandbox
  sandbox = createFunctionApp(sandbox, { resourceGroup: 'rg-messaging', name: 'func-orders', storageAccount: 'stmessagingorders', flexconsumptionLocation: 'westeurope', runtime: 'python', runtimeVersion: '3.12', functionsVersion: '4', osType: 'Linux' }).sandbox
  let messaging = run.runtime.messaging
  if (stage === 'status') {
    const result = applyServiceBusOperation(messaging, sandbox, { kind: 'send', target: ORDERS_TARGET,
      message: { messageId: 'supplied-o1', body: JSON.stringify(HTTP_ORDER), properties: {} } })
    if (result.diagnostics.length) throw new Error('Pending queue prerequisite could not be supplied.')
    messaging = result.state
  }
  return { sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
}

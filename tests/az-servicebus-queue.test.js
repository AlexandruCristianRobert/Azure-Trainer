import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
function withNamespace(sku = 'Standard') {
  let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
  return runLine(sb, `az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku ${sku}`).sandbox
}
const Q = 'az servicebus queue'

describe('az servicebus queue', () => {
  it('create with the Lab flags', () => {
    const r = runLine(withNamespace(), `${Q} create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true`)
    expect(err(r)).toBe('')
    expect(r.latencyMs).toBe(900)
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, maxSizeInMegabytes: 1024, messageCount: 0, requiresSession: false, resourceGroup: 'rg-orders', status: 'Active', type: 'Microsoft.ServiceBus/namespaces/queues' })
    expect(j.countDetails).toEqual({ activeMessageCount: 0, deadLetterMessageCount: 0, scheduledMessageCount: 0, transferDeadLetterMessageCount: 0, transferMessageCount: 0 })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
  })
  it('missing --namespace-name is reported exactly like the design transcript', () => {
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --name orders`))).toBe('the following arguments are required: --namespace-name')
  })
  it('bool and int validation, unknown namespace', () => {
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count five`))).toBe("argument --max-delivery-count: invalid int value: 'five'")
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders --enable-dead-lettering-on-message-expiration yes`))).toBe("argument --enable-dead-lettering-on-message-expiration: invalid choice: 'yes' (choose from 'false', 'true')")
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-nope -n orders`))).toContain("(ResourceNotFound) The Resource 'Microsoft.ServiceBus/namespaces/sb-nope' under resource group 'rg-orders' was not found.")
  })
  it('other flags map to properties', () => {
    const r = runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n q2 --lock-duration PT30S --default-message-time-to-live P14D --max-size 2048 --enable-session true --enable-partitioning false --enable-duplicate-detection true --duplicate-detection-history-time-window PT20M --status Disabled`)
    expect(JSON.parse(out(r))).toMatchObject({ lockDuration: 'PT30S', defaultMessageTimeToLive: 'P14D', maxSizeInMegabytes: 2048, requiresSession: true, enablePartitioning: false, requiresDuplicateDetection: true, duplicateDetectionHistoryTimeWindow: 'PT20M', status: 'Disabled' })
  })
  it('show / list / update / delete', () => {
    let sb = runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders`).sandbox
    expect(JSON.parse(out(runLine(sb, `${Q} show -g rg-orders --namespace-name sb-contoso-orders -n orders`))).maxDeliveryCount).toBe(10)
    expect(JSON.parse(out(runLine(sb, `${Q} list -g rg-orders --namespace-name sb-contoso-orders`)))).toHaveLength(1)
    const u = runLine(sb, `${Q} update -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true`)
    expect(JSON.parse(out(u))).toMatchObject({ maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
    expect(u.events[0]).toMatchObject({ type: 'updated', resourceType: 'queue', name: 'orders' })
    const d = runLine(u.sandbox, `${Q} delete -g rg-orders --namespace-name sb-contoso-orders -n orders`)
    expect(d.lines).toEqual([])
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'queue', name: 'orders' })
    expect(err(runLine(d.sandbox, `${Q} show -g rg-orders --namespace-name sb-contoso-orders -n orders`))).toContain("(NotFound) Entity 'sb-contoso-orders:Queue:orders' was not found.")
  })
  it('re-create on an existing queue emits updated, not created', () => {
    let sb = runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders`).sandbox
    const r = runLine(sb, `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count 7`)
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
    expect(JSON.parse(out(r)).maxDeliveryCount).toBe(7)
  })
})

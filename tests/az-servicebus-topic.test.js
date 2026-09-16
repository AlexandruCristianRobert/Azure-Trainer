import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
function withNamespace(sku = 'Standard') {
  let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
  return runLine(sb, `az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku ${sku}`).sandbox
}
const T = 'az servicebus topic'
const BASE = '-g rg-orders --namespace-name sb-contoso-orders'

describe('az servicebus topic', () => {
  it('create / Basic tier error / missing namespace-name (design transcript)', () => {
    const r = runLine(withNamespace(), `${T} create ${BASE} --name order-events`)
    expect(err(r)).toBe('')
    expect(JSON.parse(out(r))).toMatchObject({ name: 'order-events', subscriptionCount: 0, status: 'Active', type: 'Microsoft.ServiceBus/namespaces/topics' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'topic', name: 'order-events', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
    expect(err(runLine(withNamespace('Basic'), `${T} create ${BASE} --name order-events`))).toBe("(BadRequest) SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.\nCode: BadRequest\nMessage: SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.")
    expect(err(runLine(withNamespace(), `${T} create --name order-events`))).toBe('the following arguments are required: --namespace-name, --resource-group/-g')
    expect(err(runLine(withNamespace(), `${T} create -g rg-orders --name order-events`))).toBe('the following arguments are required: --namespace-name')
  })
  it('show / list / delete', () => {
    let sb = runLine(withNamespace(), `${T} create ${BASE} -n order-events`).sandbox
    expect(JSON.parse(out(runLine(sb, `${T} show ${BASE} -n order-events`))).name).toBe('order-events')
    expect(JSON.parse(out(runLine(sb, `${T} list ${BASE}`)))).toHaveLength(1)
    const d = runLine(sb, `${T} delete ${BASE} -n order-events`)
    expect(d.lines).toEqual([])
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'topic' })
  })
  it('create on an existing topic emits updated, not a second created (Ruling O)', () => {
    let sb = runLine(withNamespace(), `${T} create ${BASE} -n order-events`).sandbox
    const r = runLine(sb, `${T} create ${BASE} -n order-events`)
    expect(err(r)).toBe('')
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'topic', name: 'order-events', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
  })
})

describe('az servicebus topic subscription (+ rule)', () => {
  const S = 'az servicebus topic subscription'
  const R = 'az servicebus topic subscription rule'
  const withTopic = () => runLine(withNamespace(), `${T} create ${BASE} -n order-events`).sandbox

  it('create subscription → $Default rule; list rules', () => {
    const r = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events --name eu-orders`)
    expect(err(r)).toBe('')
    expect(JSON.parse(out(r))).toMatchObject({ name: 'eu-orders', maxDeliveryCount: 10, status: 'Active', type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'subscription', name: 'eu-orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events' }])
    const rules = JSON.parse(out(runLine(r.sandbox, `${R} list ${BASE} --topic-name order-events --subscription-name eu-orders`)))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: '$Default', filterType: 'SqlFilter', sqlFilter: { sqlExpression: '1=1' } })
  })
  it('rule create with SQL filter matches the design output; delete $Default with quotes', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    const r = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`)
    expect(err(r)).toBe('')
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ filterType: 'SqlFilter', name: 'eu-filter', sqlFilter: { requiresPreprocessing: false, sqlExpression: "region = 'EU'" }, type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'rule', name: 'eu-filter', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders' }])
    const d = runLine(r.sandbox, `${R} delete ${BASE} --topic-name order-events --subscription-name eu-orders --name '$Default'`)
    expect(d.lines).toEqual([])
    expect(d.sandbox.namespaces[0].topics[0].subscriptions[0].rules.map((x) => x.name)).toEqual(['eu-filter'])
  })
  it('unquoted $Default expands to empty and fails like bash+az would', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(err(runLine(sb, `${R} delete ${BASE} --topic-name order-events --subscription-name eu-orders --name $Default`))).toBe('argument --name/-n: expected one argument')
  })
  it('SqlFilter without expression, CorrelationFilter with --correlation-id', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(err(runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name r1`))).toBe('A SqlFilter rule requires --filter-sql-expression.')
    const c = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name r2 --filter-type CorrelationFilter --correlation-id abc --label orders`)
    expect(JSON.parse(out(c))).toMatchObject({ filterType: 'CorrelationFilter', correlationFilter: { correlationId: 'abc', label: 'orders' }, sqlFilter: null })
  })
  it('subscription show / list / delete; rule show; not-found wording', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(JSON.parse(out(runLine(sb, `${S} show ${BASE} --topic-name order-events -n eu-orders`))).name).toBe('eu-orders')
    expect(JSON.parse(out(runLine(sb, `${S} list ${BASE} --topic-name order-events`)))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, `${R} show ${BASE} --topic-name order-events --subscription-name eu-orders -n '$Default'`))).name).toBe('$Default')
    expect(err(runLine(sb, `${S} show ${BASE} --topic-name order-events -n nope`))).toContain("(NotFound) Entity 'sb-contoso-orders:Topic:order-events|Subscription:nope' was not found.")
    const d = runLine(sb, `${S} delete ${BASE} --topic-name order-events -n eu-orders`)
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'subscription', name: 'eu-orders' })
    expect(JSON.parse(out(runLine(d.sandbox, `${T} show ${BASE} -n order-events`))).subscriptionCount).toBe(0)
  })
  it('help exists for nested groups', () => {
    expect(out(runLine(createSandbox(), `${R} --help`))).toContain('Group\n    az servicebus topic subscription rule')
    expect(out(runLine(createSandbox(), `${R} create -h`))).toContain('--filter-sql-expression')
  })
  it('create on an existing subscription emits updated, not a second created (Ruling O)', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    const r = runLine(sb, `${S} create ${BASE} --topic-name order-events -n eu-orders`)
    expect(err(r)).toBe('')
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'subscription', name: 'eu-orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events' }])
  })
  it('create on an existing rule emits updated, not a second created (Ruling O)', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    sb = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`).sandbox
    const r = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`)
    expect(err(r)).toBe('')
    expect(r.events).toEqual([{ type: 'updated', resourceType: 'rule', name: 'eu-filter', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders' }])
  })
})

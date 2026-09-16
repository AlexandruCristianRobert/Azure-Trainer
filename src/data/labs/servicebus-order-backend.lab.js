const RG = 'rg-orders'
const NS = 'sb-contoso-orders'

function namespace(sb) {
  return sb.namespaces.find((n) => n.name === NS && n.resourceGroup === RG)
}

export const servicebusOrderBackendLab = {
  id: 'servicebus-order-backend',
  title: 'Order-processing backend on Service Bus',
  skillAreaId: 'connect',
  service: 'service-bus',
  minutes: 50,
  status: 'available',
  brief:
    "Contoso's order API must hand each order to a background processor without losing messages, and fan out order events to regional fulfilment systems. Build the messaging backbone on Azure Service Bus.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-orders` in West Europe.',
      check: (sb) => sb.resourceGroups.some((g) => g.name === RG && g.location === 'westeurope'),
      hints: [
        'Resource groups live under `az group`. Every resource you create later needs one.',
        'Two arguments: `--name` (or `-n`) and `--location` (or `-l`). The region code for West Europe is `westeurope`.',
      ],
      solution: 'az group create --name rg-orders --location westeurope',
      examNote:
        'Every az command that creates an entity needs `--resource-group`; set a default with `az configure --defaults group=rg-orders` to stop repeating it.',
    },
    {
      id: 'namespace',
      text: 'Create a Service Bus namespace `sb-contoso-orders` in `rg-orders` on the Standard tier.',
      check: (sb) => namespace(sb)?.sku === 'Standard',
      hints: [
        'The namespace is the container for queues and topics: `az servicebus namespace create`. Check the tier options with `--help`.',
        '`az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders --sku Standard`. Namespace creation takes a moment.',
      ],
      solution: 'az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders --sku Standard',
      examNote: 'Topics and subscriptions require Standard or Premium. Basic has queues only.',
    },
    {
      id: 'queue',
      text: 'Create a queue named `orders` with max delivery count 5 and dead-lettering on message expiration enabled.',
      check: (sb) => {
        const q = namespace(sb)?.queues.find((x) => x.name === 'orders')
        return !!q && q.maxDeliveryCount === 5 && q.deadLetteringOnMessageExpiration === true
      },
      hints: [
        'Both settings are queue properties; look at `az servicebus queue create --help` for the delivery and dead-letter flags.',
        'Add `--max-delivery-count 5` and `--enable-dead-lettering-on-message-expiration true` to `az servicebus queue create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders`.',
      ],
      solution:
        'az servicebus queue create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true',
      examNote:
        'Max delivery count and dead-lettering on expiry are the two queue settings that route messages to the dead-letter sub-queue at `orders/$DeadLetterQueue`.',
    },
    {
      id: 'topic',
      text: 'Create a topic named `order-events`.',
      check: (sb) => !!namespace(sb)?.topics.find((t) => t.name === 'order-events'),
      hints: [
        'Entity commands always need `--namespace-name` and `--resource-group`; the topic itself needs only `--name`.',
        '`az servicebus topic create --resource-group rg-orders --namespace-name sb-contoso-orders --name order-events`',
      ],
      solution: 'az servicebus topic create --resource-group rg-orders --namespace-name sb-contoso-orders --name order-events',
      examNote: 'A topic has no consumers of its own; nothing is delivered until a subscription exists.',
    },
    {
      id: 'subscription',
      text: "Create a subscription `eu-orders` on `order-events` whose only rule is the SQL filter `region = 'EU'`.",
      check: (sb) => {
        const t = namespace(sb)?.topics.find((x) => x.name === 'order-events')
        const s = t?.subscriptions.find((x) => x.name === 'eu-orders')
        if (!s || s.rules.length !== 1) return false
        const [r] = s.rules
        return r.filterType === 'SqlFilter' && typeof r.sqlExpression === 'string' && r.sqlExpression.replace(/\s+/g, '') === "region='EU'"
      },
      hints: [
        'Subscriptions and their rules are nested under the topic: `az servicebus topic subscription create` and `az servicebus topic subscription rule create`. Then list the rules and look at what is already there.',
        "Create the rule with `--filter-sql-expression \"region = 'EU'\"`, then delete the `$Default` rule (quote it: `--name '$Default'`), otherwise it still matches everything.",
      ],
      solution: [
        'az servicebus topic subscription create --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --name eu-orders',
        `az servicebus topic subscription rule create --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`,
        "az servicebus topic subscription rule delete --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders --name '$Default'",
      ].join('\n'),
      examNote: 'A new subscription gets a `$Default` rule that matches everything. A SQL filter only takes effect once `$Default` is removed.',
    },
  ],
}

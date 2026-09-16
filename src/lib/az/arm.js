import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME, TENANT_ID, USER_NAME } from '../sandbox/model.js'

const SUB = `/subscriptions/${SUBSCRIPTION_ID}`

export function presentResourceGroup(rg) {
  return {
    id: `${SUB}/resourceGroups/${rg.name}`,
    location: rg.location,
    managedBy: null,
    name: rg.name,
    properties: { provisioningState: 'Succeeded' },
    tags: rg.tags,
    type: 'Microsoft.Resources/resourceGroups',
  }
}

function nsId(ns) {
  return `${SUB}/resourceGroups/${ns.resourceGroup}/providers/Microsoft.ServiceBus/namespaces/${ns.name}`
}

export function presentNamespace(ns) {
  return {
    alternateName: null,
    createdAt: ns.createdAt,
    disableLocalAuth: false,
    encryption: null,
    id: nsId(ns),
    identity: null,
    location: ns.location,
    metricId: `${SUBSCRIPTION_ID}:${ns.name}`,
    minimumTlsVersion: '1.2',
    name: ns.name,
    premiumMessagingPartitions: ns.sku === 'Premium' ? 1 : 0,
    privateEndpointConnections: null,
    provisioningState: 'Succeeded',
    publicNetworkAccess: 'Enabled',
    resourceGroup: ns.resourceGroup,
    serviceBusEndpoint: `https://${ns.name}.servicebus.windows.net:443/`,
    sku: { capacity: ns.sku === 'Premium' ? 1 : null, name: ns.sku, tier: ns.sku },
    status: 'Active',
    tags: ns.tags ?? {},
    type: 'Microsoft.ServiceBus/Namespaces',
    updatedAt: ns.createdAt,
    zoneRedundant: ns.sku === 'Premium',
  }
}

const ZERO_COUNTS = { activeMessageCount: 0, deadLetterMessageCount: 0, scheduledMessageCount: 0, transferDeadLetterMessageCount: 0, transferMessageCount: 0 }

export function presentQueue(q, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    countDetails: { ...ZERO_COUNTS },
    createdAt: q.createdAt,
    deadLetteringOnMessageExpiration: q.deadLetteringOnMessageExpiration,
    defaultMessageTimeToLive: q.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: q.duplicateDetectionHistoryTimeWindow,
    enableBatchedOperations: q.enableBatchedOperations,
    enableExpress: false,
    enablePartitioning: q.enablePartitioning,
    forwardDeadLetteredMessagesTo: null,
    forwardTo: null,
    id: `${nsId(ns)}/queues/${q.name}`,
    location: ns.location,
    lockDuration: q.lockDuration,
    maxDeliveryCount: q.maxDeliveryCount,
    maxMessageSizeInKilobytes: ns.sku === 'Premium' ? 1024 : 256,
    maxSizeInMegabytes: q.maxSizeInMegabytes,
    messageCount: 0,
    name: q.name,
    requiresDuplicateDetection: q.requiresDuplicateDetection,
    requiresSession: q.requiresSession,
    resourceGroup: ns.resourceGroup,
    sizeInBytes: 0,
    status: q.status,
    type: 'Microsoft.ServiceBus/namespaces/queues',
    updatedAt: q.createdAt,
  }
}

export function presentTopic(t, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    countDetails: { ...ZERO_COUNTS },
    createdAt: t.createdAt,
    defaultMessageTimeToLive: t.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: t.duplicateDetectionHistoryTimeWindow,
    enableBatchedOperations: t.enableBatchedOperations,
    enableExpress: false,
    enablePartitioning: t.enablePartitioning,
    id: `${nsId(ns)}/topics/${t.name}`,
    location: ns.location,
    maxMessageSizeInKilobytes: ns.sku === 'Premium' ? 1024 : 256,
    maxSizeInMegabytes: t.maxSizeInMegabytes,
    name: t.name,
    requiresDuplicateDetection: t.requiresDuplicateDetection,
    resourceGroup: ns.resourceGroup,
    sizeInBytes: 0,
    status: t.status,
    subscriptionCount: t.subscriptions.length,
    supportOrdering: t.supportOrdering,
    type: 'Microsoft.ServiceBus/namespaces/topics',
    updatedAt: t.createdAt,
  }
}

export function presentSubscription(s, t, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    clientAffineProperties: null,
    countDetails: { ...ZERO_COUNTS },
    createdAt: s.createdAt,
    deadLetteringOnFilterEvaluationExceptions: s.deadLetteringOnFilterEvaluationExceptions,
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration,
    defaultMessageTimeToLive: s.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: null,
    enableBatchedOperations: s.enableBatchedOperations,
    forwardDeadLetteredMessagesTo: null,
    forwardTo: null,
    id: `${nsId(ns)}/topics/${t.name}/subscriptions/${s.name}`,
    isClientAffine: false,
    location: ns.location,
    lockDuration: s.lockDuration,
    maxDeliveryCount: s.maxDeliveryCount,
    messageCount: 0,
    name: s.name,
    requiresSession: s.requiresSession,
    resourceGroup: ns.resourceGroup,
    status: s.status,
    type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions',
    updatedAt: s.createdAt,
  }
}

export function presentRule(r, s, t, ns) {
  return {
    action: {},
    correlationFilter: r.filterType === 'CorrelationFilter' ? { ...r.correlationFilter, requiresPreprocessing: true } : null,
    filterType: r.filterType,
    id: `${nsId(ns)}/topics/${t.name}/subscriptions/${s.name}/rules/${r.name}`,
    location: ns.location,
    name: r.name,
    resourceGroup: ns.resourceGroup,
    sqlFilter: r.filterType === 'SqlFilter' ? { compatibilityLevel: 20, requiresPreprocessing: false, sqlExpression: r.sqlExpression } : null,
    type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules',
  }
}

export function presentAccount() {
  return {
    environmentName: 'AzureCloud',
    homeTenantId: TENANT_ID,
    id: SUBSCRIPTION_ID,
    isDefault: true,
    managedByTenants: [],
    name: SUBSCRIPTION_NAME,
    state: 'Enabled',
    tenantId: TENANT_ID,
    user: { name: USER_NAME, type: 'user' },
  }
}

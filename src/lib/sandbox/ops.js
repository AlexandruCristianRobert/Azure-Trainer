import { cloneSandbox, nowIso } from './model.js'
import { normalizeLocation, LOCATIONS } from './locations.js'
import { AzError, notFoundEntity } from './errors.js'
import { deleteContainerAppResourcesInGroup } from './containerapps.js'
import { deleteCosmosAccountsInGroup } from './cosmosdb.js'
import { deleteKeyVaultsInGroup } from './keyvault.js'
import { deleteFunctionResourcesInGroup } from './functions.js'
import { deleteEventGridTopicsInGroup } from './eventgrid.js'
import { deleteRegistriesInGroup } from './registry.js'
import { deleteIdentitiesInGroup } from './identity.js'
import { deleteAppConfigurationsInGroup } from './appconfiguration.js'
import { deleteFoundryAccountsInGroup } from './foundry.js'
import { deleteAksClustersInGroup } from './aks.js'

const SKUS = ['Basic', 'Standard', 'Premium']
const RG_NAME_RE = /^[-\w.()]{1,90}$/
const NS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]$/
const ENTITY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/~]{0,259}$/
const RULE_NAME_RE = /^[A-Za-z0-9$][A-Za-z0-9$._\-]{0,49}$/

const MAX_TTL = 'P10675199DT2H48M5.4775807S'

export const QUEUE_DEFAULTS = {
  maxDeliveryCount: 10,
  deadLetteringOnMessageExpiration: false,
  defaultMessageTimeToLive: MAX_TTL,
  lockDuration: 'PT1M',
  maxSizeInMegabytes: 1024,
  requiresSession: false,
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: 'PT10M',
  enablePartitioning: false,
  enableBatchedOperations: true,
  status: 'Active',
}

export const TOPIC_DEFAULTS = {
  maxSizeInMegabytes: 1024,
  defaultMessageTimeToLive: MAX_TTL,
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: 'PT10M',
  enablePartitioning: false,
  enableBatchedOperations: true,
  supportOrdering: true,
  status: 'Active',
}

export const SUBSCRIPTION_DEFAULTS = {
  maxDeliveryCount: 10,
  lockDuration: 'PT1M',
  deadLetteringOnMessageExpiration: false,
  deadLetteringOnFilterEvaluationExceptions: true,
  defaultMessageTimeToLive: MAX_TTL,
  requiresSession: false,
  enableBatchedOperations: true,
  status: 'Active',
}

function pickDefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

function requireName(name, re, error) {
  if (typeof name !== 'string' || !re.test(name)) throw error
}

// ---- resource groups -------------------------------------------------------

function findGroup(sb, name) {
  return sb.resourceGroups.find((g) => g.name.toLowerCase() === String(name).toLowerCase())
}

// get* functions return the stored object itself (a read-only borrow, not a
// copy) — callers must not mutate it. list* functions always return a copy.
export function getResourceGroup(sb, name) {
  const g = findGroup(sb, name)
  if (!g) throw new AzError('ResourceGroupNotFound', `Resource group '${name}' could not be found.`)
  return g
}

export function listResourceGroups(sb) {
  return sb.resourceGroups.slice()
}

export function createResourceGroup(sb, { name, location, tags = null }) {
  requireName(name, RG_NAME_RE, new AzError('ResourceGroupNotValid', `Resource group name '${name}' is invalid. Resource group names only allow alphanumeric characters, periods, underscores, hyphens and parenthesis and cannot end in a period.`))
  const loc = normalizeLocation(location)
  if (!loc) throw new AzError('LocationNotAvailableForResourceGroup', `The provided location '${location}' is not available for resource group. List of available regions is '${Object.keys(LOCATIONS).join(',')}'.`)
  const next = cloneSandbox(sb)
  let g = findGroup(next, name)
  if (g) {
    g.location = loc
    g.tags = tags ?? g.tags
  } else {
    g = { name, location: loc, tags, createdAt: nowIso() }
    next.resourceGroups.push(g)
  }
  return { sandbox: next, resource: g }
}

export function deleteResourceGroup(sb, { name }) {
  getResourceGroup(sb, name)
  let next = deleteAksClustersInGroup(sb, name)
  next = deleteContainerAppResourcesInGroup(next, name)
  next = deleteCosmosAccountsInGroup(next, name)
  next.postgresServers = (next.postgresServers ?? []).filter(server => server.resourceGroup.toLowerCase() !== name.toLowerCase())
  next.redisClusters = (next.redisClusters ?? []).filter(cluster => cluster.resourceGroup.toLowerCase() !== name.toLowerCase())
  next = deleteKeyVaultsInGroup(next, name)
  next = deleteAppConfigurationsInGroup(next, name)
  next = deleteFunctionResourcesInGroup(next, name)
  next = deleteEventGridTopicsInGroup(next, name)
  next = deleteRegistriesInGroup(next, name)
  next = deleteFoundryAccountsInGroup(next, name)
  next = deleteIdentitiesInGroup(next, name)
  next.resourceGroups = next.resourceGroups.filter((g) => g.name.toLowerCase() !== name.toLowerCase())
  next.namespaces = next.namespaces.filter((n) => n.resourceGroup.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- namespaces ------------------------------------------------------------

function findNamespace(sb, resourceGroup, name) {
  return sb.namespaces.find(
    (n) => n.resourceGroup.toLowerCase() === String(resourceGroup).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase(),
  )
}

export function getNamespace(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const ns = findNamespace(sb, resourceGroup, name)
  if (!ns) throw new AzError('ResourceNotFound', `The Resource 'Microsoft.ServiceBus/namespaces/${name}' under resource group '${resourceGroup}' was not found. For more details please go to https://aka.ms/ARMResourceNotFoundFix`)
  return ns
}

export function listNamespaces(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.namespaces.slice()
  getResourceGroup(sb, resourceGroup)
  return sb.namespaces.filter((n) => n.resourceGroup.toLowerCase() === resourceGroup.toLowerCase())
}

function checkSku(sku) {
  if (!SKUS.includes(sku)) throw new AzError('InvalidArgumentValue', `argument --sku: invalid choice: '${sku}' (choose from 'Basic', 'Standard', 'Premium')`, { kind: 'cli' })
}

export function createNamespace(sb, { resourceGroup, name, location, sku = 'Standard', tags = null }) {
  const g = getResourceGroup(sb, resourceGroup)
  requireName(name, NS_NAME_RE, new AzError('BadRequest', 'The specified service namespace is invalid. Namespace names must be between 6 and 50 characters long, contain only letters, numbers, and hyphens, start with a letter, and end with a letter or number.'))
  checkSku(sku)
  let loc = g.location
  if (location !== undefined && location !== null) {
    loc = normalizeLocation(location)
    if (!loc) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for resource type 'Microsoft.ServiceBus/namespaces'.`)
  }
  if (sb.namespaces.some((n) => n.name.toLowerCase() === name.toLowerCase() && n.resourceGroup.toLowerCase() !== resourceGroup.toLowerCase())) {
    throw new AzError('Conflict', `The specified name is not available. Namespace '${name}' already exists in another resource group.`)
  }
  const next = cloneSandbox(sb)
  let ns = findNamespace(next, resourceGroup, name)
  if (ns) {
    ns.sku = sku
    ns.tags = tags ?? ns.tags
  } else {
    ns = { name, resourceGroup: g.name, location: loc, sku, tags, createdAt: nowIso(), queues: [], topics: [] }
    next.namespaces.push(ns)
  }
  return { sandbox: next, resource: ns }
}

export function updateNamespace(sb, { resourceGroup, name, sku, tags }) {
  getNamespace(sb, resourceGroup, name)
  if (sku !== undefined) checkSku(sku)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, name)
  if (sku !== undefined) ns.sku = sku
  if (tags !== undefined) ns.tags = tags
  return { sandbox: next, resource: ns }
}

export function deleteNamespace(sb, { resourceGroup, name }) {
  getNamespace(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  next.namespaces = next.namespaces.filter((n) => !(n.resourceGroup.toLowerCase() === resourceGroup.toLowerCase() && n.name.toLowerCase() === name.toLowerCase()))
  return { sandbox: next, resource: null }
}

// ---- queues ----------------------------------------------------------------

function findQueue(ns, name) {
  return ns.queues.find((q) => q.name.toLowerCase() === String(name).toLowerCase())
}

export function getQueue(sb, resourceGroup, namespace, name) {
  const ns = getNamespace(sb, resourceGroup, namespace)
  const q = findQueue(ns, name)
  if (!q) throw notFoundEntity(namespace, 'Queue', name)
  return q
}

export function listQueues(sb, resourceGroup, namespace) {
  return getNamespace(sb, resourceGroup, namespace).queues.slice()
}

export function createQueue(sb, { resourceGroup, namespace, name, ...props }) {
  getNamespace(sb, resourceGroup, namespace)
  requireName(name, ENTITY_NAME_RE, new AzError('BadRequest', `The entity name '${name}' is invalid. Entity names can contain letters, numbers, periods, hyphens, underscores and slashes, and must be 1-260 characters long.`))
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  let q = findQueue(ns, name)
  if (q) {
    Object.assign(q, pickDefined(props))
  } else {
    q = { name, ...QUEUE_DEFAULTS, ...pickDefined(props), createdAt: nowIso() }
    ns.queues.push(q)
  }
  return { sandbox: next, resource: q }
}

export function updateQueue(sb, { resourceGroup, namespace, name, ...props }) {
  getQueue(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const q = findQueue(findNamespace(next, resourceGroup, namespace), name)
  Object.assign(q, pickDefined(props))
  return { sandbox: next, resource: q }
}

export function deleteQueue(sb, { resourceGroup, namespace, name }) {
  getQueue(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  ns.queues = ns.queues.filter((q) => q.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- topics ----------------------------------------------------------------

function findTopic(ns, name) {
  return ns.topics.find((t) => t.name.toLowerCase() === String(name).toLowerCase())
}

export function getTopic(sb, resourceGroup, namespace, name) {
  const ns = getNamespace(sb, resourceGroup, namespace)
  const t = findTopic(ns, name)
  if (!t) throw notFoundEntity(namespace, 'Topic', name)
  return t
}

export function listTopics(sb, resourceGroup, namespace) {
  return getNamespace(sb, resourceGroup, namespace).topics.slice()
}

export function createTopic(sb, { resourceGroup, namespace, name, ...props }) {
  const ns0 = getNamespace(sb, resourceGroup, namespace)
  if (ns0.sku === 'Basic') throw new AzError('BadRequest', `SubCode=40000. Cannot operate on type Topic because the namespace '${namespace}' is using 'Basic' tier.`)
  requireName(name, ENTITY_NAME_RE, new AzError('BadRequest', `The entity name '${name}' is invalid. Entity names can contain letters, numbers, periods, hyphens, underscores and slashes, and must be 1-260 characters long.`))
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  let t = findTopic(ns, name)
  if (t) {
    Object.assign(t, pickDefined(props))
  } else {
    t = { name, ...TOPIC_DEFAULTS, ...pickDefined(props), createdAt: nowIso(), subscriptions: [] }
    ns.topics.push(t)
  }
  return { sandbox: next, resource: t }
}

export function deleteTopic(sb, { resourceGroup, namespace, name }) {
  getTopic(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  ns.topics = ns.topics.filter((t) => t.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- subscriptions ---------------------------------------------------------

function findSubscription(t, name) {
  return t.subscriptions.find((s) => s.name.toLowerCase() === String(name).toLowerCase())
}

export function getSubscription(sb, resourceGroup, namespace, topic, name) {
  const t = getTopic(sb, resourceGroup, namespace, topic)
  const s = findSubscription(t, name)
  if (!s) throw notFoundEntity(namespace, `Topic:${topic}|Subscription`, name)
  return s
}

export function listSubscriptions(sb, resourceGroup, namespace, topic) {
  return getTopic(sb, resourceGroup, namespace, topic).subscriptions.slice()
}

export function createSubscription(sb, { resourceGroup, namespace, topic, name, ...props }) {
  getTopic(sb, resourceGroup, namespace, topic)
  requireName(name, /^[A-Za-z0-9][A-Za-z0-9._\-]{0,49}$/, new AzError('BadRequest', `The subscription name '${name}' is invalid. Subscription names can contain letters, numbers, periods, hyphens and underscores, and must be 1-50 characters long.`))
  const next = cloneSandbox(sb)
  const t = findTopic(findNamespace(next, resourceGroup, namespace), topic)
  let s = findSubscription(t, name)
  if (s) {
    Object.assign(s, pickDefined(props))
  } else {
    s = {
      name,
      ...SUBSCRIPTION_DEFAULTS,
      ...pickDefined(props),
      createdAt: nowIso(),
      rules: [{ name: '$Default', filterType: 'SqlFilter', sqlExpression: '1=1', correlationFilter: null, createdAt: nowIso() }],
    }
    t.subscriptions.push(s)
  }
  return { sandbox: next, resource: s }
}

export function deleteSubscription(sb, { resourceGroup, namespace, topic, name }) {
  getSubscription(sb, resourceGroup, namespace, topic, name)
  const next = cloneSandbox(sb)
  const t = findTopic(findNamespace(next, resourceGroup, namespace), topic)
  t.subscriptions = t.subscriptions.filter((s) => s.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- rules -----------------------------------------------------------------

function findRule(s, name) {
  return s.rules.find((r) => r.name.toLowerCase() === String(name).toLowerCase())
}

export function getRule(sb, resourceGroup, namespace, topic, subscription, name) {
  const s = getSubscription(sb, resourceGroup, namespace, topic, subscription)
  const r = findRule(s, name)
  if (!r) throw notFoundEntity(namespace, `Topic:${topic}|Subscription:${subscription}|Rule`, name)
  return r
}

export function listRules(sb, resourceGroup, namespace, topic, subscription) {
  return getSubscription(sb, resourceGroup, namespace, topic, subscription).rules.slice()
}

export function createRule(sb, { resourceGroup, namespace, topic, subscription, name, filterType = 'SqlFilter', sqlExpression = null, correlationFilter = null }) {
  getSubscription(sb, resourceGroup, namespace, topic, subscription)
  requireName(name, RULE_NAME_RE, new AzError('BadRequest', `The rule name '${name}' is invalid. Rule names can contain letters, numbers, periods, hyphens, underscores and the dollar sign, and must be 1-50 characters long.`))
  if (filterType === 'SqlFilter' && !sqlExpression) throw new AzError('BadRequest', 'A SqlFilter rule requires --filter-sql-expression.', { kind: 'cli' })
  if (filterType === 'CorrelationFilter' && !correlationFilter) throw new AzError('BadRequest', 'A CorrelationFilter rule requires at least one correlation property (e.g. --correlation-id or --label).', { kind: 'cli' })
  const next = cloneSandbox(sb)
  const s = findSubscription(findTopic(findNamespace(next, resourceGroup, namespace), topic), subscription)
  let r = findRule(s, name)
  const body = { filterType, sqlExpression: filterType === 'SqlFilter' ? sqlExpression : null, correlationFilter: filterType === 'CorrelationFilter' ? correlationFilter : null }
  if (r) {
    Object.assign(r, body)
  } else {
    r = { name, ...body, createdAt: nowIso() }
    s.rules.push(r)
  }
  return { sandbox: next, resource: r }
}

export function deleteRule(sb, { resourceGroup, namespace, topic, subscription, name }) {
  getRule(sb, resourceGroup, namespace, topic, subscription, name)
  const next = cloneSandbox(sb)
  const s = findSubscription(findTopic(findNamespace(next, resourceGroup, namespace), topic), subscription)
  s.rules = s.rules.filter((r) => r.name.toLowerCase() !== String(name).toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- defaults --------------------------------------------------------------

export function setDefaults(sb, { group, location }) {
  const next = cloneSandbox(sb)
  if (group !== undefined) next.defaults.group = group === '' ? null : group
  if (location !== undefined) next.defaults.location = location === '' ? null : location
  return { sandbox: next, resource: next.defaults }
}

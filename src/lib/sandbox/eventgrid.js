import { cloneSandbox, nowIso, SUBSCRIPTION_ID } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'
import { getResourceGroup } from './ops.js'
import { isValidEventGridWebhookEndpoint, validRetryValue, resolveEventGridFunction, resolveEventGridDeadLetter } from './eventgrid-validation.js'

const TOPIC_NAME_RE = /^(?=.{3,50}$)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/
const SUBSCRIPTION_NAME_RE = /^(?=.{3,64}$)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function findTopic(sandbox, resourceGroup, name) {
  return sandbox.eventGridTopics.find((topic) => same(topic.resourceGroup, resourceGroup) && same(topic.name, name))
}

function findTopicByName(sandbox, name) {
  return sandbox.eventGridTopics.find((topic) => same(topic.name, name))
}

function findSubscription(topic, name) {
  return topic.eventSubscriptions.find((subscription) => same(subscription.name, name))
}

function requireName(name, pattern, type) {
  if (typeof name !== 'string' || !pattern.test(name)) {
    throw new AzError('BadRequest', `The Event Grid ${type} name '${name}' is invalid. Names must be 3-${type === 'topic' ? 50 : 64} ASCII letters, digits or hyphens, and start and end with a letter or digit.`)
  }
}

function requireTags(tags) {
  if (tags !== null && (typeof tags !== 'object' || Array.isArray(tags) || Object.values(tags).some((value) => typeof value !== 'string'))) {
    throw new AzError('InvalidArgumentValue', 'Event Grid tags must be a dictionary of string values.', { kind: 'cli' })
  }
}

function resolveLocation(location, group) {
  const resolved = location === undefined || location === null ? group.location : normalizeLocation(location)
  if (!resolved) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for resource type 'Microsoft.EventGrid/topics'.`)
  return resolved
}

function requireInputSchema(inputSchema) {
  if (inputSchema !== 'EventGridSchema') {
    throw new AzError('InvalidArgumentValue', `Only EventGridSchema is supported in the Sandbox; received '${inputSchema}'.`, { kind: 'cli' })
  }
}

function requireEndpointType(endpointType) {
  if (!['WebHook', 'AzureFunction'].includes(endpointType)) {
    throw new AzError('InvalidArgumentValue', `Supported endpoint types are WebHook and AzureFunction; received '${endpointType}'.`, { kind: 'cli' })
  }
}

function requireEndpoint(endpoint, endpointType, sandbox) {
  if (endpointType === 'AzureFunction') {
    if (!resolveEventGridFunction(sandbox, endpoint, SUBSCRIPTION_ID)) throw new AzError('InvalidArgumentValue', 'AzureFunction endpoint must resolve to an existing Function App and a /functions/name ARM resource path.', { kind: 'cli' })
  } else if (!isValidEventGridWebhookEndpoint(endpoint)) {
    throw new AzError('InvalidArgumentValue', `Webhook endpoint '${endpoint}' is invalid. Use an HTTPS URL without userinfo, query string or fragment.`, { kind: 'cli' })
  }
}

function recoveryFor(sandbox, values) {
  const fields = {}
  for (const [field, maximum] of [['maxDeliveryAttempts', 30], ['eventTimeToLiveInMinutes', 1440]]) {
    if (values[field] === undefined) continue
    if (!validRetryValue(values[field], maximum)) throw new AzError('InvalidArgumentValue', `${field} must be an integer between 1 and ${maximum}.`, { kind: 'cli' })
    fields[field] = values[field]
  }
  if (values.deadLetterDestination !== undefined) {
    const resolved = resolveEventGridDeadLetter(sandbox, values.deadLetterDestination, SUBSCRIPTION_ID)
    if (!resolved) throw new AzError('InvalidArgumentValue', 'Dead-letter destination must resolve to an existing prepared storage account/container ARM identity.', { kind: 'cli' })
    const account = sandbox.storageAccounts.find(account => same(account.name, resolved.account) && same(account.resourceGroup, resolved.resourceGroup))
    fields.deadLetterDestination = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${account.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account.name}/blobServices/default/containers/${resolved.container}`
  }
  return fields
}

function normalizeEventTypes(value) {
  if (!Array.isArray(value)) throw new AzError('InvalidArgumentValue', '--included-event-types must be a list of event types.', { kind: 'cli' })
  if (value.length === 0 || (value.length === 1 && value[0] === 'All')) return []
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new AzError('InvalidArgumentValue', '--included-event-types cannot contain empty event types.', { kind: 'cli' })
  }
  if (value.includes('All')) {
    throw new AzError('InvalidArgumentValue', "'All' cannot be combined with explicit included event types.", { kind: 'cli' })
  }
  return [...new Set(value)]
}

function requireSubject(value, flag) {
  if (typeof value !== 'string') throw new AzError('InvalidArgumentValue', `argument ${flag}: expected one argument`, { kind: 'cli' })
  if (/[*?]/.test(value)) throw new AzError('InvalidArgumentValue', `${flag} does not support wildcard characters in the Sandbox.`, { kind: 'cli' })
}

function filterFor(values, current = null) {
  const filter = current ? { ...current, includedEventTypes: [...current.includedEventTypes] } : {
    includedEventTypes: [],
    subjectBeginsWith: '',
    subjectEndsWith: '',
    isSubjectCaseSensitive: false,
  }
  if (values.includedEventTypes !== undefined) filter.includedEventTypes = normalizeEventTypes(values.includedEventTypes)
  if (values.subjectBeginsWith !== undefined) {
    requireSubject(values.subjectBeginsWith, '--subject-begins-with')
    filter.subjectBeginsWith = values.subjectBeginsWith
  }
  if (values.subjectEndsWith !== undefined) {
    requireSubject(values.subjectEndsWith, '--subject-ends-with')
    filter.subjectEndsWith = values.subjectEndsWith
  }
  if (values.isSubjectCaseSensitive !== undefined) {
    if (typeof values.isSubjectCaseSensitive !== 'boolean') throw new AzError('InvalidArgumentValue', '--subject-case-sensitive must be true or false.', { kind: 'cli' })
    filter.isSubjectCaseSensitive = values.isSubjectCaseSensitive
  }
  return filter
}

export function getEventGridTopic(sandbox, resourceGroup, name) {
  getResourceGroup(sandbox, resourceGroup)
  const topic = findTopic(sandbox, resourceGroup, name)
  if (!topic) throw new AzError('ResourceNotFound', `The Event Grid topic '${name}' under resource group '${resourceGroup}' was not found.`)
  return topic
}

export function listEventGridTopics(sandbox, resourceGroup = null) {
  if (resourceGroup === null) return sandbox.eventGridTopics.slice()
  getResourceGroup(sandbox, resourceGroup)
  return sandbox.eventGridTopics.filter((topic) => same(topic.resourceGroup, resourceGroup))
}

export function createEventGridTopic(sandbox, { resourceGroup, name, location, inputSchema, tags }) {
  const group = getResourceGroup(sandbox, resourceGroup)
  requireName(name, TOPIC_NAME_RE, 'topic')
  if (tags !== undefined) requireTags(tags)
  const current = findTopic(sandbox, resourceGroup, name)
  const collision = findTopicByName(sandbox, name)
  if (collision && !same(collision.resourceGroup, resourceGroup)) {
    throw new AzError('Conflict', `The Event Grid topic name '${name}' is already used by '${collision.name}' in resource group '${collision.resourceGroup}'.`)
  }
  const resolvedLocation = current ? current.location : resolveLocation(location, group)
  const desiredSchema = inputSchema ?? (current ? current.inputSchema : 'EventGridSchema')
  requireInputSchema(desiredSchema)
  if (current && location !== undefined && !same(resolveLocation(location, group), current.location)) {
    throw new AzError('Conflict', `The Event Grid topic '${current.name}' location cannot be changed after creation. Delete and recreate the topic to change its location.`, { kind: 'cli' })
  }
  if (current && inputSchema !== undefined && inputSchema !== current.inputSchema) {
    throw new AzError('Conflict', `The Event Grid topic '${current.name}' input schema cannot be changed after creation. Delete and recreate the topic to change its schema.`, { kind: 'cli' })
  }
  const next = cloneSandbox(sandbox)
  let topic = findTopic(next, resourceGroup, name)
  if (topic) {
    if (tags !== undefined) topic.tags = tags
  } else {
    topic = { name, resourceGroup: group.name, location: resolvedLocation, inputSchema: desiredSchema, tags: tags ?? null, createdAt: nowIso(), eventSubscriptions: [] }
    next.eventGridTopics.push(topic)
  }
  return { sandbox: next, resource: topic }
}

export function deleteEventGridTopic(sandbox, { resourceGroup, name }) {
  const resource = getEventGridTopic(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  next.eventGridTopics = next.eventGridTopics.filter((topic) => !(same(topic.resourceGroup, resourceGroup) && same(topic.name, name)))
  return { sandbox: next, resource }
}

export function deleteEventGridTopicsInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  next.eventGridTopics = next.eventGridTopics.filter((topic) => !same(topic.resourceGroup, resourceGroup))
  return next
}

export function getEventGridSubscription(sandbox, resourceGroup, topicName, name) {
  const topic = getEventGridTopic(sandbox, resourceGroup, topicName)
  const subscription = findSubscription(topic, name)
  if (!subscription) throw new AzError('ResourceNotFound', `The Event Grid subscription '${name}' under topic '${topicName}' was not found.`)
  return subscription
}

export function listEventGridSubscriptions(sandbox, resourceGroup, topicName) {
  return getEventGridTopic(sandbox, resourceGroup, topicName).eventSubscriptions.slice()
}

export function createEventGridSubscription(sandbox, { resourceGroup, topicName, name, endpointType, endpoint, ...values }) {
  const topic = getEventGridTopic(sandbox, resourceGroup, topicName)
  requireName(name, SUBSCRIPTION_NAME_RE, 'subscription')
  const resolvedType = endpointType ?? 'WebHook'
  requireEndpointType(resolvedType)
  requireEndpoint(endpoint, resolvedType, sandbox)
  const recovery = recoveryFor(sandbox, values)
  const filter = filterFor(values, findSubscription(topic, name)?.filter ?? null)
  const next = cloneSandbox(sandbox)
  const storedTopic = findTopic(next, resourceGroup, topicName)
  let subscription = findSubscription(storedTopic, name)
  if (subscription) {
    subscription.endpointType = resolvedType
    subscription.endpoint = endpoint
    subscription.filter = filter
  } else {
    subscription = { name, endpointType: resolvedType, endpoint, filter, createdAt: nowIso() }
    storedTopic.eventSubscriptions.push(subscription)
  }
  Object.assign(subscription, recovery)
  return { sandbox: next, resource: subscription, topic: storedTopic }
}

export function updateEventGridSubscription(sandbox, { resourceGroup, topicName, name, endpoint, endpointType, ...values }) {
  const current = getEventGridSubscription(sandbox, resourceGroup, topicName, name)
  if (endpointType !== undefined) requireEndpointType(endpointType)
  requireEndpoint(endpoint ?? current.endpoint, endpointType ?? current.endpointType, sandbox)
  const recovery = recoveryFor(sandbox, values)
  const filter = filterFor(values, current.filter)
  const next = cloneSandbox(sandbox)
  const topic = findTopic(next, resourceGroup, topicName)
  const subscription = findSubscription(topic, name)
  if (endpointType !== undefined) subscription.endpointType = endpointType
  if (endpoint !== undefined) subscription.endpoint = endpoint
  subscription.filter = filter
  Object.assign(subscription, recovery)
  return { sandbox: next, resource: subscription, topic }
}

export function deleteEventGridSubscription(sandbox, { resourceGroup, topicName, name }) {
  const topic = getEventGridTopic(sandbox, resourceGroup, topicName)
  const resource = getEventGridSubscription(sandbox, resourceGroup, topicName, name)
  const next = cloneSandbox(sandbox)
  const storedTopic = findTopic(next, resourceGroup, topicName)
  storedTopic.eventSubscriptions = storedTopic.eventSubscriptions.filter((subscription) => !same(subscription.name, name))
  return { sandbox: next, resource, topic }
}

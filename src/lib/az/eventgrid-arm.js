import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { parseEventGridDeadLetterDestination } from '../sandbox/eventgrid-validation.js'

const subscription = `/subscriptions/${SUBSCRIPTION_ID}`

export function eventGridTopicId(topic) {
  return `${subscription}/resourceGroups/${topic.resourceGroup}/providers/Microsoft.EventGrid/topics/${topic.name}`
}

export function eventGridSubscriptionId(topic, resource) {
  return `${eventGridTopicId(topic)}/eventSubscriptions/${resource.name}`
}

export function presentEventGridTopic(topic) {
  return {
    id: eventGridTopicId(topic),
    location: topic.location,
    name: topic.name,
    properties: { inputSchema: topic.inputSchema, provisioningState: 'Succeeded' },
    resourceGroup: topic.resourceGroup,
    tags: topic.tags ?? {},
    type: 'Microsoft.EventGrid/topics',
  }
}

export function presentEventGridSubscription(resource, topic) {
  return {
    id: eventGridSubscriptionId(topic, resource),
    name: resource.name,
    properties: {
      destination: { endpointType: resource.endpointType, properties: resource.endpointType === 'AzureFunction' ? { resourceId: resource.endpoint } : { endpointUrl: resource.endpoint } },
      ...(resource.maxDeliveryAttempts !== undefined || resource.eventTimeToLiveInMinutes !== undefined ? { retryPolicy: { maxDeliveryAttempts: resource.maxDeliveryAttempts ?? 30, eventTimeToLiveInMinutes: resource.eventTimeToLiveInMinutes ?? 1440 } } : {}),
      ...(resource.deadLetterDestination === undefined ? {} : { deadLetterDestination: { endpointType: 'StorageBlob', properties: { resourceId: parseEventGridDeadLetterDestination(resource.deadLetterDestination).resourceId, blobContainerName: parseEventGridDeadLetterDestination(resource.deadLetterDestination).container } } }),
      filter: {
        includedEventTypes: resource.filter.includedEventTypes,
        isSubjectCaseSensitive: resource.filter.isSubjectCaseSensitive,
        subjectBeginsWith: resource.filter.subjectBeginsWith,
        subjectEndsWith: resource.filter.subjectEndsWith,
      },
      provisioningState: 'Succeeded',
    },
    resourceGroup: topic.resourceGroup,
    type: 'Microsoft.EventGrid/topics/eventSubscriptions',
  }
}

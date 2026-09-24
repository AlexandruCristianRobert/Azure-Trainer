import { SUBSCRIPTION_ID } from '../sandbox/model.js'

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
      destination: { endpointType: 'WebHook', properties: { endpointUrl: resource.endpoint } },
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

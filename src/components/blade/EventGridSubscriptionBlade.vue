<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'

const props = defineProps({
  resourceGroup: { type: String, required: true },
  topic: { type: String, required: true },
  name: { type: String, required: true },
})
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const topicResource = computed(() => (run.sandbox.eventGridTopics ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.topic)))
const subscription = computed(() => topicResource.value?.eventSubscriptions?.find((item) => same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }] },
  { label: 'Settings', items: [{ id: 'filters', label: 'Filters' }, { id: 'properties', label: 'Properties' }] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az eventgrid topic event-subscription delete --name <name> --resource-group <group> --topic-name <topic> --yes') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const resourceGroupName = computed(() => topicResource.value?.resourceGroup ?? props.resourceGroup)
const topicName = computed(() => topicResource.value?.name ?? props.topic)
const subscriptionName = computed(() => subscription.value?.name ?? props.name)
const essentials = computed(() => {
  const filter = subscription.value?.filter
  return [
    { label: 'Resource group', value: resourceGroupName.value, blade: { kind: 'resource-group', name: resourceGroupName.value } },
    { label: 'Topic', value: topicName.value, blade: { kind: 'eventgrid-topic', resourceGroup: resourceGroupName.value, name: topicName.value } },
    { label: 'Endpoint type', value: subscription.value?.endpointType ?? '' },
    { label: 'Endpoint', value: subscription.value?.endpoint ?? '' },
    { label: 'Included event types', value: filter?.includedEventTypes?.length ? filter.includedEventTypes.join(', ') : 'All event types' },
    { label: 'Subject begins with', value: filter?.subjectBeginsWith || 'Any prefix' },
    { label: 'Subject ends with', value: filter?.subjectEndsWith || 'Any suffix' },
    { label: 'Subject case sensitive', value: filter?.isSubjectCaseSensitive ? 'Yes' : 'No' },
  ]
})
</script>

<template>
  <section class="blade eventgrid-subscription-blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroupName, blade: { kind: 'resource-group', name: resourceGroupName } }, { label: topicName, blade: { kind: 'eventgrid-topic', resourceGroup: resourceGroupName, name: topicName } }, { label: subscriptionName, blade: null }]" :title="subscriptionName" subtitle="Event Grid event subscription" icon="event-grid" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid class="eventgrid-subscription-essentials" :items="essentials" @navigate="portal.showBlade($event)" />
      <p class="blade__hint eventgrid-subscription-note">Configuration only: the Sandbox does not deliver events or call this webhook endpoint.</p>
    </div>
  </section>
</template>

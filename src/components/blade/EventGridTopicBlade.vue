<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({
  resourceGroup: { type: String, required: true },
  name: { type: String, required: true },
})
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const topic = computed(() => (run.sandbox.eventGridTopics ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Entities', items: [{ id: 'event-subscriptions', label: 'Event subscriptions' }] },
  { label: 'Settings', items: [{ id: 'configuration', label: 'Configuration' }, { id: 'networking', label: 'Networking' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create event subscription', icon: 'add', readOnlyHint: RO('az eventgrid topic event-subscription create --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az eventgrid topic delete --name <name> --resource-group <group> --yes') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const resourceGroupName = computed(() => topic.value?.resourceGroup ?? props.resourceGroup)
const topicName = computed(() => topic.value?.name ?? props.name)
const essentials = computed(() => [
  { label: 'Name', value: topicName.value },
  { label: 'Resource group', value: resourceGroupName.value, blade: { kind: 'resource-group', name: resourceGroupName.value } },
  { label: 'Location', value: displayLocation(topic.value?.location) },
  { label: 'Input schema', value: topic.value?.inputSchema ?? '' },
])
const columns = [
  { key: 'name', label: 'Name', grow: 1.2 },
  { key: 'endpointType', label: 'Endpoint type', grow: 0.9 },
  { key: 'endpoint', label: 'Endpoint', grow: 2 },
]
const rows = computed(() => (topic.value?.eventSubscriptions ?? []).map((subscription) => ({
  name: subscription.name,
  endpointType: subscription.endpointType,
  endpoint: subscription.endpoint,
})))
</script>

<template>
  <section class="blade eventgrid-topic-blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroupName, blade: { kind: 'resource-group', name: resourceGroupName } }, { label: topicName, blade: null }]" :title="topicName" subtitle="Event Grid topic" icon="event-grid" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid class="eventgrid-topic-essentials" :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Event subscriptions</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter event subscriptions..." aria-label="Filter event subscriptions" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable class="eventgrid-topic-subscriptions" :columns="columns" :rows="rows" empty-text="No event subscriptions in this topic" @open="portal.showBlade({ kind: 'eventgrid-subscription', resourceGroup: resourceGroupName, topic: topicName, name: $event.name })" />
    </div>
  </section>
</template>

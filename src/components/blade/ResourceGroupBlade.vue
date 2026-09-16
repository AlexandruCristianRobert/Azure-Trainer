<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME } from '../../lib/sandbox/model.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
// This Blade only ever renders the Overview content (no per-item sections exist yet);
// clicking anything else still looks clickable but must not move the highlight.
function onMenu(id) {
  if (id !== 'overview') return
  active.value = id
}
const group = computed(() => run.sandbox.resourceGroups.find((g) => g.name.toLowerCase() === props.name.toLowerCase()))
const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'visualizer', label: 'Resource visualizer' }, { id: 'events', label: 'Events' }] },
  { label: 'Settings', items: [{ id: 'deployments', label: 'Deployments' }, { id: 'security', label: 'Security' }, { id: 'policies', label: 'Policies' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Cost Management', collapsed: true, items: [] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
const HINT = 'Blades are read-only in this Lab. Create resources from the Cloud Shell, e.g. az servicebus namespace create --help'
const commands = [
  { label: 'Create', icon: 'add', readOnlyHint: HINT },
  { label: 'Manage view', icon: 'settings' },
  { label: 'Delete resource group', icon: 'delete', readOnlyHint: 'Blades are read-only in this Lab. Use the Cloud Shell: az group delete --name <name> --yes' },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Export to CSV', icon: 'arrow-upload' },
  { label: 'Open query', icon: 'open' },
  { divider: true },
  { label: 'Move', icon: 'folder-arrow-right' },
  { label: 'Assign tags', icon: 'tag' },
]
const essentials = computed(() => [
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Deployments', value: 'No deployments', link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Location', value: displayLocation(group.value?.location) },
  { label: 'Tags', value: group.value?.tags ? Object.entries(group.value.tags).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Add tags', link: !group.value?.tags },
])
const columns = [{ key: 'name', label: 'Name', grow: 1.6 }, { key: 'type', label: 'Type', grow: 1.2 }, { key: 'location', label: 'Location', grow: 1 }]
const rows = computed(() => run.sandbox.namespaces.filter((n) => n.resourceGroup.toLowerCase() === props.name.toLowerCase()).map((n) => ({ name: n.name, type: 'Service Bus Namespace', location: displayLocation(n.location), resourceGroup: n.resourceGroup })))
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: name, blade: null }]" :title="name" subtitle="Resource group" icon="resource-group" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" />
      <h3 class="blade__section-title">Resources</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter resources" /><span class="blade__count">Showing 1 to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No resources to display" @open="portal.showBlade({ kind: 'servicebus-namespace', resourceGroup: $event.resourceGroup, name: $event.name, tab: 'queues' })" />
    </div>
  </section>
</template>

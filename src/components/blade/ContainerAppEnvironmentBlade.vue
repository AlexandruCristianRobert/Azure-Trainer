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

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const environment = computed(() => (run.sandbox.containerAppEnvironments ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Settings', items: [{ id: 'apps', label: 'Container apps' }, { id: 'networking', label: 'Networking' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create app', icon: 'add', readOnlyHint: RO('az containerapp create --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az containerapp env delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Move', icon: 'folder-arrow-right' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Status', value: 'Active' },
  { label: 'Location', value: displayLocation(environment.value?.location) },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Tags', value: formatTags(environment.value?.tags), link: true },
])
const columns = [
  { key: 'name', label: 'Name', grow: 1.5 },
  { key: 'resourceGroup', label: 'Resource group', grow: 1.3 },
  { key: 'location', label: 'Location', grow: 1 },
]
const rows = computed(() => (run.sandbox.containerApps ?? [])
  .filter((app) => same(app.environment, props.name) && same(app.environmentResourceGroup, props.resourceGroup))
  .map((app) => ({ name: app.name, resourceGroup: app.resourceGroup, location: displayLocation(app.location) })))

function formatTags(tags) {
  return tags && Object.keys(tags).length ? Object.entries(tags).map(([key, value]) => `${key}: ${value}`).join(', ') : 'Add tags'
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Container Apps Environment" icon="container-apps" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Container apps</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter container apps" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No container apps in this environment" @open="portal.showBlade({ kind: 'containerapp', resourceGroup: $event.resourceGroup, name: $event.name })" />
    </div>
  </section>
</template>

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
const account = computed(() => (run.sandbox.cosmosAccounts ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Data Explorer', items: [{ id: 'data-explorer', label: 'Data Explorer' }] },
  { label: 'Settings', items: [{ id: 'features', label: 'Features' }, { id: 'replicate', label: 'Replicate data globally' }, { id: 'consistency', label: 'Default consistency' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create database', icon: 'add', readOnlyHint: RO('az cosmosdb sql database create --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az cosmosdb delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Account API', value: 'Azure Cosmos DB for NoSQL' },
  { label: 'Location', value: displayLocation(account.value?.location) },
  { label: 'Default consistency', value: account.value?.defaultConsistencyLevel ?? 'Session' },
  { label: 'Vector search', value: account.value?.capabilities?.includes('EnableNoSQLVectorSearch') ? 'Enabled' : 'Not enabled' },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Tags', value: formatTags(account.value?.tags), link: true },
])
const columns = [
  { key: 'name', label: 'Database id', grow: 1.7 },
  { key: 'containers', label: 'Containers', grow: 1 },
  { key: 'createdAt', label: 'Created', grow: 1.4 },
]
const rows = computed(() => (account.value?.databases ?? []).map((database) => ({
  name: database.name,
  containers: database.containers?.length ?? 0,
  createdAt: formatDate(database.createdAt),
})))

function formatTags(tags) {
  return tags && Object.keys(tags).length ? Object.entries(tags).map(([key, value]) => `${key}: ${value}`).join(', ') : 'None'
}
function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Unknown'
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Azure Cosmos DB account" icon="cosmos-db" icon-tint="var(--tint-purple)" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Databases</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter databases..." aria-label="Filter databases" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No databases in this account" @open="portal.showBlade({ kind: 'cosmos-database', resourceGroup, account: name, name: $event.name })" />
    </div>
  </section>
</template>

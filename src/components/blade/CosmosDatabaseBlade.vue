<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME } from '../../lib/sandbox/model.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({
  resourceGroup: { type: String, required: true },
  account: { type: String, required: true },
  name: { type: String, required: true },
})
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const accountResource = computed(() => (run.sandbox.cosmosAccounts ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.account)))
const database = computed(() => accountResource.value?.databases?.find((item) => item.name === props.name))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }] },
  { label: 'Data Explorer', items: [{ id: 'data-explorer', label: 'Data Explorer' }] },
  { label: 'Settings', items: [{ id: 'scale', label: 'Scale' }, { id: 'properties', label: 'Properties' }] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create container', icon: 'add', readOnlyHint: RO('az cosmosdb sql container create --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az cosmosdb sql database delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Account', value: props.account, blade: { kind: 'cosmos-account', resourceGroup: props.resourceGroup, name: props.account } },
  { label: 'Database id', value: database.value?.name ?? props.name },
  { label: 'Containers', value: database.value?.containers?.length ?? 0 },
  { label: 'Throughput', value: 'Configured per container' },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
])
const columns = [
  { key: 'name', label: 'Container id', grow: 1.5 },
  { key: 'partitionKey', label: 'Partition key', grow: 1.1 },
  { key: 'throughput', label: 'Throughput', grow: 1 },
  { key: 'vector', label: 'Vector configuration', grow: 1.4 },
]
const rows = computed(() => (database.value?.containers ?? []).map((container) => ({
  name: container.name,
  partitionKey: container.partitionKeyPath,
  throughput: `${container.throughput} RU/s`,
  vector: container.vectorEmbeddingPolicy?.vectorEmbeddings?.length ? 'Configured' : 'Not configured',
})))
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: account, blade: { kind: 'cosmos-account', resourceGroup, name: account } }, { label: name, blade: null }]" :title="name" subtitle="Cosmos DB for NoSQL database" icon="cosmos-db" icon-tint="var(--tint-purple)" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Containers</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter containers..." aria-label="Filter containers" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No containers in this database" @open="portal.showBlade({ kind: 'cosmos-container', resourceGroup, account, database: name, name: $event.name })" />
    </div>
  </section>
</template>

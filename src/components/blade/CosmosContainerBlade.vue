<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({
  resourceGroup: { type: String, required: true },
  account: { type: String, required: true },
  database: { type: String, required: true },
  name: { type: String, required: true },
})
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const accountResource = computed(() => (run.sandbox.cosmosAccounts ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.account)))
const databaseResource = computed(() => accountResource.value?.databases?.find((item) => item.name === props.database))
const container = computed(() => databaseResource.value?.containers?.find((item) => item.name === props.name))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }] },
  { label: 'Data Explorer', items: [{ id: 'items', label: 'Items' }] },
  { label: 'Settings', items: [{ id: 'scale', label: 'Scale' }, { id: 'indexing', label: 'Indexing policy' }, { id: 'properties', label: 'Properties' }] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az cosmosdb sql container delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
function throughputModeLabel(c) {
  if (!c) return 'Not set'
  if (c.throughputMode === 'autoscale') return `Autoscale up to ${c.maxThroughput} RU/s (scales down to ${c.maxThroughput / 10} RU/s)`
  return `Manual ${c.throughput} RU/s`
}
function itemCountLabel(c) {
  if (!c) return 'Not set'
  const count = (c.items?.length ?? 0) * (c.logicalScale ?? 1)
  return `${count} (simulated)`
}
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Account', value: props.account, blade: { kind: 'cosmos-account', resourceGroup: props.resourceGroup, name: props.account } },
  { label: 'Database', value: props.database, blade: { kind: 'cosmos-database', resourceGroup: props.resourceGroup, account: props.account, name: props.database } },
  { label: 'Container id', value: container.value?.name ?? props.name },
  { label: 'Partition key', value: container.value?.partitionKeyPath ?? 'Not set' },
  { label: 'Throughput', value: throughputModeLabel(container.value) },
  { label: 'Indexing mode', value: container.value?.indexingPolicy?.indexingMode ?? 'Not set' },
  { label: 'Automatic indexing', value: container.value?.indexingPolicy?.automatic ? 'Enabled' : 'Disabled' },
  { label: 'Item count', value: itemCountLabel(container.value) },
])
const embeddingColumns = [
  { key: 'path', label: 'Path', grow: 1.4 },
  { key: 'dataType', label: 'Data type', grow: 1 },
  { key: 'dimensions', label: 'Dimensions', grow: 1 },
  { key: 'distanceFunction', label: 'Distance function', grow: 1.2 },
]
const indexColumns = [
  { key: 'path', label: 'Path', grow: 1.5 },
  { key: 'type', label: 'Index type', grow: 1 },
]
const pathColumns = [{ key: 'path', label: 'Path', grow: 1 }]
const compositeIndexColumns = [{ key: 'paths', label: 'Paths', grow: 1 }]
const embeddings = computed(() => (container.value?.vectorEmbeddingPolicy?.vectorEmbeddings ?? []).map((item) => ({ ...item, _row: `embedding:${item.path}` })))
const vectorIndexes = computed(() => (container.value?.indexingPolicy?.vectorIndexes ?? []).map((item) => ({ ...item, _row: `index:${item.path}` })))
const excludedPaths = computed(() => (container.value?.indexingPolicy?.excludedPaths ?? []).map((item) => ({ ...item, _row: `excluded:${item.path}` })))
const compositeIndexes = computed(() => (container.value?.indexingPolicy?.compositeIndexes ?? []).map((entry, index) => ({
  _row: `composite:${index}`,
  paths: entry.map((part) => `${part.path} ${part.order === 'descending' ? 'DESC' : 'ASC'}`).join(', '),
})))
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: account, blade: { kind: 'cosmos-account', resourceGroup, name: account } }, { label: database, blade: { kind: 'cosmos-database', resourceGroup, account, name: database } }, { label: name, blade: null }]" :title="name" subtitle="Cosmos DB for NoSQL container" icon="cosmos-db" icon-tint="var(--tint-purple)" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Vector embeddings</h3>
      <EntityTable :columns="embeddingColumns" :rows="embeddings" empty-text="No vector embedding policy configured" name-key="_row" />
      <h3 class="blade__section-title">Vector indexes</h3>
      <EntityTable :columns="indexColumns" :rows="vectorIndexes" empty-text="No vector indexes configured" name-key="_row" />
      <h3 class="blade__section-title">Composite indexes</h3>
      <EntityTable :columns="compositeIndexColumns" :rows="compositeIndexes" empty-text="No composite indexes configured" name-key="_row" />
      <h3 class="blade__section-title">Excluded indexing paths</h3>
      <EntityTable :columns="pathColumns" :rows="excludedPaths" empty-text="No excluded indexing paths configured" name-key="_row" />
    </div>
  </section>
</template>

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
const account = computed(() => (run.sandbox.storageAccounts ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Data storage', items: [{ id: 'containers', label: 'Containers' }, { id: 'shares', label: 'File shares' }, { id: 'queues', label: 'Queues' }, { id: 'tables', label: 'Tables' }] },
  { label: 'Settings', items: [{ id: 'configuration', label: 'Configuration' }, { id: 'networking', label: 'Networking' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az storage account delete --name <name> --resource-group <group> --yes') },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Move', icon: 'folder-arrow-right' },
]
const essentials = computed(() => [
  { label: 'Name', value: account.value?.name ?? props.name },
  { label: 'Resource group', value: account.value?.resourceGroup ?? props.resourceGroup, blade: { kind: 'resource-group', name: account.value?.resourceGroup ?? props.resourceGroup } },
  { label: 'Location', value: displayLocation(account.value?.location) },
  { label: 'Kind', value: account.value?.kind ?? '' },
  { label: 'SKU', value: account.value?.sku ?? '' },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Resource ID', value: account.value ? `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${account.value.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account.value.name}` : '' },
])
const columns = [
  { key: 'name', label: 'Function App', grow: 1.5 },
  { key: 'resourceGroup', label: 'Resource group', grow: 1.3 },
  { key: 'location', label: 'Location', grow: 1 },
  { key: 'hostingPlan', label: 'Hosting plan', grow: 1.2 },
]
const rows = computed(() => (run.sandbox.functionApps ?? [])
  .filter((app) => same(app.storageAccount, props.name) && same(app.storageResourceGroup, props.resourceGroup))
  .map((app) => ({
    name: app.name,
    resourceGroup: app.resourceGroup,
    location: displayLocation(app.location),
    hostingPlan: app.hostingPlan === 'FlexConsumption' ? 'Flex Consumption' : app.hostingPlan,
  })))
</script>

<template>
  <section class="blade storage-account-blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Storage account" icon="all-resources" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid class="storage-account-essentials" :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Linked Function Apps</h3>
      <EntityTable class="storage-account-functions" :columns="columns" :rows="rows" empty-text="No Function Apps use this storage account" @open="portal.showBlade({ kind: 'function-app', resourceGroup: $event.resourceGroup, name: $event.name })" />
    </div>
  </section>
</template>

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
const HINT = 'Blades are read-only in this Lab. Create resources from the Cloud Shell; run az --help to see supported commands.'
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
const rows = computed(() => [
  ...(run.sandbox.redisClusters ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Azure Managed Redis', location: displayLocation(resource.location), blade: { kind: 'redis-enterprise', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.postgresServers ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Azure Database for PostgreSQL flexible server', location: displayLocation(resource.location), blade: { kind: 'postgres-server', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.namespaces ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Service Bus Namespace', location: displayLocation(resource.location), blade: { kind: 'servicebus-namespace', resourceGroup: resource.resourceGroup, name: resource.name, tab: 'queues' } })),
  ...(run.sandbox.containerAppEnvironments ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Container Apps Environment', location: displayLocation(resource.location), blade: { kind: 'containerapp-environment', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.containerApps ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Container App', location: displayLocation(resource.location), blade: { kind: 'containerapp', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.containerRegistries ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Container registry', location: displayLocation(resource.location), blade: { kind: 'container-registry', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.aksClusters ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Kubernetes service', location: displayLocation(resource.location), blade: { kind: 'aks-cluster', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.managedIdentities ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Managed identity', location: displayLocation(resource.location), blade: { kind: 'managed-identity', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.cosmosAccounts ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Azure Cosmos DB account', location: displayLocation(resource.location), blade: { kind: 'cosmos-account', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.keyVaults ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Key vault', location: displayLocation(resource.location), blade: { kind: 'key-vault', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.storageAccounts ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Storage account', location: displayLocation(resource.location), blade: { kind: 'storage-account', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.functionApps ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Function App', location: displayLocation(resource.location), blade: { kind: 'function-app', resourceGroup: resource.resourceGroup, name: resource.name } })),
  ...(run.sandbox.eventGridTopics ?? []).filter(inGroup).map((resource) => ({ name: resource.name, type: 'Event Grid topic', location: displayLocation(resource.location), blade: { kind: 'eventgrid-topic', resourceGroup: resource.resourceGroup, name: resource.name } })),
])
function inGroup(resource) {
  return resource.resourceGroup.toLowerCase() === props.name.toLowerCase()
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: name, blade: null }]" :title="name" subtitle="Resource group" icon="resource-group" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" />
      <h3 class="blade__section-title">Resources</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter resources" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No resources to display" @open="portal.showBlade($event.blade)" />
    </div>
  </section>
</template>

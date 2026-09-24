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
const app = computed(() => (run.sandbox.functionApps ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Functions', items: [{ id: 'functions', label: 'Functions' }, { id: 'keys', label: 'App keys' }] },
  { label: 'Settings', items: [{ id: 'configuration', label: 'Configuration' }, { id: 'cors', label: 'CORS' }, { id: 'networking', label: 'Networking' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az functionapp delete --name <name> --resource-group <group>') },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Move', icon: 'folder-arrow-right' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: app.value?.resourceGroup ?? props.resourceGroup, blade: { kind: 'resource-group', name: app.value?.resourceGroup ?? props.resourceGroup } },
  { label: 'Status', value: 'Running' },
  { label: 'Location', value: displayLocation(app.value?.location) },
  { label: 'Operating system', value: app.value?.os ?? '' },
  { label: 'Hosting plan', value: app.value?.hostingPlan === 'FlexConsumption' ? 'Flex Consumption' : (app.value?.hostingPlan ?? '') },
  { label: 'Runtime', value: app.value ? `${app.value.runtime === 'node' ? 'Node.js' : app.value.runtime} ${app.value.runtimeVersion}` : '' },
  { label: 'Functions version', value: app.value?.functionsVersion ?? '' },
  { label: 'HTTPS only', value: app.value?.httpsOnly ? 'Enabled' : 'Disabled' },
  { label: 'Storage account', value: app.value?.storageAccount ?? '', blade: app.value ? { kind: 'storage-account', resourceGroup: app.value.storageResourceGroup, name: app.value.storageAccount } : null },
  { label: 'Default host name', value: app.value ? `${app.value.name}.azurewebsites.net` : '' },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Resource ID', value: app.value ? `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${app.value.resourceGroup}/providers/Microsoft.Web/sites/${app.value.name}` : '' },
])
const settingColumns = [
  { key: 'name', label: 'Name', grow: 1.8 },
  { key: 'status', label: 'Value', grow: 1 },
]
const settingRows = computed(() => Object.keys(app.value?.appSettings ?? {}).map((name) => ({ _row: name, name, status: 'Configured' })))
const corsColumns = [
  { key: 'origin', label: 'Allowed origin', grow: 2 },
  { key: 'credentials', label: 'Credentials', grow: 1 },
]
const corsRows = computed(() => (app.value?.cors.allowedOrigins ?? []).map((origin) => ({
  _row: origin,
  origin,
  credentials: app.value?.cors.supportCredentials ? 'Supported' : 'Not supported',
})))
</script>

<template>
  <section class="blade function-app-blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Function App" icon="functions" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid class="function-app-essentials" :items="essentials" @navigate="portal.showBlade($event)" />
      <p class="blade__hint function-app-hosting-note">This hosting configuration does not deploy function code or serve an endpoint.</p>
      <h3 class="blade__section-title">Custom application settings</h3>
      <EntityTable class="function-app-settings" :columns="settingColumns" :rows="settingRows" name-key="_row" empty-text="No custom application settings configured" />
      <h3 class="blade__section-title">CORS</h3>
      <EntityTable class="function-app-cors" :columns="corsColumns" :rows="corsRows" name-key="_row" empty-text="No allowed origins configured" />
    </div>
  </section>
</template>

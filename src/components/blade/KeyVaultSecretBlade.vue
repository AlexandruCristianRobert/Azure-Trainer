<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { canReadSecrets } from '../../lib/sandbox/keyvault.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({
  resourceGroup: { type: String, required: true },
  vault: { type: String, required: true },
  name: { type: String, required: true },
})
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const vaultResource = computed(() => (run.sandbox.keyVaults ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.vault)))
const mayReadSecrets = computed(() => !!vaultResource.value && canReadSecrets(vaultResource.value))
const secret = computed(() => vaultResource.value?.secrets?.find((item) => same(item.name, props.name)))
const latest = computed(() => secret.value?.versions?.[secret.value.versions.length - 1])

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'versions', label: 'Versions' }, { id: 'access', label: 'Access control (IAM)' }] },
  { label: 'Settings', items: [{ id: 'attributes', label: 'Attributes' }, { id: 'tags', label: 'Tags' }] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const commands = [{ label: 'Refresh', icon: 'arrow-sync' }]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Vault', value: props.vault, blade: { kind: 'key-vault', resourceGroup: props.resourceGroup, name: props.vault } },
  { label: 'Latest version', value: latest.value?.version ?? 'Unknown' },
  { label: 'Latest status', value: latest.value?.enabled ? 'Enabled' : 'Disabled' },
  { label: 'Content type', value: latest.value?.contentType ?? 'Not set' },
  { label: 'Created', value: formatDate(latest.value?.createdAt) },
  { label: 'Updated', value: formatDate(latest.value?.updatedAt) },
  { label: 'Version count', value: secret.value?.versions?.length ?? 0 },
])
const versionColumns = [
  { key: 'version', label: 'Version', grow: 1.8 },
  { key: 'enabled', label: 'Status', grow: 0.8 },
  { key: 'created', label: 'Created', grow: 1.3 },
  { key: 'contentType', label: 'Content type', grow: 1 },
]
const versionRows = computed(() => {
  if (!secret.value || !mayReadSecrets.value) return []
  return [...(secret.value.versions ?? [])].reverse().map((version) => ({
    _row: version.version,
    version: version.version,
    enabled: version.enabled ? 'Enabled' : 'Disabled',
    created: formatDate(version.createdAt),
    contentType: version.contentType ?? 'Not set',
  }))
})

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Unknown'
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: vault, blade: { kind: 'key-vault', resourceGroup, name: vault } }, { label: name, blade: null }]" :title="name" subtitle="Key Vault secret" icon="key-vault" icon-tint="var(--tint-amber)" :commands="commands" @navigate="portal.showBlade($event)" />
      <p v-if="!mayReadSecrets" class="blade__hint">Secret metadata is unavailable. In the Cloud Shell, use <code>az role assignment create</code> to grant the Sandbox learner a supported Key Vault secrets role at this vault's scope.</p>
      <template v-else>
        <EssentialsGrid class="keyvault-secret-essentials" :items="essentials" @navigate="portal.showBlade($event)" />
        <h3 class="blade__section-title">Versions</h3>
        <EntityTable class="keyvault-versions" :columns="versionColumns" :rows="versionRows" empty-text="No versions stored for this secret" name-key="_row" />
      </template>
    </div>
  </section>
</template>

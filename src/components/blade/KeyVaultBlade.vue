<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import { SUBSCRIPTION_NAME, USER_NAME, USER_OBJECT_ID } from '../../lib/sandbox/model.js'
import { canReadSecrets, keyVaultId } from '../../lib/sandbox/keyvault.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const vault = computed(() => (run.sandbox.keyVaults ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))
const mayReadSecrets = computed(() => !!vault.value && canReadSecrets(vault.value))

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Objects', items: [{ id: 'keys', label: 'Keys' }, { id: 'secrets', label: 'Secrets' }, { id: 'certificates', label: 'Certificates' }] },
  { label: 'Settings', items: [{ id: 'access', label: 'Access configuration' }, { id: 'networking', label: 'Networking' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create secret', icon: 'add', readOnlyHint: RO('az keyvault secret set --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Location', value: displayLocation(vault.value?.location) },
  { label: 'SKU', value: formatSku(vault.value?.sku) },
  { label: 'Access model', value: vault.value?.enableRbacAuthorization ? 'Azure role-based access control' : 'Vault access policy' },
  { label: 'Soft delete', value: 'Enabled' },
  { label: 'Purge protection', value: vault.value?.enablePurgeProtection ? 'Enabled' : 'Disabled' },
  { label: 'Retention period', value: `${vault.value?.softDeleteRetentionInDays ?? 90} days` },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
])
const roleColumns = [
  { key: 'roleName', label: 'Role', grow: 1.4 },
  { key: 'principal', label: 'Principal', grow: 1.8 },
  { key: 'principalType', label: 'Principal type', grow: 1 },
  { key: 'scope', label: 'Scope', grow: 2.2 },
]
const roleRows = computed(() => {
  if (!vault.value) return []
  const scope = keyVaultId(vault.value)
  return (vault.value.roleAssignments ?? [])
    .filter((assignment) => same(assignment.principalId, USER_OBJECT_ID) && same(assignment.scope, scope))
    .map((assignment) => ({
      _row: assignment.id,
      roleName: assignment.roleName,
      principal: `${USER_NAME} (${assignment.principalId})`,
      principalType: assignment.principalType,
      scope: assignment.scope,
    }))
})
const secretColumns = [
  { key: 'name', label: 'Name', grow: 1.5 },
  { key: 'enabled', label: 'Latest status', grow: 1 },
  { key: 'versions', label: 'Versions', grow: 0.8 },
  { key: 'contentType', label: 'Content type', grow: 1.2 },
]
const secretRows = computed(() => {
  if (!vault.value || !mayReadSecrets.value) return []
  return (vault.value.secrets ?? []).map((secret) => {
    const latest = secret.versions?.[secret.versions.length - 1]
    return {
      name: secret.name,
      enabled: latest?.enabled ? 'Enabled' : 'Disabled',
      versions: secret.versions?.length ?? 0,
      contentType: latest?.contentType ?? 'Not set',
    }
  })
})

function formatSku(sku) {
  if (!sku) return 'Unknown'
  return sku.charAt(0).toUpperCase() + sku.slice(1)
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Key vault" icon="key-vault" icon-tint="var(--tint-amber)" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <h3 class="blade__section-title">Role assignments for the Sandbox learner</h3>
      <EntityTable class="keyvault-assignments" :columns="roleColumns" :rows="roleRows" empty-text="No vault-scoped role assignments for the Sandbox learner" name-key="_row" />
      <h3 class="blade__section-title">Secrets</h3>
      <p v-if="!mayReadSecrets" class="blade__hint">Secret metadata is unavailable. In the Cloud Shell, use <code>az role assignment create</code> to grant the Sandbox learner a supported Key Vault secrets role at this vault's scope.</p>
      <template v-else>
        <div class="blade__filters"><input type="search" placeholder="Filter secrets..." aria-label="Filter secrets" /><span class="blade__count">Showing {{ secretRows.length ? 1 : 0 }} to {{ secretRows.length }} of {{ secretRows.length }} records.</span></div>
        <EntityTable :columns="secretColumns" :rows="secretRows" empty-text="No secrets in this vault" @open="portal.showBlade({ kind: 'key-vault-secret', resourceGroup, vault: name, name: $event.name })" />
      </template>
    </div>
  </section>
</template>

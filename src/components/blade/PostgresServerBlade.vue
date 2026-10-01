<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const server = computed(() => (run.sandbox.postgresServers ?? []).find(server => same(server.name, props.name) && same(server.resourceGroup, props.resourceGroup)))
const sections = [{ items: [{ id: 'overview', label: 'Overview' }] }, { label: 'Settings', items: [{ id: 'parameters', label: 'Server parameters' }, { id: 'databases', label: 'Databases' }] }]
const readOnly = command => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Create database', icon: 'add', readOnlyHint: readOnly('az postgres flexible-server db create --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: readOnly('az postgres flexible-server delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Location', value: displayLocation(server.value?.location) },
  { label: 'Server name (FQDN)', value: server.value?.fullyQualifiedDomainName },
  { label: 'PostgreSQL version', value: server.value?.version },
  { label: 'Tier / SKU', value: `${server.value?.tier} / ${server.value?.skuName}` },
  { label: 'Compute', value: `${server.value?.vCores} vCores / ${server.value?.memoryGiB} GiB memory` },
  { label: 'Storage', value: `${server.value?.storageSizeGb} GB` },
  { label: 'Administrator', value: server.value?.adminUser },
  { label: 'Direct / PgBouncer ports', value: '5432 / 6432' },
])
const parameters = computed(() => Object.entries(server.value?.parameters ?? {}).map(([name, value]) => ({ name, value,
  source: server.value?.parameterOverrides.includes(name) ? 'User override' : 'System default',
  unit: ['maintenance_work_mem', 'shared_buffers'].includes(name) ? 'kB' : '' })))
const databases = computed(() => server.value?.databases ?? [])
const count = value => Number(value ?? 0).toLocaleString()
const indexColumns = index => (index.columns ?? []).map(column => typeof column === 'string' ? column : column.name).join(', ')
const opclasses = index => (index.columns ?? []).map(column => column.opclass).filter(Boolean).join(', ') || '—'
const size = index => Number.isFinite(index.sizeMb) ? `${index.sizeMb.toLocaleString(undefined, { maximumFractionDigits: 2 })} MB` : 'Not built'
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="active = $event" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Azure Database for PostgreSQL flexible server" icon="postgresql" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid v-if="active === 'overview'" :items="essentials" @navigate="portal.showBlade($event)" />
      <p class="postgres-estimate">Simulated estimate — not an Azure guarantee. Compute, memory, row counts, and index sizes are teaching approximations.</p>
      <template v-if="active === 'overview' || active === 'parameters'">
        <h3 class="blade__section-title">Server parameters</h3>
        <table class="postgres-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Value</th><th scope="col">Unit</th><th scope="col">Source</th></tr></thead>
          <tbody><tr v-for="parameter in parameters" :key="parameter.name"><th scope="row">{{ parameter.name }}</th><td>{{ parameter.value || '(empty)' }}</td><td>{{ parameter.unit }}</td><td>{{ parameter.source }}</td></tr></tbody>
        </table>
      </template>
      <template v-if="active === 'overview' || active === 'databases'">
        <h3 class="blade__section-title">Databases</h3>
        <p v-if="!databases.length">No databases in this server.</p>
        <table v-else class="postgres-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Extensions</th><th scope="col">Tables</th><th scope="col">Indexes</th></tr></thead>
          <tbody><tr v-for="database in databases" :key="database.name"><th scope="row">{{ database.name }}</th><td>{{ database.extensions.join(', ') || 'None' }}</td><td>{{ database.tables.length }}</td><td>{{ database.indexes.length }}</td></tr></tbody>
        </table>
        <section v-for="database in databases" :key="database.name" :aria-label="database.name + ' database details'">
          <h3 class="blade__section-title">{{ database.name }} · Tables</h3>
          <p v-if="!database.tables.length">No tables.</p>
          <table v-else class="postgres-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Logical rows</th><th scope="col">Visible sample rows</th></tr></thead>
            <tbody><tr v-for="table in database.tables" :key="table.name"><th scope="row">{{ table.name }}</th><td>{{ count(table.logicalRows ?? table.rows?.length) }}</td><td>{{ count(table.rows?.length) }}</td></tr></tbody>
          </table>
          <h3 class="blade__section-title">{{ database.name }} · Indexes</h3>
          <p v-if="!database.indexes.length">No indexes.</p>
          <table v-else class="postgres-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Table / columns</th><th scope="col">Type</th><th scope="col">Opclass</th><th scope="col">Size estimate</th></tr></thead>
            <tbody><tr v-for="index in database.indexes" :key="index.name"><th scope="row">{{ index.name }}</th><td>{{ index.table }} / {{ indexColumns(index) }}</td><td>{{ index.method }}</td><td>{{ opclasses(index) }}</td><td>{{ size(index) }}</td></tr></tbody>
          </table>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.postgres-estimate { margin: 18px 24px; color: var(--text-secondary, #616161); font-size: 12px; }
.postgres-table { width: calc(100% - 48px); margin: 12px 24px 24px; border-collapse: collapse; font-size: 13px; }
.postgres-table th, .postgres-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color, #ddd); overflow-wrap: anywhere; }
.postgres-table thead th { font-weight: 600; background: var(--surface-secondary, #f5f5f5); }
.postgres-table tbody th { font-weight: 400; }
</style>

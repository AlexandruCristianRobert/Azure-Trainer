<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { getRedisCluster } from '../../lib/sandbox/redis.js'
import { redisMemory } from '../../lib/data/redis-store.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const cluster = computed(() => getRedisCluster(run.sandbox, props))
const database = computed(() => cluster.value?.database)
const nowMs = computed(() => run.behavioralRun?.runtime?.simTimeMs ?? 0)
const keys = computed(() => Object.entries(database.value?.keys ?? {}).filter(([, entry]) => entry.expiresAtMs === null || entry.expiresAtMs > nowMs.value))
const indexes = computed(() => Object.values(database.value?.indexes ?? {}))
const usedBytes = computed(() => redisMemory(database.value, nowMs.value).usedBytes)
const sections = [{ items: [{ id: 'overview', label: 'Overview' }] }, { label: 'Data', items: [{ id: 'keys', label: 'Keys' }, { id: 'indexes', label: 'Vector indexes' }] }]
const commands = [{ label: 'Delete', icon: 'delete', readOnlyHint: 'Blades are read-only in this Lab. Use the Cloud Shell: az redisenterprise delete --help' }, { label: 'Refresh', icon: 'arrow-sync' }]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Location', value: displayLocation(cluster.value?.location) },
  { label: 'SKU', value: cluster.value?.sku },
  { label: 'Host (fictional training endpoint)', value: cluster.value?.hostName },
  { label: 'Database / port', value: `${database.value?.name} / ${database.value?.port}` },
  { label: 'Module chosen at creation', value: database.value?.modules.join(', ') || 'None — recreate to add RediSearch' },
  { label: 'Clustering / eviction', value: `${database.value?.clusteringPolicy} / ${database.value?.evictionPolicy}` },
  { label: 'Client protocol', value: database.value?.clientProtocol },
  { label: 'Memory usage / teaching limit', value: `${usedBytes.value.toLocaleString()} / ${database.value?.memoryLimitBytes.toLocaleString()} bytes` },
])
const ttl = entry => entry.expiresAtMs === null ? 'Persistent (no TTL)' : `${Math.floor((entry.expiresAtMs - nowMs.value) / 1000)} seconds`
const vectorSchema = index => index.fields.filter(field => field.type === 'VECTOR').map(field => `${field.name}: ${field.algorithm} ${field.dataType}, DIM ${field.dimensions}, ${field.distanceMetric}`).join('; ')
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="active = $event" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Azure Managed Redis" :commands="commands" @navigate="portal.showBlade($event)" />
      <template v-if="cluster">
        <EssentialsGrid v-if="active === 'overview'" :items="essentials" @navigate="portal.showBlade($event)" />
        <p class="redis-notice">Simulated estimate — not an Azure guarantee. Memory bounds are teaching fixture limits. TTL uses simulation time.</p>
        <template v-if="active === 'overview' || active === 'keys'">
          <h3 class="blade__section-title">Live keys</h3>
          <p v-if="!keys.length" class="redis-notice">No live keys.</p>
          <table v-else class="redis-table"><thead><tr><th scope="col">Key</th><th scope="col">Type</th><th scope="col">TTL</th></tr></thead><tbody><tr v-for="[key, entry] in keys" :key="key"><th scope="row">{{ key }}</th><td>{{ entry.type }}</td><td>{{ ttl(entry) }}</td></tr></tbody></table>
        </template>
        <template v-if="active === 'overview' || active === 'indexes'">
          <h3 class="blade__section-title">Vector indexes</h3>
          <p v-if="!indexes.length" class="redis-notice">No vector indexes.</p>
          <table v-else class="redis-table"><thead><tr><th scope="col">Name</th><th scope="col">Prefix</th><th scope="col">TAG fields</th><th scope="col">Vector schema</th></tr></thead><tbody><tr v-for="index in indexes" :key="index.name"><th scope="row">{{ index.name }}</th><td>{{ index.prefix }}</td><td>{{ index.fields.filter(field => field.type === 'TAG').map(field => field.name).join(', ') }}</td><td>{{ vectorSchema(index) }}</td></tr></tbody></table>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
.redis-notice { margin: 18px 24px; color: var(--text-secondary, #616161); font-size: 12px; }
.redis-table { width: calc(100% - 48px); margin: 12px 24px 24px; border-collapse: collapse; font-size: 13px; }
.redis-table th, .redis-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color, #ddd); overflow-wrap: anywhere; }
.redis-table thead th { font-weight: 600; background: var(--surface-secondary, #f5f5f5); }
.redis-table tbody th { font-weight: 400; }
</style>

<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import { SUBSCRIPTION_NAME } from '../../lib/sandbox/model.js'
import BladeHeader from './BladeHeader.vue'
import EntityTable from './EntityTable.vue'

const run = useLabRunStore()
const portal = usePortalStore()
const HINT = 'Blades are read-only in this Lab. Use the Cloud Shell: az group create --name <name> --location <location>'
const commands = [
  { label: 'Create', icon: 'add', readOnlyHint: HINT },
  { label: 'Manage view', icon: 'settings' },
  { divider: true },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Export to CSV', icon: 'arrow-upload' },
  { label: 'Open query', icon: 'open' },
]
const columns = [{ key: 'name', label: 'Name', grow: 1.6 }, { key: 'subscription', label: 'Subscription', grow: 1 }, { key: 'location', label: 'Location', grow: 1 }]
const rows = computed(() => run.sandbox.resourceGroups.map((g) => ({ name: g.name, subscription: SUBSCRIPTION_NAME, location: displayLocation(g.location) })))
</script>

<template>
  <section class="blade">
    <div class="blade__content blade__content--full">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: null }]" title="Resource groups" :subtitle="SUBSCRIPTION_NAME" icon="resource-group" :commands="commands" @navigate="portal.showBlade($event)" />
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter resource groups" /><span class="blade__count">Showing {{ rows.length ? 1 : 0 }} to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No resource groups to display" @open="portal.showBlade({ kind: 'resource-group', name: $event.name })" />
      <p v-if="!rows.length" class="blade__hint">Nothing here yet. Create your first resource group from the Cloud Shell below: <code>az group create --name &lt;name&gt; --location &lt;location&gt;</code></p>
    </div>
  </section>
</template>

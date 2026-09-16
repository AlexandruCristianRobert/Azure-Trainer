<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { resolveBlade } from '../../lib/bladeResolve.js'
import ResourceGroupsBlade from './ResourceGroupsBlade.vue'
import ResourceGroupBlade from './ResourceGroupBlade.vue'
import ServiceBusNamespaceBlade from './ServiceBusNamespaceBlade.vue'

const run = useLabRunStore()
const portal = usePortalStore()
const blade = computed(() => resolveBlade(portal.blade, run.sandbox))
</script>

<template>
  <ServiceBusNamespaceBlade v-if="blade.kind === 'servicebus-namespace'" :key="blade.resourceGroup + '/' + blade.name" :resource-group="blade.resourceGroup" :name="blade.name" :tab="blade.tab" />
  <ResourceGroupBlade v-else-if="blade.kind === 'resource-group'" :key="blade.name" :name="blade.name" />
  <ResourceGroupsBlade v-else />
</template>

<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: String, name: String })
const run = useLabRunStore(), portal = usePortalStore()
const registry = computed(() => run.sandbox.containerRegistries.find((item) => item.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && item.name.toLowerCase() === props.name.toLowerCase()))
const essentials = computed(() => [{ label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } }, { label: 'Location', value: displayLocation(registry.value?.location) }, { label: 'Login server', value: registry.value?.loginServer }, { label: 'SKU', value: registry.value?.sku }, { label: 'Registry ID', value: registry.value?.id }])
const rows = computed(() => Object.entries(run.behavioralRun?.artifacts?.publishedTags ?? {}).filter(([tag]) => tag.startsWith(`${registry.value?.loginServer}/`)).map(([name, id]) => ({ name, build: id, digest: run.behavioralRun.artifacts.buildsById[id]?.digest ?? '' })))
</script>

<template><section class="blade"><div class="blade__content blade__content--full"><BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name }]" :title="name" subtitle="Container registry" icon="container-apps" :commands="[{ label: 'Refresh', icon: 'arrow-sync' }]" @navigate="portal.showBlade($event)" /><EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" /><h3 class="blade__section-title">Published images</h3><EntityTable :columns="[{ key: 'name', label: 'Image' }, { key: 'build', label: 'Build' }, { key: 'digest', label: 'Digest' }]" :rows="rows" empty-text="No images published" /></div></section></template>

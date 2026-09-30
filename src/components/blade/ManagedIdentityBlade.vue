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
const identity = computed(() => run.sandbox.managedIdentities.find((item) => item.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && item.name.toLowerCase() === props.name.toLowerCase()))
const essentials = computed(() => [{ label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } }, { label: 'Location', value: displayLocation(identity.value?.location) }, { label: 'Identity ID', value: identity.value?.id }, { label: 'Client ID', value: identity.value?.clientId }, { label: 'Principal ID', value: identity.value?.principalId }])
const rows = computed(() => run.sandbox.roleAssignments.filter((item) => item.principalId.toLowerCase() === identity.value?.principalId?.toLowerCase()).map((item) => ({ name: item.roleName, scope: item.scope })))
</script>

<template><section class="blade"><div class="blade__content blade__content--full"><BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name }]" :title="name" subtitle="Managed identity" icon="container-apps" :commands="[{ label: 'Refresh', icon: 'arrow-sync' }]" @navigate="portal.showBlade($event)" /><EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" /><h3 class="blade__section-title">Access assignments</h3><EntityTable :columns="[{ key: 'name', label: 'Role' }, { key: 'scope', label: 'Scope', grow: 2 }]" :rows="rows" empty-text="No access assignments" /></div></section></template>

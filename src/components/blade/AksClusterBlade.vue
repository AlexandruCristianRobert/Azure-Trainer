<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { projectKubernetesInspection } from '../../lib/kubernetes/inspection.js'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: String, name: String })
const run = useLabRunStore(); const portal = usePortalStore(); const namespace = ref('')
const cluster = computed(() => run.sandbox.aksClusters?.find(item => item.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && item.name.toLowerCase() === props.name.toLowerCase()) ?? null)
const view = computed(() => projectKubernetesInspection(run.behavioralRun, cluster.value?.id))
const namespaces = computed(() => view.value.namespaces.map(item => item.metadata.name))
watch(namespaces, values => { if (!values.includes(namespace.value)) namespace.value = values[0] ?? '' }, { immediate: true })
const scoped = kind => computed(() => view.value[kind].filter(item => !item.metadata?.namespace || item.metadata.namespace === namespace.value))
const essentials = computed(() => cluster.value ? [
  { label: 'Resource group', value: cluster.value.resourceGroup, blade: { kind: 'resource-group', name: cluster.value.resourceGroup } },
  { label: 'Location', value: cluster.value.location }, { label: 'Provisioning state', value: cluster.value.provisioningState },
  { label: 'Node resource group', value: cluster.value.nodeResourceGroup }, { label: 'Kubernetes version', value: 'Modeled training cluster' },
] : [])
const rows = (items, mapper) => computed(() => items.value.map(mapper))
const deploymentRows = rows(scoped('deployments'), item => ({ name: item.metadata.name, status: `${item.spec.replicas} desired`, image: item.spec.template.spec.containers[0]?.image ?? '' }))
const podRows = rows(scoped('pods'), item => ({ name: item.metadata.name, status: item.status?.phase ?? 'Unknown', image: item.spec.containers[0]?.image ?? '' }))
const serviceRows = computed(() => view.value.serviceEndpoints.filter(item => item.namespace === namespace.value).map(item => ({ name: item.name, status: item.type, endpoint: `${item.readyBackends.length} ready: ${item.readyBackends.map(backend => backend.name).join(', ') || 'none'} · ${item.targetPort ?? 'none'} → ${item.resolvedPort ?? 'unresolved'}` })))
const imageEvents = computed(() => view.value.events.filter(item => item.metadata?.namespace === namespace.value && ['RegistryAccessDenied', 'ImageNotFound'].includes(item.reason))
  .map(item => ({ name: item.metadata.name, reason: item.reason, message: item.message })))
</script>

<template><section class="blade"><div class="blade__content blade__content--full">
  <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name }]" :title="name" subtitle="Kubernetes service" icon="aks" :commands="[{ label: 'Refresh', icon: 'arrow-sync' }]" @navigate="portal.showBlade($event)" />
  <template v-if="cluster"><EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" /><p class="aks-blade__notice">Workloads and request results are read-only. State changes are modeled immediately for this Lab.</p>
    <h3 class="blade__section-title">Nodes</h3><EntityTable :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'vmSize', label: 'VM size' }]" :rows="view.nodes" empty-text="No nodes are modeled" />
    <div class="aks-blade__scope"><label>Namespace <select v-model="namespace"><option v-for="item in namespaces" :key="item">{{ item }}</option></select></label></div>
    <h3 class="blade__section-title">Deployments</h3><EntityTable :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Replicas' }, { key: 'image', label: 'Image', grow: 2 }]" :rows="deploymentRows" empty-text="No deployments in this namespace" />
    <h3 class="blade__section-title">Pods</h3><EntityTable :columns="[{ key: 'name', label: 'Name', grow: 1.5 }, { key: 'status', label: 'Status' }, { key: 'image', label: 'Image', grow: 2 }]" :rows="podRows" empty-text="No Pods in this namespace" />
    <h3 class="blade__section-title">Services</h3><EntityTable :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Type' }, { key: 'endpoint', label: 'Endpoint' }]" :rows="serviceRows" empty-text="No Services in this namespace" />
    <h3 class="blade__section-title">Image-pull events</h3><EntityTable :columns="[{ key: 'name', label: 'Event' }, { key: 'reason', label: 'Reason' }, { key: 'message', label: 'Message', grow: 2 }]" :rows="imageEvents" empty-text="No image-pull events in this namespace" />
  </template><p v-else class="aks-blade__empty">This cluster was deleted or is unavailable. Return to its resource group to inspect the remaining resources.</p>
</div></section></template>

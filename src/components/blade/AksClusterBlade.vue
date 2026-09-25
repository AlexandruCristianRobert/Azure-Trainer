<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { projectKubernetesInspection } from '../../lib/kubernetes/inspection.js'
import { inspectPodConfiguration } from '../../lib/kubernetes/configuration-inspection.js'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: String, name: String })
const run = useLabRunStore(); const portal = usePortalStore(); const namespace = ref('')
const cluster = computed(() => run.sandbox.aksClusters?.find(item => item.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && item.name.toLowerCase() === props.name.toLowerCase()) ?? null)
const view = computed(() => projectKubernetesInspection(run.behavioralRun, cluster.value?.id))
const namespaces = computed(() => view.value.namespaces.map(item => item.metadata.name))
watch(namespaces, values => { if (!values.includes(namespace.value)) namespace.value = values[0] ?? '' }, { immediate: true })
const configCapable = computed(() => run.lab?.capabilities?.kubernetesConfiguration === true)
const namespacePods = computed(() => view.value.pods.filter(item => item.metadata?.namespace === namespace.value))
const selectedPodUid = ref('')
watch(namespacePods, pods => { if (!pods.some(item => item.metadata.uid === selectedPodUid.value)) selectedPodUid.value = pods[0]?.metadata.uid ?? '' }, { immediate: true })
const selectedPodConfiguration = computed(() => cluster.value && selectedPodUid.value
  ? inspectPodConfiguration(run.behavioralRun, cluster.value.id, selectedPodUid.value) : null)
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
    <section v-if="configCapable" class="aks-config-inspection" aria-labelledby="aks-config-inspection-title">
      <header><h3 id="aks-config-inspection-title" class="blade__section-title">Pod configuration snapshot</h3><p>Environment and mounted settings are captured when each Pod starts. This view is read-only.</p></header>
      <label>Pod <select v-model="selectedPodUid" aria-label="Select Pod configuration to inspect"><option v-for="pod in namespacePods" :key="pod.metadata.uid" :value="pod.metadata.uid">{{ pod.metadata.name }}</option></select></label>
      <template v-if="selectedPodConfiguration">
        <p v-if="selectedPodConfiguration.pendingProjection" role="status" aria-live="polite">Mounted file projection pending: {{ selectedPodConfiguration.pendingProjection.secondsRemaining }} simulated seconds.</p>
        <h4>Captured environment</h4>
        <table><thead><tr><th scope="col">Name</th><th scope="col">Source</th><th scope="col">Effective value</th></tr></thead><tbody>
          <tr v-for="item in selectedPodConfiguration.environment" :key="item.name"><th scope="row">{{ item.name }}</th><td>{{ item.source }}</td><td>{{ item.value ?? 'Not shown' }}</td></tr>
        </tbody></table>
        <h4>Mounted files</h4><ul><li v-for="item in selectedPodConfiguration.mountedFiles" :key="item.path">{{ item.path }} · {{ item.source }} · {{ item.name }} key {{ item.key }}</li></ul>
        <h4>Applied resources and Pod-captured versions</h4>
        <table><thead><tr><th scope="col">Kind</th><th scope="col">Name</th><th scope="col">Keys</th><th scope="col">Captured version</th><th scope="col">Applied version</th></tr></thead><tbody>
          <tr v-for="item in selectedPodConfiguration.resources" :key="`${item.kind}/${item.name}`"><th scope="row">{{ item.kind }}</th><td>{{ item.name }}</td><td>{{ item.keys.join(', ') }}</td><td>{{ item.capturedResourceVersion }}</td><td>{{ item.appliedResourceVersion }}</td></tr>
        </tbody></table>
</template>


    </section>
    <h3 class="blade__section-title">Services</h3><EntityTable :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Type' }, { key: 'endpoint', label: 'Endpoint' }]" :rows="serviceRows" empty-text="No Services in this namespace" />
    <h3 class="blade__section-title">Image-pull events</h3><EntityTable :columns="[{ key: 'name', label: 'Event' }, { key: 'reason', label: 'Reason' }, { key: 'message', label: 'Message', grow: 2 }]" :rows="imageEvents" empty-text="No image-pull events in this namespace" />
  </template><p v-else class="aks-blade__empty">This cluster was deleted or is unavailable. Return to its resource group to inspect the remaining resources.</p>
</div></section></template>

<style scoped>
.aks-config-inspection { margin: 22px 0; padding: 16px; border-left: 3px solid var(--accent); background: var(--surface-subtle, var(--surface)); }
.aks-config-inspection header p { max-width: 70ch; color: var(--text-2); line-height: 1.5; }
.aks-config-inspection label { display: inline-flex; align-items: center; gap: 8px; margin: 4px 0 14px; }
.aks-config-inspection select { min-height: 32px; padding: 4px 8px; border: 1px solid var(--border-input); background: var(--surface); color: var(--text); font: inherit; }
.aks-config-inspection table { width: 100%; margin: 10px 0 18px; border-collapse: collapse; text-align: left; }
.aks-config-inspection th, .aks-config-inspection td { padding: 7px 9px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.aks-config-inspection th { color: var(--text-2); font-weight: 600; }
@media (max-width: 640px) { .aks-config-inspection { overflow-x: auto; } .aks-config-inspection table { min-width: 560px; } }
</style>

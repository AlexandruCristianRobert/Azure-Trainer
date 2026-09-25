<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { projectKubernetesInspection } from '../../lib/kubernetes/inspection.js'
import { inspectConnectivity } from '../../lib/kubernetes/connectivity-inspection.js'
import { inspectIntegrationRequests } from '../../lib/kubernetes/integration-inspection.js'
import { inspectPodConfiguration } from '../../lib/kubernetes/configuration-inspection.js'
import { inspectProbes } from '../../lib/kubernetes/probe-inspection.js'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: String, name: String })
const run = useLabRunStore(); const portal = usePortalStore(); const namespace = ref(''); const bladeTab = ref('overview')
const cluster = computed(() => run.sandbox.aksClusters?.find(item => item.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && item.name.toLowerCase() === props.name.toLowerCase()) ?? null)
const view = computed(() => projectKubernetesInspection(run.behavioralRun, cluster.value?.id))
const namespaces = computed(() => view.value.namespaces.map(item => item.metadata.name))
watch(namespaces, values => { if (!values.includes(namespace.value)) namespace.value = values[0] ?? '' }, { immediate: true })
const configCapable = computed(() => run.lab?.capabilities?.kubernetesConfiguration === true)
const connectivityEnabled = computed(() => run.lab?.capabilities?.kubernetesConnectivity === true)
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
function selectBladeTab(tab) { bladeTab.value = tab; document.getElementById(`aks-${tab}-tab`)?.focus() }
const deploymentRows = rows(scoped('deployments'), item => ({ name: item.metadata.name, status: `${item.spec.replicas} desired`, image: item.spec.template.spec.containers[0]?.image ?? '' }))
const podRows = rows(scoped('pods'), item => ({ name: item.metadata.name, status: item.status?.phase ?? 'Unknown', image: item.spec.containers[0]?.image ?? '' }))
const serviceRows = computed(() => view.value.serviceEndpoints.filter(item => item.namespace === namespace.value).map(item => ({ name: item.name, status: item.type, endpoint: `${item.readyBackends.length} ready: ${item.readyBackends.map(backend => backend.name).join(', ') || 'none'} · ${item.targetPort ?? 'none'} → ${item.resolvedPort ?? 'unresolved'}` })))
const connectivityViews = computed(() => view.value.services.filter(item => item.metadata?.namespace === namespace.value)
  .map(item => ({ service: item, view: inspectConnectivity(run.behavioralRun, { clusterId: cluster.value?.id, namespace: namespace.value, serviceName: item.metadata.name }) })))
const imageEvents = computed(() => view.value.events.filter(item => item.metadata?.namespace === namespace.value && ['RegistryAccessDenied', 'ImageNotFound'].includes(item.reason))
  .map(item => ({ name: item.metadata.name, reason: item.reason, message: item.message })))
const configurationEvents = computed(() => configCapable.value
  ? view.value.events.filter(item => item.metadata?.namespace === namespace.value && ['CreateContainerConfigError', 'FailedMount'].includes(item.reason))
    .map(item => ({ name: item.metadata.name, reason: item.reason, message: item.message }))
  : [])
const integrationRequests = computed(() => run.lab?.capabilities?.kubernetesAiIntegration === true
  ? inspectIntegrationRequests(run.behavioralRun, run.lab, cluster.value?.id) : [])
const probeView = computed(() => run.lab?.capabilities?.kubernetesProbes === true && cluster.value
  ? inspectProbes(run.behavioralRun, { clusterId: cluster.value.id, namespace: namespace.value,
    deploymentName: 'assistant', serviceName: 'assistant-internal' }) : null)
</script>

<template><section class="blade"><div class="blade__content blade__content--full">
  <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name }]" :title="name" subtitle="Kubernetes service" icon="aks" :commands="[{ label: 'Refresh', icon: 'arrow-sync' }]" @navigate="portal.showBlade($event)" />
  <template v-if="cluster"><EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" /><p class="aks-blade__notice">Workloads and request results are read-only. State changes are modeled immediately for this Lab.</p>
    <div class="aks-blade__scope"><label>Namespace <select v-model="namespace"><option v-for="item in namespaces" :key="item">{{ item }}</option></select></label></div>
    <div class="aks-inspection-tabs" role="tablist" aria-label="Cluster inspection">
      <button id="aks-overview-tab" role="tab" type="button" :tabindex="bladeTab === 'overview' ? 0 : -1" :aria-selected="bladeTab === 'overview'" aria-controls="aks-overview-panel" @click="bladeTab = 'overview'" @keydown.right.prevent="selectBladeTab('services')" @keydown.left.prevent="selectBladeTab('services')">Overview</button>
      <button id="aks-services-tab" role="tab" type="button" :tabindex="bladeTab === 'services' ? 0 : -1" :aria-selected="bladeTab === 'services'" aria-controls="aks-services-panel" @click="bladeTab = 'services'" @keydown.right.prevent="selectBladeTab('overview')" @keydown.left.prevent="selectBladeTab('overview')">Services</button>
    </div>
    <div v-if="bladeTab === 'overview'" id="aks-overview-panel" role="tabpanel" aria-labelledby="aks-overview-tab">
    <h3 class="blade__section-title">Nodes</h3><EntityTable :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'vmSize', label: 'VM size' }]" :rows="view.nodes" empty-text="No nodes are modeled" />
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
    <h3 class="blade__section-title">Image-pull events</h3><EntityTable :columns="[{ key: 'name', label: 'Event' }, { key: 'reason', label: 'Reason' }, { key: 'message', label: 'Message', grow: 2 }]" :rows="imageEvents" empty-text="No image-pull events in this namespace" />
    <template v-if="configCapable"><h3 class="blade__section-title">Configuration events</h3><EntityTable :columns="[{ key: 'name', label: 'Event' }, { key: 'reason', label: 'Reason' }, { key: 'message', label: 'Message', grow: 2 }]" :rows="configurationEvents" empty-text="No configuration events in this namespace" /></template>
    <section v-if="run.lab?.capabilities?.kubernetesAiIntegration" class="aks-ai-inspection" aria-labelledby="aks-ai-inspection-title">
      <h3 id="aks-ai-inspection-title" class="blade__section-title">Latest assistant requests</h3>
      <p>Read-only summaries show the latest request for each declared scenario. Request timing is separate from simulated cluster time.</p>
      <EntityTable :columns="[{ key: 'question', label: 'Declared question', grow: 2 }, { key: 'profile', label: 'Fixture profile' }, { key: 'status', label: 'HTTP' }, { key: 'elapsedMs', label: 'Request ms' }, { key: 'operations', label: 'Reached operations', grow: 2 }]" :rows="integrationRequests" empty-text="No assistant integration requests have been recorded" />
    </section>
    <section v-if="probeView" class="aks-probe-inspection" aria-label="Read-only health probe inspection">
      <h3 class="blade__section-title">Health probe state</h3>
      <p>Read-only container state and scheduled checks. A Pod can be Running and still be unready for Service traffic.</p>
      <p v-if="probeView.experiment">Experiment {{ probeView.experiment.scenarioId }}: {{ probeView.experiment.phase ?? probeView.experiment.status ?? 'active' }}</p>
      <div class="aks-probe-inspection__table"><table><thead><tr><th scope="col">Pod</th><th scope="col">Container</th><th scope="col">Ready</th><th scope="col">Restarts</th><th scope="col">Startup</th><th scope="col">Readiness</th><th scope="col">Liveness</th></tr></thead><tbody>
        <tr v-for="item in probeView.containers.filter(item => namespacePods.some(pod => pod.metadata.uid === item.podUid))" :key="item.podUid"><th scope="row">{{ item.podName }}</th><td>{{ item.containerId }}</td><td>{{ item.ready ? 'Ready' : 'Not ready' }}</td><td>{{ item.restartCount }}</td><td v-for="type in ['startup', 'readiness', 'liveness']" :key="type">{{ item.checks[type] ? `${item.checks[type].successes} successes / ${item.checks[type].failures} failures` : 'Not configured' }}</td></tr>
      </tbody></table></div>
      <h4>Probe experiment timeline</h4>
      <p v-if="!probeView.timeline?.length">No probe observations have been recorded yet.</p>
      <ol v-else class="aks-probe-inspection__timeline"><li v-for="(item, index) in probeView.timeline" :key="`${item.atMs}-${index}`"><strong>{{ item.kind?.charAt(0).toUpperCase() + item.kind?.slice(1) }}</strong> · {{ item.atMs / 1000 }}s<template v-if="item.failures !== undefined"> · {{ item.failures }} failures</template><template v-if="item.message"> · {{ item.message }}</template></li></ol>
      <p v-if="probeView.receipts?.length">Latest experiment: {{ probeView.receipts.at(-1).scenarioId }} · {{ probeView.receipts.at(-1).status }}</p>
    </section>
    </div>
    <div v-else id="aks-services-panel" role="tabpanel" aria-labelledby="aks-services-tab" class="aks-services-tab">
      <h3 class="blade__section-title">Services and selected backends</h3>
      <EntityTable v-if="!connectivityEnabled" :columns="[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Type' }, { key: 'endpoint', label: 'Endpoint' }]" :rows="serviceRows" empty-text="No Services in this namespace" />
      <template v-else>
      <p>Addresses and endpoints are simulated from the applied Service and current Pods.</p>
      <p v-if="!connectivityViews.length">No Services in this namespace.</p>
      <article v-for="item in connectivityViews" :key="item.service.metadata.uid" class="aks-service-card">
        <h4>{{ item.service.metadata.name }} <span>{{ item.service.spec.type }}</span></h4>
        <dl><dt>Namespace</dt><dd>{{ item.service.metadata.namespace }}</dd><dt>Address</dt><dd>ClusterIP {{ item.service.spec.clusterIP }}<template v-if="item.service.status?.loadBalancer?.ingress?.[0]?.ip"> · External {{ item.service.status.loadBalancer.ingress[0].ip }}</template></dd><dt>Port mapping</dt><dd>{{ item.service.spec.ports?.[0]?.port }} → {{ item.service.spec.ports?.[0]?.targetPort }}</dd><dt>Selector</dt><dd>{{ JSON.stringify(item.service.spec.selector) }}</dd></dl>
        <h5>Selected Pods and endpoints</h5>
        <div class="aks-services-tab__table"><table><thead><tr><th scope="col">Pod</th><th scope="col">Readiness</th><th scope="col">Endpoint</th><th scope="col">Backend port</th><th scope="col">Application listener</th></tr></thead><tbody><tr v-for="backend in item.view.backends" :key="backend.podUid"><th scope="row">{{ backend.name }}</th><td>{{ backend.ready ? 'Ready' : 'Not ready' }}</td><td>{{ backend.address ?? 'Not assigned' }}</td><td>{{ backend.endpointPort ?? 'Unresolved' }}</td><td>{{ backend.listenerPort ?? 'Unknown' }}</td></tr></tbody></table></div>
        <p v-if="!item.view.backends.length">No selected Pods.</p>
      </article>
      </template>
    </div>
  </template><p v-else class="aks-blade__empty">This cluster was deleted or is unavailable. Return to its resource group to inspect the remaining resources.</p>
</div></section></template>

<style scoped>
.aks-probe-inspection { margin: 22px 0; }
.aks-probe-inspection__table { overflow-x: auto; }
.aks-probe-inspection__table table { width: 100%; min-width: 700px; border-collapse: collapse; text-align: left; }
.aks-probe-inspection__table th, .aks-probe-inspection__table td { padding: 8px; border-bottom: 1px solid var(--border); }
.aks-config-inspection { margin: 22px 0; padding: 16px; border-left: 3px solid var(--accent); background: var(--surface-subtle, var(--surface)); }
.aks-ai-inspection { margin: 22px 0; }
.aks-ai-inspection > p { max-width: 70ch; color: var(--text-2); line-height: 1.5; }
.aks-config-inspection header p { max-width: 70ch; color: var(--text-2); line-height: 1.5; }
.aks-config-inspection label { display: inline-flex; align-items: center; gap: 8px; margin: 4px 0 14px; }
.aks-config-inspection select { min-height: 32px; padding: 4px 8px; border: 1px solid var(--border-input); background: var(--surface); color: var(--text); font: inherit; }
.aks-config-inspection table { width: 100%; margin: 10px 0 18px; border-collapse: collapse; text-align: left; }
.aks-config-inspection th, .aks-config-inspection td { padding: 7px 9px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
.aks-config-inspection th { color: var(--text-2); font-weight: 600; }
@media (max-width: 640px) { .aks-config-inspection { overflow-x: auto; } .aks-config-inspection table { min-width: 560px; } }
.aks-inspection-tabs { display: flex; gap: 8px; margin: 20px 0 12px; border-bottom: 1px solid var(--border); }
.aks-inspection-tabs button { border: 0; border-bottom: 2px solid transparent; padding: 10px 14px; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
.aks-inspection-tabs button[aria-selected="true"] { border-bottom-color: var(--accent); font-weight: 650; }
.aks-inspection-tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.aks-service-card { margin: 16px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-service-card h4 { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 12px; }
.aks-service-card dl { display: grid; grid-template-columns: minmax(110px, .5fr) minmax(0, 1.5fr); gap: 6px 12px; }
.aks-service-card dd { margin: 0; overflow-wrap: anywhere; }
.aks-services-tab__table { overflow-x: auto; }
.aks-services-tab__table table { width: 100%; min-width: 620px; border-collapse: collapse; text-align: left; }
.aks-services-tab__table th, .aks-services-tab__table td { padding: 8px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
@media (max-width: 640px) { .aks-service-card dl { grid-template-columns: 1fr; gap: 3px; } .aks-service-card dd { margin: 0 0 8px; } }
</style>

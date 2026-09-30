<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME } from '../../lib/sandbox/model.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import EntityTable from './EntityTable.vue'
import { appArmId } from '../../lib/simulation/runtime.js'

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const app = computed(() => (run.sandbox.containerApps ?? []).find((item) => same(item.resourceGroup, props.resourceGroup) && same(item.name, props.name)))
const deployment = computed(() => app.value && run.behavioralRun?.runtime?.deploymentsByApp?.[appArmId(app.value)])
const cpuRuntime = computed(() => app.value && run.behavioralRun?.runtime?.cpuByApp?.[appArmId(app.value)])
const cpuRule = computed(() => app.value?.scaleRules?.find((rule) => rule.custom?.type === 'cpu'))
const cpuSample = computed(() => cpuRuntime.value?.samples?.at(-1))
const probeRuntime = computed(() => app.value && run.behavioralRun?.runtime?.probesByApp?.[appArmId(app.value)])
const configuredProbes = computed(() => deployment.value?.active?.probeConfig?.probes ?? [])
const foundryAccount = computed(() => (run.sandbox.foundryAccounts ?? []).find((item) => same(item.endpoint, deployment.value?.active?.foundry?.endpoint)))
const metric = (value) => Number.isFinite(value) ? value.toFixed(1) : '—'

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Application', items: [{ id: 'revisions', label: 'Revision management' }, { id: 'scale', label: 'Scale' }, { id: 'ingress', label: 'Ingress' }, { id: 'containers', label: 'Containers' }] },
  { label: 'Settings', items: [{ id: 'configuration', label: 'Configuration' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'overview') active.value = id
}

const RO = (command) => `Blades are read-only in this Lab. Use the Cloud Shell: ${command}`
const commands = [
  { label: 'Edit and deploy', icon: 'settings', readOnlyHint: RO('az containerapp update --help') },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az containerapp delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Move', icon: 'folder-arrow-right' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Status', value: deployment.value?.status ?? 'Active' },
  { label: 'Location', value: displayLocation(app.value?.location) },
  { label: 'Environment', value: app.value?.environment ?? '', blade: app.value ? { kind: 'containerapp-environment', resourceGroup: app.value.environmentResourceGroup, name: app.value.environment } : null },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Image', value: app.value?.image ?? '', ellipsis: true },
  ...(run.lab?.engineVersion === 2 ? [
    { label: 'Desired image', value: deployment.value?.desired?.image ?? 'None' },
    { label: 'Active image', value: deployment.value?.active?.image ?? 'None' },
    { label: 'Active deployment', value: deployment.value?.active?.generation ?? 'None' },
    { label: 'Source artifact', value: deployment.value?.active?.artifactId ?? 'None' },
    { label: 'Managed identity', value: app.value?.registryIdentity ?? 'None' },
    { label: 'APP_ENV', value: deployment.value?.active?.env?.APP_ENV ?? 'Not set' },
  ] : []),
  { label: 'Ingress', value: formatIngress(app.value) },
  { label: 'Target port', value: app.value?.targetPort ?? 'Not set' },
  { label: 'Minimum replicas', value: app.value?.minReplicas ?? 'Not set' },
  { label: 'Maximum replicas', value: app.value?.maxReplicas ?? 'Not set' },
])
const columns = [
  { key: 'name', label: 'Rule name', grow: 1.4 },
  { key: 'type', label: 'Type', grow: 1 },
  { key: 'concurrency', label: 'Concurrent requests', grow: 1.3 },
]
const rows = computed(() => (app.value?.scaleRules ?? [])
  .filter((rule) => rule.http)
  .map((rule) => ({ name: rule.name, type: 'HTTP', concurrency: rule.http.metadata?.concurrentRequests ?? 'Not set' })))

function formatIngress(resource) {
  if (!resource?.ingress) return 'Disabled'
  return `${resource.ingress === 'external' ? 'External' : 'Internal'} - port ${resource.targetPort ?? 'Not set'}`
}
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Container App" icon="container-apps" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <div v-if="deployment?.diagnostics?.length" class="blade__deployment-issues"><h3>Deployment diagnostics</h3><p v-for="item in deployment.diagnostics" :key="item.code">{{ item.code }}: {{ item.message }}</p></div>
      <section v-if="run.lab?.capabilities?.cpuScaling" class="blade__cpu" aria-label="CPU scaling">
        <h3 class="blade__section-title">CPU scaling configuration</h3>
        <dl><div><dt>Requested CPU</dt><dd>{{ app?.cpu ?? 'Not set' }}</dd></div><div><dt>Memory</dt><dd>{{ app?.memory ?? 'Not set' }}</dd></div><div><dt>Replica bounds</dt><dd>{{ app?.minReplicas }}–{{ app?.maxReplicas }}</dd></div><div><dt>CPU rule</dt><dd>{{ cpuRule ? `${cpuRule.name}: ${cpuRule.custom.metadata?.value}% utilization` : 'No CPU rule' }}</dd></div></dl>
        <h3 class="blade__section-title">Observed runtime</h3>
        <dl><div><dt>Ready</dt><dd>{{ cpuRuntime?.readyReplicas ?? '—' }}</dd></div><div><dt>Pending</dt><dd>{{ cpuRuntime?.pendingReplicas?.reduce((sum, item) => sum + item.count, 0) ?? '—' }}</dd></div><div><dt>Desired</dt><dd>{{ cpuRuntime?.desiredReplicas ?? '—' }}</dd></div><div><dt>CPU utilization</dt><dd>{{ metric(cpuSample?.utilization) }}%</dd></div><div><dt>Offered</dt><dd>{{ metric(cpuSample?.offeredThroughput) }} req/s</dd></div><div><dt>Served</dt><dd>{{ metric(cpuSample?.servedThroughput) }} req/s</dd></div></dl>
      </section>
      <section v-if="run.lab?.capabilities?.healthProbes" class="blade__probes" aria-label="Health probes">
        <h3 class="blade__section-title">Configured health probes</h3>
        <p>Active deployment policy · read-only. Saved file changes take effect after deployment.</p>
        <div class="blade__probe-table"><table><thead><tr><th scope="col">Type</th><th scope="col">HTTP path</th><th scope="col">Port</th><th scope="col">Delay</th><th scope="col">Period</th><th scope="col">Timeout</th><th scope="col">Failures</th><th scope="col">Successes</th></tr></thead><tbody>
          <tr v-for="probe in configuredProbes" :key="probe.type"><th scope="row">{{ probe.type }}</th><td>{{ probe.httpGet.path }}</td><td>{{ probe.httpGet.port }}</td><td>{{ probe.initialDelaySeconds }}s</td><td>{{ probe.periodSeconds }}s</td><td>{{ probe.timeoutSeconds }}s</td><td>{{ probe.failureThreshold }}</td><td>{{ probe.successThreshold }}</td></tr>
          <tr v-if="!configuredProbes.length"><td colspan="8">No explicit health probes configured.</td></tr>
        </tbody></table></div>
        <h3 class="blade__section-title">Observed replica health</h3>
        <div class="blade__probe-table"><table><thead><tr><th scope="col">Replica</th><th scope="col">Startup</th><th scope="col">Ready for traffic</th><th scope="col">Restarts</th><th scope="col">Last restart cause</th></tr></thead><tbody>
          <tr v-for="replica in probeRuntime?.replicas ?? []" :key="replica.id"><th scope="row">Replica {{ replica.index }}</th><td>{{ configuredProbes.some((probe) => probe.type === 'Startup') ? (replica.startupComplete ? 'Complete' : 'Waiting') : 'Not configured' }}</td><td>{{ replica.ready ? 'Yes' : 'No' }}</td><td>{{ replica.restartCount }}</td><td>{{ replica.restartCause ?? '—' }}</td></tr>
          <tr v-if="!probeRuntime?.replicas?.length"><td colspan="5">No captured replica observation yet.</td></tr>
        </tbody></table></div>
        <p v-if="probeRuntime?.samples?.length">Last simulated second {{ probeRuntime.samples.at(-1).second }}: {{ probeRuntime.samples.at(-1).readyReplicas }} ready; {{ probeRuntime.samples.at(-1).restarts }} restarts. Request routing is shown in Probe Experiment Controls.</p>
      </section>
      <section v-if="run.lab?.capabilities?.foundryInference" class="blade__foundry" aria-label="Foundry inference configuration">
        <h3 class="blade__section-title">Simulated Foundry inference configuration</h3>
        <p>Active deployment · read-only. Saved source takes effect after build and redeployment.</p>
        <dl><div><dt>Account resource endpoint</dt><dd>{{ deployment?.active?.foundry?.endpoint || 'Not configured' }}</dd></div>
          <div><dt>Project endpoint</dt><dd>{{ foundryAccount?.projects?.[0]?.endpoint || 'No project' }} (management only)</dd></div>
          <div><dt>Deployment name</dt><dd>{{ deployment?.active?.foundry?.deployment || 'Not configured' }}</dd></div>
          <div><dt>Caller identity</dt><dd>{{ deployment?.active?.foundry?.identityId || 'None' }}</dd></div>
          <div><dt>Caller principal</dt><dd>{{ deployment?.active?.foundry?.principalId || 'None' }}</dd></div>
          <div><dt>Token scope</dt><dd>{{ deployment?.active?.foundry?.tokenScope || 'Not captured' }}</dd></div></dl>
      </section>
      <h3 class="blade__section-title">HTTP scale rules</h3>
      <EntityTable :columns="columns" :rows="rows" empty-text="No HTTP scale rules configured" />
    </div>
  </section>
</template>

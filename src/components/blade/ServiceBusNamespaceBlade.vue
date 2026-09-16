<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { displayLocation } from '../../lib/sandbox/locations.js'
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME } from '../../lib/sandbox/model.js'
import ResourceMenu from './ResourceMenu.vue'
import BladeHeader from './BladeHeader.vue'
import EssentialsGrid from './EssentialsGrid.vue'
import MetricCard from './MetricCard.vue'
import EntityTable from './EntityTable.vue'

const props = defineProps({ resourceGroup: { type: String, required: true }, name: { type: String, required: true }, tab: { type: String, default: 'queues' } })
const run = useLabRunStore()
const portal = usePortalStore()
const ns = computed(() => run.sandbox.namespaces.find((n) => n.resourceGroup.toLowerCase() === props.resourceGroup.toLowerCase() && n.name.toLowerCase() === props.name.toLowerCase()))
// Ruling X: the highlight is the last item explicitly clicked in the resource menu.
// Only a tab change that did NOT originate from a menu click (e.g. a Blade-focus
// event fired via portal.applyEvent after a Cloud Shell command) resets the
// highlight to the tab's default (topics -> Topics, queues -> Overview).
// `viaMenuClick` marks a tab change onMenu() itself triggered so the watcher below
// leaves the just-clicked highlight alone; nextTick clears the flag afterwards so
// it never lingers if the clicked tab was already active (no prop change to react to).
const menuOverride = ref(props.tab === 'topics' ? 'topics' : 'overview')
const viaMenuClick = ref(false)
const activeMenu = computed(() => menuOverride.value)
watch(() => props.tab, (t) => {
  if (viaMenuClick.value) return
  menuOverride.value = t === 'topics' ? 'topics' : 'overview'
})

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Settings', items: [{ id: 'sas', label: 'Shared access policies' }, { id: 'networking', label: 'Networking' }, { id: 'geo', label: 'Geo-recovery' }, { id: 'scale', label: 'Scale' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Entities', items: [{ id: 'queues', label: 'Queues' }, { id: 'topics', label: 'Topics' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
// Only these ids render different content in this Blade; clicking anything else
// (Activity log, IAM, Tags, ...) still looks clickable but must not move the highlight.
const MENU_CONTENT_IDS = ['overview', 'queues', 'topics']
function onMenu(id) {
  if (!MENU_CONTENT_IDS.includes(id)) return
  menuOverride.value = id
  if (id === 'queues' || id === 'topics') {
    viaMenuClick.value = true
    setTab(id)
    nextTick(() => { viaMenuClick.value = false })
  }
}
function setTab(tab) { portal.showBlade({ kind: 'servicebus-namespace', resourceGroup: props.resourceGroup, name: props.name, tab }) }

const RO = (cmd) => `Blades are read-only in this Lab. Use the Cloud Shell: ${cmd}`
const commands = [
  { label: 'Queue', icon: 'add', readOnlyHint: RO('az servicebus queue create --help') },
  { label: 'Topic', icon: 'add', readOnlyHint: RO('az servicebus topic create --help') },
  { divider: true },
  { label: 'Delete', icon: 'delete', readOnlyHint: RO('az servicebus namespace delete --help') },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Move', icon: 'folder-arrow-right' },
  { label: 'Feedback', icon: 'person-feedback' },
]
const essentials = computed(() => [
  { label: 'Resource group', value: props.resourceGroup, blade: { kind: 'resource-group', name: props.resourceGroup } },
  { label: 'Status', value: 'Active' },
  { label: 'Location', value: displayLocation(ns.value?.location) },
  { label: 'Pricing tier', value: ns.value?.sku ?? '' },
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Host name', value: `${props.name}.servicebus.windows.net`, ellipsis: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Tags', value: ns.value?.tags && Object.keys(ns.value.tags).length ? Object.entries(ns.value.tags).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Add tags', link: true },
])
const REQUESTS = [24, 24, 22, 24, 23, 24, 18, 24, 23, 24, 24]
const MESSAGES = [25, 25, 23, 25, 25, 19, 25, 24, 25]
const queueColumns = [{ key: 'name', label: 'Name', grow: 1.4 }, { key: 'status', label: 'Status', grow: 1 }, { key: 'maxSize', label: 'Max size', grow: 1 }, { key: 'active', label: 'Active messages', grow: 1.3 }, { key: 'deadLetter', label: 'Dead-letter messages', grow: 1.5 }, { key: 'scheduled', label: 'Scheduled', grow: 1 }]
const topicColumns = [{ key: 'name', label: 'Name', grow: 1.6 }, { key: 'status', label: 'Status', grow: 1 }, { key: 'subscriptionCount', label: 'Subscription count', grow: 1.2 }]
const queueRows = computed(() => (ns.value?.queues ?? []).map((q) => ({ name: q.name, status: q.status, maxSize: `${q.maxSizeInMegabytes / 1024} GB`, active: 0, deadLetter: 0, scheduled: 0 })))
const topicRows = computed(() => (ns.value?.topics ?? []).map((t) => ({ name: t.name, status: t.status, subscriptionCount: t.subscriptions.length })))
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="activeMenu" @select="onMenu" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', route: '/' }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Service Bus Namespace" icon="service-bus" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" @navigate="portal.showBlade($event)" />
      <div class="metrics"><MetricCard title="Requests" :points="REQUESTS" /><MetricCard title="Messages" :points="MESSAGES" /></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="tabs__tab" :class="{ 'tabs__tab--active': tab === 'queues' }" :aria-selected="tab === 'queues'" @click="setTab('queues')">Queues ({{ queueRows.length }})</button>
        <button type="button" role="tab" class="tabs__tab" :class="{ 'tabs__tab--active': tab === 'topics' }" :aria-selected="tab === 'topics'" @click="setTab('topics')">Topics ({{ topicRows.length }})</button>
      </div>
      <EntityTable v-if="tab === 'queues'" :columns="queueColumns" :rows="queueRows" empty-text="No queues yet" />
      <EntityTable v-else :columns="topicColumns" :rows="topicRows" empty-text="No topics yet" />
    </div>
  </section>
</template>

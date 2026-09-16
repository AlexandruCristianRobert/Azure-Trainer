# Azure-Trainer Demo Implementation Plan — Part 3: Blades, Cloud Shell, Lab Panel, Verification (Tasks 11–14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Requires Parts 1 and 2 to be complete.

**Goal / Architecture / Tech Stack / Spec / Global Constraints:** identical to Part 1 — read its header first. Visual truth: `docs/design/Azure-Trainer Screens.dc.html`, artboards 2 (lines 99–238) and 3 (lines 240–376). Read those line ranges before styling.

**Interfaces consumed:** stores from Part 2 (`useLabRunStore`, `usePortalStore`, `useProgressStore`), blade shapes `{ kind: 'resource-groups' } | { kind: 'resource-group', name } | { kind: 'servicebus-namespace', resourceGroup, name, tab }`, scrollback entries `{ kind: 'cmd'|'out'|'err', text }`, `displayLocation`, `SUBSCRIPTION_ID`, `SUBSCRIPTION_NAME`, `renderInline`, `formatDuration`, `formatClock`, icons.

**ADR-0001 reminder:** nothing in these components may import `src/lib/sandbox/ops.js` or call `runLine`. All mutation goes through `labRun.execute(line)` from the Cloud Shell input only.

---

### Task 11: Blades (read-only mirrors of the Sandbox)

**Files:**
- Create: `src/lib/bladeResolve.js`, `src/components/blade/BladeHost.vue`, `src/components/blade/ResourceMenu.vue`, `src/components/blade/BladeHeader.vue`, `src/components/blade/EssentialsGrid.vue`, `src/components/blade/MetricCard.vue`, `src/components/blade/EntityTable.vue`, `src/components/blade/ResourceGroupsBlade.vue`, `src/components/blade/ResourceGroupBlade.vue`, `src/components/blade/ServiceBusNamespaceBlade.vue`
- Modify: `src/styles/components.css` (append blade styles)
- Test: `tests/blade-resolve.test.js`

**Interfaces:**
- Produces: `resolveBlade(blade, sandbox) → blade` (falls back to the nearest existing ancestor); `<BladeHost />` (reads `portal.blade` + `labRun.sandbox`); `ResourceMenu` props `{ sections: [{ label?, collapsed?, items: [{ id, label }] }], activeId }` emits `select(id)`; `BladeHeader` props `{ crumbs: [{ label, blade|null }], title, subtitle, icon, commands: [{ label, icon, divider? }] }` emits `navigate(blade)` and `command(label)`; `EssentialsGrid` props `{ items: [{ label, value, blade?, ellipsis? }] }` emits `navigate`; `MetricCard` props `{ title, points: number[] }`; `EntityTable` props `{ columns: [{ key, label, grow }], rows, emptyText, nameKey }` emits `open(row)`.

- [ ] **Step 1: Failing test**

`tests/blade-resolve.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { resolveBlade } from '../src/lib/bladeResolve.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const LIST = { kind: 'resource-groups' }
const RG = { kind: 'resource-group', name: 'rg-orders' }
const NS = { kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders', tab: 'topics' }

describe('resolveBlade', () => {
  it('keeps blades whose target exists', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders').sandbox
    expect(resolveBlade(NS, sb)).toEqual(NS)
    expect(resolveBlade(RG, sb)).toEqual(RG)
    expect(resolveBlade(LIST, sb)).toEqual(LIST)
  })
  it('falls back to the parent when the target is gone', () => {
    const sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(resolveBlade(NS, sb)).toEqual(RG)
    expect(resolveBlade(RG, createSandbox())).toEqual(LIST)
    expect(resolveBlade(NS, createSandbox())).toEqual(LIST)
  })
  it('defaults the namespace tab to queues', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders').sandbox
    expect(resolveBlade({ kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders' }, sb).tab).toBe('queues')
  })
})
```

- [ ] **Step 2: Run to verify failure**, then implement `src/lib/bladeResolve.js`:

```js
const LIST = { kind: 'resource-groups' }

function hasGroup(sb, name) {
  return sb.resourceGroups.some((g) => g.name.toLowerCase() === String(name).toLowerCase())
}

function hasNamespace(sb, rg, name) {
  return sb.namespaces.some((n) => n.resourceGroup.toLowerCase() === String(rg).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase())
}

export function resolveBlade(blade, sandbox) {
  if (!blade) return LIST
  if (blade.kind === 'servicebus-namespace') {
    if (hasNamespace(sandbox, blade.resourceGroup, blade.name)) return { ...blade, tab: blade.tab ?? 'queues' }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'resource-group') return hasGroup(sandbox, blade.name) ? blade : LIST
  return LIST
}
```

- [ ] **Step 3: Shared blade components**

`ResourceMenu.vue`:

```vue
<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'

const props = defineProps({
  sections: { type: Array, required: true },
  activeId: { type: String, default: 'overview' },
})
const emit = defineEmits(['select'])
const collapsed = ref(Object.fromEntries(props.sections.filter((s) => s.label).map((s) => [s.label, !!s.collapsed])))
function toggle(label) { collapsed.value[label] = !collapsed.value[label] }
</script>

<template>
  <nav class="resource-menu" aria-label="Resource menu">
    <label class="resource-menu__search"><FluentIcon name="search" :size="13" /><input type="search" placeholder="Search" aria-label="Search resource menu" /></label>
    <template v-for="section in sections" :key="section.label ?? 'root'">
      <button v-if="section.label" type="button" class="resource-menu__group" :aria-expanded="!collapsed[section.label]" @click="toggle(section.label)">
        {{ section.label }}<FluentIcon :name="collapsed[section.label] ? 'chevron-right' : 'chevron-down'" :size="12" />
      </button>
      <template v-if="!section.label || !collapsed[section.label]">
        <button v-for="item in section.items" :key="item.id" type="button" class="resource-menu__item" :class="{ 'resource-menu__item--active': item.id === activeId, 'resource-menu__item--nested': !!section.label }" @click="emit('select', item.id)">
          {{ item.label }}
        </button>
      </template>
    </template>
  </nav>
</template>
```

`BladeHeader.vue`:

```vue
<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'
import AzureIcon from '../icons/AzureIcon.vue'

defineProps({
  crumbs: { type: Array, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
  iconTint: { type: String, default: 'var(--tint-blue)' },
  commands: { type: Array, default: () => [] },
})
const emit = defineEmits(['navigate', 'command'])
const notice = ref('')
let timer = null
function onCommand(cmd) {
  emit('command', cmd.label)
  if (cmd.readOnlyHint) {
    notice.value = cmd.readOnlyHint
    clearTimeout(timer)
    timer = setTimeout(() => { notice.value = '' }, 5000)
  }
}
</script>

<template>
  <div class="blade-header">
    <div class="blade-header__crumbs">
      <template v-for="(c, i) in crumbs" :key="i">
        <a v-if="c.blade" href="#" @click.prevent="emit('navigate', c.blade)">{{ c.label }}</a>
        <span v-else>{{ c.label }}</span>
        <span v-if="i < crumbs.length - 1" class="blade-header__sep">&gt;</span>
      </template>
    </div>
    <div class="blade-header__title-row">
      <div v-if="icon" class="blade-header__icon" :style="{ background: iconTint }"><AzureIcon :name="icon" :size="20" /></div>
      <div class="blade-header__titles">
        <h1 class="blade-header__title">{{ title }}</h1>
        <div v-if="subtitle" class="blade-header__subtitle">{{ subtitle }}</div>
      </div>
      <div class="blade-header__tools">
        <button type="button" aria-label="Add to favorites"><FluentIcon name="star" :size="15" /></button>
        <button type="button" aria-label="Pin to dashboard"><FluentIcon name="pin" :size="14" /></button>
        <button type="button" aria-label="Close" @click="emit('navigate', { kind: 'resource-groups' })"><FluentIcon name="dismiss" :size="13" /></button>
      </div>
    </div>
    <div v-if="commands.length" class="command-bar">
      <template v-for="(cmd, i) in commands" :key="i">
        <span v-if="cmd.divider" class="command-bar__divider" />
        <button v-else type="button" class="command-bar__btn" @click="onCommand(cmd)">
          <FluentIcon :name="cmd.icon" :size="14" />{{ cmd.label }}
        </button>
      </template>
    </div>
    <div v-if="notice" class="blade-header__notice" role="status">{{ notice }}</div>
  </div>
</template>
```

`EssentialsGrid.vue`:

```vue
<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'

defineProps({ items: { type: Array, required: true } })
const emit = defineEmits(['navigate'])
const open = ref(true)
</script>

<template>
  <div class="essentials">
    <div class="essentials__head">
      <button type="button" class="essentials__toggle" :aria-expanded="open" @click="open = !open">Essentials <FluentIcon :name="open ? 'chevron-up' : 'chevron-down'" :size="11" /></button>
      <a href="#" @click.prevent>JSON View</a>
    </div>
    <div v-if="open" class="essentials__grid">
      <div v-for="item in items" :key="item.label" class="essentials__row" :class="{ 'essentials__row--ellipsis': item.ellipsis }">
        <div class="essentials__label">{{ item.label }}</div>
        <a v-if="item.blade" href="#" @click.prevent="emit('navigate', item.blade)">{{ item.value }}</a>
        <a v-else-if="item.link" href="#" @click.prevent>{{ item.value }}</a>
        <div v-else class="essentials__value">{{ item.value }}</div>
      </div>
    </div>
  </div>
</template>
```

`MetricCard.vue`:

```vue
<script setup>
import { computed } from 'vue'

const props = defineProps({ title: { type: String, required: true }, points: { type: Array, required: true } })
const path = computed(() => {
  const n = props.points.length
  return props.points.map((y, i) => `${Math.round((i / Math.max(1, n - 1)) * 340)},${y}`).join(' ')
})
</script>

<template>
  <div class="metric-card">
    <div class="metric-card__head"><span class="metric-card__title">{{ title }}</span><span class="metric-card__range">Last hour</span></div>
    <svg width="100%" height="30" viewBox="0 0 340 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="path" fill="none" stroke="var(--accent)" stroke-width="1.5" /></svg>
  </div>
</template>
```

`EntityTable.vue`:

```vue
<script setup>
defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, required: true },
  emptyText: { type: String, default: 'No items to display' },
  nameKey: { type: String, default: 'name' },
})
const emit = defineEmits(['open'])
</script>

<template>
  <div class="entity-table" :style="{ '--cols': columns.map((c) => `${c.grow ?? 1}fr`).join(' ') }">
    <div class="entity-table__head">
      <div v-for="c in columns" :key="c.key">{{ c.label }}</div>
    </div>
    <div v-if="!rows.length" class="entity-table__empty">{{ emptyText }}</div>
    <div v-for="row in rows" :key="row[nameKey]" class="entity-table__row">
      <template v-for="c in columns" :key="c.key">
        <a v-if="c.key === nameKey" href="#" @click.prevent="emit('open', row)">{{ row[c.key] }}</a>
        <div v-else-if="c.key === 'status'" class="entity-table__status"><span class="entity-table__dot" :class="{ 'entity-table__dot--off': row.status !== 'Active' }" />{{ row[c.key] }}</div>
        <div v-else>{{ row[c.key] }}</div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 4: The three Blades and the host**

`ResourceGroupsBlade.vue`:

```vue
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
      <BladeHeader :crumbs="[{ label: 'Home', blade: null }, { label: 'Resource groups', blade: null }]" title="Resource groups" :subtitle="SUBSCRIPTION_NAME" icon="resource-group" :commands="commands" @navigate="portal.showBlade($event)" />
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter resource groups" /><span class="blade__count">Showing 1 to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No resource groups to display" @open="portal.showBlade({ kind: 'resource-group', name: $event.name })" />
      <p v-if="!rows.length" class="blade__hint">Nothing here yet. Create your first resource group from the Cloud Shell below: <code>az group create --name &lt;name&gt; --location &lt;location&gt;</code></p>
    </div>
  </section>
</template>
```

`ResourceGroupBlade.vue`:

```vue
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

const props = defineProps({ name: { type: String, required: true } })
const run = useLabRunStore()
const portal = usePortalStore()
const active = ref('overview')
const group = computed(() => run.sandbox.resourceGroups.find((g) => g.name.toLowerCase() === props.name.toLowerCase()))
const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'visualizer', label: 'Resource visualizer' }, { id: 'events', label: 'Events' }] },
  { label: 'Settings', items: [{ id: 'deployments', label: 'Deployments' }, { id: 'security', label: 'Security' }, { id: 'policies', label: 'Policies' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Cost Management', collapsed: true, items: [] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
const HINT = 'Blades are read-only in this Lab. Create resources from the Cloud Shell, e.g. az servicebus namespace create --help'
const commands = [
  { label: 'Create', icon: 'add', readOnlyHint: HINT },
  { label: 'Manage view', icon: 'settings' },
  { label: 'Delete resource group', icon: 'delete', readOnlyHint: 'Blades are read-only in this Lab. Use the Cloud Shell: az group delete --name <name> --yes' },
  { label: 'Refresh', icon: 'arrow-sync' },
  { label: 'Export to CSV', icon: 'arrow-upload' },
  { label: 'Open query', icon: 'open' },
  { divider: true },
  { label: 'Move', icon: 'folder-arrow-right' },
  { label: 'Assign tags', icon: 'tag' },
]
const essentials = computed(() => [
  { label: 'Subscription', value: SUBSCRIPTION_NAME, link: true },
  { label: 'Deployments', value: 'No deployments', link: true },
  { label: 'Subscription ID', value: SUBSCRIPTION_ID },
  { label: 'Location', value: displayLocation(group.value?.location) },
  { label: 'Tags', value: group.value?.tags ? Object.entries(group.value.tags).map(([k, v]) => `${k}: ${v}`).join(', ') : 'Add tags', link: !group.value?.tags },
])
const columns = [{ key: 'name', label: 'Name', grow: 1.6 }, { key: 'type', label: 'Type', grow: 1.2 }, { key: 'location', label: 'Location', grow: 1 }]
const rows = computed(() => run.sandbox.namespaces.filter((n) => n.resourceGroup.toLowerCase() === props.name.toLowerCase()).map((n) => ({ name: n.name, type: 'Service Bus Namespace', location: displayLocation(n.location), resourceGroup: n.resourceGroup })))
</script>

<template>
  <section class="blade">
    <ResourceMenu :sections="sections" :active-id="active" @select="active = $event" />
    <div class="blade__content">
      <BladeHeader :crumbs="[{ label: 'Home', blade: null }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: name, blade: null }]" :title="name" subtitle="Resource group" icon="resource-group" :commands="commands" @navigate="portal.showBlade($event)" />
      <EssentialsGrid :items="essentials" />
      <h3 class="blade__section-title">Resources</h3>
      <div class="blade__filters"><input type="search" placeholder="Filter for any field..." aria-label="Filter resources" /><span class="blade__count">Showing 1 to {{ rows.length }} of {{ rows.length }} records.</span></div>
      <EntityTable :columns="columns" :rows="rows" empty-text="No resources to display" @open="portal.showBlade({ kind: 'servicebus-namespace', resourceGroup: $event.resourceGroup, name: $event.name, tab: 'queues' })" />
    </div>
  </section>
</template>
```

Note: the `tag` icon used by "Assign tags" is an Azure icon name, not Fluent; `BladeHeader` renders Fluent only. Use Fluent `info` for "Assign tags" or download `Tag` from Fluent (`assets/Tag/SVG/ic_fluent_tag_20_regular.svg` → `src/assets/icons/fluent/tag.svg`) with the same curl pattern used in the icon setup; prefer downloading it.

`ServiceBusNamespaceBlade.vue` (artboard 2/3 layout):

```vue
<script setup>
import { computed } from 'vue'
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
const activeMenu = computed(() => (props.tab === 'topics' ? 'topics' : props.tab === 'queues' && menuOverride.value === 'queues' ? 'queues' : 'overview'))
import { ref, watch } from 'vue'
const menuOverride = ref('overview')
watch(() => props.tab, () => { menuOverride.value = 'overview' })

const sections = [
  { items: [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity log' }, { id: 'iam', label: 'Access control (IAM)' }, { id: 'tags', label: 'Tags' }, { id: 'diagnose', label: 'Diagnose and solve problems' }] },
  { label: 'Settings', items: [{ id: 'sas', label: 'Shared access policies' }, { id: 'networking', label: 'Networking' }, { id: 'geo', label: 'Geo-recovery' }, { id: 'scale', label: 'Scale' }, { id: 'properties', label: 'Properties' }, { id: 'locks', label: 'Locks' }] },
  { label: 'Entities', items: [{ id: 'queues', label: 'Queues' }, { id: 'topics', label: 'Topics' }] },
  { label: 'Monitoring', collapsed: true, items: [] },
  { label: 'Automation', collapsed: true, items: [] },
  { label: 'Help', collapsed: true, items: [] },
]
function onMenu(id) {
  if (id === 'queues' || id === 'topics') { menuOverride.value = id; setTab(id); return }
  menuOverride.value = id
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
      <BladeHeader :crumbs="[{ label: 'Home', blade: null }, { label: 'Resource groups', blade: { kind: 'resource-groups' } }, { label: resourceGroup, blade: { kind: 'resource-group', name: resourceGroup } }, { label: name, blade: null }]" :title="name" subtitle="Service Bus Namespace" icon="service-bus" :commands="commands" @navigate="portal.showBlade($event)" />
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
```

Clean-up note for the implementer: move the `import { ref, watch } from 'vue'` line to the top import (`import { computed, ref, watch } from 'vue'`) and declare `menuOverride` before `activeMenu`; the snippet above shows intent, not final ordering.

`BladeHost.vue`:

```vue
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
```

- [ ] **Step 5: Append blade CSS** (values from artboard 2, lines 117–178)

```css
/* ---- Blade -------------------------------------------------------------- */
.blade { flex: 1; min-height: 0; display: flex; background: var(--surface); }
.blade__content { flex: 1; min-width: 0; padding: 14px 24px 24px; overflow: auto; }
.blade__content--full { padding-left: 24px; }
.blade__section-title { font-size: 13px; font-weight: 600; margin: 16px 0 8px; }
.blade__filters { display: flex; align-items: center; gap: 12px; margin: 10px 0 6px; }
.blade__filters input { width: 320px; height: 28px; border: 1px solid var(--border-input); border-radius: 3px; padding: 0 8px; font: inherit; font-size: 12.5px; }
.blade__count { font-size: 11.5px; color: var(--text-dim); }
.blade__hint { font-size: 12.5px; color: var(--text-dim); margin: 14px 0 0; }

.resource-menu { width: var(--resource-menu-w); flex: none; border-right: 1px solid var(--border); padding: 10px 8px; overflow: auto; display: flex; flex-direction: column; }
.resource-menu__search { height: 28px; border: 1px solid var(--border-input); border-radius: 3px; display: flex; align-items: center; gap: 6px; padding: 0 8px; color: var(--text-faint); font-size: 12px; margin-bottom: 8px; }
.resource-menu__search input { flex: 1; border: 0; outline: none; font: inherit; font-size: 12px; background: transparent; }
.resource-menu__item { height: 28px; display: flex; align-items: center; padding: 0 10px; font-size: 12.5px; border-radius: 3px; text-align: left; width: 100%; }
.resource-menu__item:hover { background: var(--chip-bg); }
.resource-menu__item--nested { height: 26px; padding-left: 22px; }
.resource-menu__item--active { font-weight: 600; color: var(--accent-strong); background: var(--accent-soft); }
.resource-menu__group { height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; font-size: 12px; font-weight: 600; color: var(--text-dim); margin-top: 4px; width: 100%; }

.blade-header__crumbs { font-size: 12px; color: var(--text-dim); margin-bottom: 10px; display: flex; gap: 4px; flex-wrap: wrap; }
.blade-header__sep { color: var(--text-dim); }
.blade-header__title-row { display: flex; align-items: center; gap: 12px; }
.blade-header__icon { width: 34px; height: 34px; border-radius: var(--radius-l); display: flex; align-items: center; justify-content: center; flex: none; }
.blade-header__titles { flex: 1; min-width: 0; }
.blade-header__title { font-size: 20px; font-weight: 600; line-height: 1.2; margin: 0; }
.blade-header__subtitle { font-size: 12px; color: var(--text-dim); }
.blade-header__tools { display: flex; align-items: center; gap: 14px; color: var(--text-dim); }
.blade-header__tools button { display: inline-flex; color: inherit; }
.blade-header__notice { margin-top: 8px; font-size: 12px; color: var(--accent-strong); background: var(--accent-soft); border-radius: 3px; padding: 6px 10px; }

.command-bar { display: flex; align-items: center; gap: 2px; border-bottom: 1px solid var(--border); margin-top: 10px; height: 38px; }
.command-bar__btn { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; font-size: 12.5px; color: var(--text); border-radius: 3px; }
.command-bar__btn .icon { color: var(--accent); }
.command-bar__btn:hover { background: var(--chip-bg); }
.command-bar__divider { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }

.essentials { margin-top: 12px; }
.essentials__head { display: flex; align-items: center; justify-content: space-between; }
.essentials__toggle { font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.essentials__head a { font-size: 12px; }
.essentials__grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; row-gap: 4px; margin-top: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.essentials__row { display: flex; font-size: 12.5px; min-width: 0; }
.essentials__label { width: 130px; flex: none; color: var(--text-dim); }
.essentials__row--ellipsis .essentials__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.metrics { display: flex; gap: 16px; margin-top: 12px; }
.metric-card { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-m); padding: 10px 12px; }
.metric-card__head { display: flex; justify-content: space-between; font-size: 12.5px; }
.metric-card__title { font-weight: 600; }
.metric-card__range { color: var(--text-faint); font-size: 11px; }
.metric-card svg { margin-top: 6px; display: block; }

.tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--border); margin-top: 14px; }
.tabs__tab { padding: 8px 2px; font-size: 13px; color: var(--text-dim); }
.tabs__tab--active { font-weight: 600; color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }

.entity-table__head, .entity-table__row { display: grid; grid-template-columns: var(--cols); padding: 8px 4px; border-bottom: 1px solid var(--border); font-size: 12.5px; align-items: center; }
.entity-table__head { font-size: 11.5px; font-weight: 600; color: var(--text-dim); }
.entity-table__row { padding: 9px 4px; border-bottom-color: var(--border-faint); }
.entity-table__empty { padding: 28px 4px; font-size: 12.5px; color: var(--text-dim); text-align: center; border-bottom: 1px solid var(--border-faint); }
.entity-table__status { display: flex; align-items: center; gap: 6px; }
.entity-table__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.entity-table__dot--off { background: var(--text-faint); }
```

- [ ] **Step 6: Run tests, then commit**

`npx vitest run` → green (blade-resolve added). `npm run build` → OK.

```bash
git add -A
git commit -m "feat(blade): read-only Blades for resource groups, a resource group and a Service Bus namespace"
```

---

### Task 12: Cloud Shell dock and terminal

**Files:**
- Create: `src/components/shell/CloudShell.vue`, `src/components/shell/ShellTerminal.vue`
- Modify: `src/styles/components.css` (append shell styles)

**Interfaces:**
- Consumes: `labRun.scrollback`, `labRun.history`, `labRun.running`, `labRun.execute(line)`, `labRun.clearScrollback()`, `portal.shell`, `portal.toggleShellMinimized/Maximized/closeShell`.
- Produces: `<CloudShell />` (no props). Prompt text `user@sandbox:~$`. Spinner line while `running`: ``${frame} Running ..`` with frames `['-', '\\', '|', '/']` every 120ms.

- [ ] **Step 1: ShellTerminal.vue**

```vue
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'

const run = useLabRunStore()
const input = ref('')
const inputEl = ref(null)
const bodyEl = ref(null)
const histIndex = ref(-1)
const draft = ref('')
const frames = ['-', '\\', '|', '/']
const frame = ref(0)
let spinner = null

watch(() => run.running, (r) => {
  clearInterval(spinner)
  if (r) spinner = setInterval(() => { frame.value = (frame.value + 1) % frames.length }, 120)
})

const spinnerText = computed(() => `${frames[frame.value]} Running ..`)

async function scrollToBottom() {
  await nextTick()
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight
}
watch(() => [run.scrollback.length, run.running], scrollToBottom)

async function submit() {
  if (run.running) return
  const line = input.value
  input.value = ''
  histIndex.value = -1
  draft.value = ''
  await run.execute(line)
  scrollToBottom()
}

function onKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); submit(); return }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!run.history.length) return
    if (histIndex.value === -1) { draft.value = input.value; histIndex.value = run.history.length - 1 } else if (histIndex.value > 0) histIndex.value--
    input.value = run.history[histIndex.value]
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histIndex.value === -1) return
    if (histIndex.value < run.history.length - 1) { histIndex.value++; input.value = run.history[histIndex.value] } else { histIndex.value = -1; input.value = draft.value }
    return
  }
  if (e.key === 'Tab') { e.preventDefault(); return }
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); run.clearScrollback(); return }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); run.pushLine({ kind: 'cmd', text: `${input.value}^C` }); input.value = ''; histIndex.value = -1 }
}

function focus() { inputEl.value?.focus() }
onMounted(() => { focus(); scrollToBottom() })
onBeforeUnmount(() => clearInterval(spinner))
</script>

<template>
  <div ref="bodyEl" class="terminal" @click="focus">
    <pre class="terminal__pre"><template v-for="(line, i) in run.scrollback" :key="i"><template v-if="line.kind === 'cmd'"><span class="terminal__user">user@sandbox</span>:<span class="terminal__path">~</span>$ {{ line.text }}
</template><span v-else-if="line.kind === 'err'" class="terminal__err">{{ line.text }}
</span><template v-else>{{ line.text }}
</template></template><span v-if="run.running" class="terminal__spinner">{{ spinnerText }}</span></pre>
    <form v-if="!run.running" class="terminal__input-row" @submit.prevent="submit">
      <span><span class="terminal__user">user@sandbox</span>:<span class="terminal__path">~</span>$&nbsp;</span>
      <input ref="inputEl" v-model="input" class="terminal__input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Cloud Shell command input" @keydown="onKeydown" />
    </form>
  </div>
</template>
```

Whitespace inside the `<pre>` is significant: keep the template exactly as written (newline after each line's text, no indentation inside the `<pre>`).

- [ ] **Step 2: CloudShell.vue**

```vue
<script setup>
import { usePortalStore } from '../../stores/portal.js'
import { useLabRunStore } from '../../stores/labRun.js'
import FluentIcon from '../icons/FluentIcon.vue'
import ShellTerminal from './ShellTerminal.vue'

const portal = usePortalStore()
const run = useLabRunStore()
</script>

<template>
  <section class="shell" :class="{ 'shell--minimized': portal.shell.minimized, 'shell--maximized': portal.shell.maximized }" aria-label="Cloud Shell">
    <div class="shell__header">
      <div class="shell__handle" aria-hidden="true" />
      <button type="button" class="shell__bash" aria-label="Shell type">Bash <FluentIcon name="chevron-down" :size="10" /></button>
      <div class="shell__spacer" />
      <div class="shell__tools">
        <button type="button" aria-label="Restart Cloud Shell" title="Restart" @click="run.clearScrollback()"><FluentIcon name="arrow-counterclockwise" :size="14" /></button>
        <button type="button" aria-label="Upload/Download files" title="Upload/Download files"><FluentIcon name="arrow-sort" :size="14" /></button>
        <button type="button" aria-label="Open new session" title="Open new session"><FluentIcon name="add" :size="14" /></button>
        <button type="button" aria-label="Open editor" title="Open editor"><FluentIcon name="code" :size="14" /></button>
        <button type="button" aria-label="Web preview" title="Web preview"><FluentIcon name="open" :size="14" /></button>
        <button type="button" aria-label="More" title="More"><FluentIcon name="more-horizontal" :size="14" /></button>
        <button type="button" aria-label="Help" title="Help" @click="run.execute('az --help')"><FluentIcon name="question-circle" :size="14" /></button>
        <button type="button" aria-label="Minimize" title="Minimize" @click="portal.toggleShellMinimized()"><FluentIcon name="subtract" :size="14" /></button>
        <button type="button" aria-label="Maximize" title="Maximize" @click="portal.toggleShellMaximized()"><FluentIcon name="maximize" :size="14" /></button>
        <button type="button" aria-label="Close Cloud Shell" title="Close" @click="portal.closeShell()"><FluentIcon name="dismiss" :size="14" /></button>
      </div>
    </div>
    <ShellTerminal v-if="!portal.shell.minimized" />
  </section>
</template>
```

- [ ] **Step 3: Append shell CSS** (artboard 2, lines 180–198)

```css
/* ---- Cloud Shell -------------------------------------------------------- */
.shell { height: var(--shell-h); flex: none; display: flex; flex-direction: column; border-top: 1px solid var(--shell-border); }
.shell--minimized { height: var(--shell-header-h); }
.shell--maximized { height: auto; flex: 1; min-height: 0; }
.shell__header { height: var(--shell-header-h); flex: none; background: var(--shell-header-bg); display: flex; align-items: center; padding: 0 12px; position: relative; }
.shell__handle { position: absolute; left: 50%; top: 4px; transform: translateX(-50%); width: 44px; height: 4px; border-radius: 2px; background: var(--shell-handle); }
.shell__bash { display: inline-flex; align-items: center; gap: 6px; font: 500 12px var(--font-mono); color: var(--shell-title); }
.shell__spacer { flex: 1; }
.shell__tools { display: flex; align-items: center; gap: 10px; color: var(--shell-muted); }
.shell__tools button { display: inline-flex; color: inherit; padding: 3px; border-radius: 3px; }
.shell__tools button:hover { color: var(--shell-title); background: rgba(255, 255, 255, 0.06); }

.terminal { flex: 1; min-height: 0; background: var(--shell-bg); padding: 8px 14px; overflow: auto; font: 12px/1.45 var(--font-mono); color: var(--shell-text); cursor: text; }
.terminal__pre { margin: 0; font: inherit; white-space: pre-wrap; word-break: break-all; }
.terminal__user { color: var(--shell-green); }
.terminal__path { color: var(--shell-blue); }
.terminal__err { color: var(--shell-red); }
.terminal__spinner { color: var(--shell-muted); }
.terminal__input-row { display: flex; align-items: baseline; }
.terminal__input { flex: 1; background: transparent; border: 0; outline: none; font: inherit; color: inherit; padding: 0; caret-color: var(--shell-text); }
```

- [ ] **Step 4: Build check and commit**

`npm run build` → OK (components compile). Wire-up happens in Task 13.

```bash
git add -A
git commit -m "feat(shell): Cloud Shell dock with bash-like terminal (history, clear, spinner)"
```

---

### Task 13: Lab Panel, Lab complete state, and the Lab page layout

**Files:**
- Create: `src/components/lab/LabPanel.vue`, `src/components/lab/TaskRow.vue`, `src/components/lab/HintBox.vue`, `src/components/lab/ExamNote.vue`, `src/components/lab/LabCompletePanel.vue`
- Modify: `src/pages/LabPage.vue` (replace placeholder), `src/styles/components.css` (append), `src/styles/pages.css` (append)

**Interfaces:**
- Consumes: everything above. `TaskRow` props `{ task, state: 'done'|'current'|'pending', hintsRevealed: Number, solutionRevealed: Boolean, examNoteOpen: Boolean }` emits `toggle-exam-note`, `reveal-hint`, `reveal-solution`.

- [ ] **Step 1: ExamNote.vue and HintBox.vue**

`ExamNote.vue`:

```vue
<script setup>
import { renderInline } from '../../lib/inlineCode.js'
defineProps({ text: { type: String, required: true } })
</script>

<template>
  <div class="exam-note">
    <div class="exam-note__label">EXAM NOTE</div>
    <div class="exam-note__text" v-html="renderInline(text)" />
  </div>
</template>
```

`HintBox.vue`:

```vue
<script setup>
import { renderInline } from '../../lib/inlineCode.js'
defineProps({ index: { type: Number, required: true }, total: { type: Number, required: true }, text: { type: String, required: true } })
</script>

<template>
  <div class="hint-box">
    <div class="hint-box__label">HINT {{ index }} OF {{ total }}</div>
    <div class="hint-box__text" v-html="renderInline(text)" />
  </div>
</template>
```

- [ ] **Step 2: TaskRow.vue**

```vue
<script setup>
import { computed, ref } from 'vue'
import { renderInline } from '../../lib/inlineCode.js'
import FluentIcon from '../icons/FluentIcon.vue'
import HintBox from './HintBox.vue'
import ExamNote from './ExamNote.vue'

const props = defineProps({
  task: { type: Object, required: true },
  state: { type: String, required: true },
  hintsRevealed: { type: Number, default: 0 },
  solutionRevealed: { type: Boolean, default: false },
  examNoteOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle-exam-note', 'reveal-hint', 'reveal-solution'])
const copied = ref(false)
const nextHint = computed(() => props.hintsRevealed + 1)
async function copySolution() {
  try { await navigator.clipboard.writeText(props.task.solution); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <li class="task" :class="`task--${state}`">
    <div class="task__row">
      <span v-if="state === 'done'" class="task__mark task__mark--done" aria-label="Done"><FluentIcon name="checkmark" :size="10" /></span>
      <span v-else-if="state === 'current'" class="task__mark task__mark--current">{{ task.index + 1 }}</span>
      <span v-else class="task__mark task__mark--pending" />
      <div class="task__text">
        <span v-html="renderInline(task.text)" />
        <button v-if="state === 'done'" type="button" class="task__note-toggle" :aria-expanded="examNoteOpen" @click="emit('toggle-exam-note')">Exam Note <FluentIcon :name="examNoteOpen ? 'chevron-down' : 'chevron-right'" :size="9" /></button>
      </div>
    </div>
    <ExamNote v-if="state === 'done' && examNoteOpen" class="task__indent" :text="task.examNote" />
    <template v-if="state === 'current'">
      <HintBox v-for="i in hintsRevealed" :key="i" class="task__indent" :index="i" :total="task.hints.length" :text="task.hints[i - 1]" />
      <div v-if="solutionRevealed" class="solution task__indent">
        <div class="solution__head"><span class="solution__label">SOLUTION</span><button type="button" class="solution__copy" @click="copySolution">{{ copied ? 'Copied' : 'Copy' }}</button></div>
        <pre class="solution__code">{{ task.solution }}</pre>
      </div>
      <div class="task__actions task__indent">
        <button v-if="hintsRevealed < task.hints.length" type="button" class="task__hint-link" @click="emit('reveal-hint')">Show hint {{ nextHint }}</button>
        <button v-if="!solutionRevealed" type="button" class="task__solution-btn" @click="emit('reveal-solution')">Show solution</button>
      </div>
    </template>
  </li>
</template>
```

- [ ] **Step 3: LabCompletePanel.vue** (artboard 3, lines 345–366)

```vue
<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { useProgressStore } from '../../stores/progress.js'
import { formatDuration, formatClock } from '../../lib/format.js'
import { renderInline } from '../../lib/inlineCode.js'
import { LABS } from '../../data/labs/index.js'
import FluentIcon from '../icons/FluentIcon.vue'

const run = useLabRunStore()
const progress = useProgressStore()
const emit = defineEmits(['restart'])
const result = computed(() => progress.results.find((r) => r.id === run.resultId) ?? progress.latestResult(run.labId))
const nextLab = computed(() => LABS.find((l) => l.id !== run.labId))
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
</script>

<template>
  <div class="lab-complete">
    <div class="lab-complete__header">
      <div class="lab-complete__title-row"><span class="lab-complete__check"><FluentIcon name="checkmark" :size="11" /></span><span class="lab-complete__title">Lab complete</span></div>
      <div class="lab-complete__lab">{{ run.lab.title }}</div>
      <div class="lab-panel__progress-row"><span class="lab-panel__count">{{ run.total }} of {{ run.total }} tasks</span><span class="lab-panel__timer lab-panel__timer--dark">{{ formatDuration(result?.durationMs ?? run.elapsedMs) }}</span></div>
      <div class="bar bar--success"><div class="bar__fill" style="width: 100%" /></div>
      <div v-if="result" class="lab-complete__result">Lab Result &nbsp;·&nbsp; Duration {{ formatDuration(result.durationMs) }} &nbsp;·&nbsp; Finished {{ formatClock(result.finishedAt) }} &nbsp;·&nbsp; <strong>{{ plural(result.hintsUsed, 'hint') }} · {{ plural(result.solutionsUsed, 'solution') }}</strong></div>
    </div>
    <div class="lab-complete__notes">
      <div class="lab-complete__notes-label">EXAM NOTES</div>
      <ol class="lab-complete__list">
        <li v-for="(t, i) in run.lab.tasks" :key="t.id" class="lab-complete__note"><span class="lab-complete__num">{{ i + 1 }}</span><span v-html="renderInline(t.examNote)" /></li>
      </ol>
    </div>
    <div class="lab-complete__actions">
      <RouterLink class="btn btn--primary btn--block" to="/">Back to Home</RouterLink>
      <button type="button" class="btn btn--secondary btn--block" @click="emit('restart')">Restart Lab</button>
      <button type="button" class="btn btn--disabled btn--block lab-complete__next" disabled>
        <span>Next Lab: {{ nextLab?.title }}</span><span class="lab-complete__soon">Coming soon</span>
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: LabPanel.vue** (artboard 2, lines 200–224)

```vue
<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { skillAreaById } from '../../data/skillAreas.js'
import { SERVICES } from '../../data/services.js'
import { formatDuration } from '../../lib/format.js'
import FluentIcon from '../icons/FluentIcon.vue'
import TaskRow from './TaskRow.vue'
import LabCompletePanel from './LabCompletePanel.vue'

const run = useLabRunStore()
const portal = usePortalStore()
const briefOpen = ref(true)
const menuOpen = ref(false)
const openNotes = ref(new Set())
const area = computed(() => skillAreaById(run.lab.skillAreaId))
const service = computed(() => SERVICES[run.lab.service])
const pct = computed(() => (run.total ? (run.doneCount / run.total) * 100 : 0))

// When a Task ticks, open its Exam Note and collapse the others (design shows one open).
watch(() => run.taskStates.map((t) => t.done).join(','), (now, before) => {
  const nowArr = now.split(','), beforeArr = (before ?? '').split(',')
  const justDone = run.taskStates.filter((t, i) => nowArr[i] === 'true' && beforeArr[i] !== 'true')
  if (justDone.length) openNotes.value = new Set([justDone[justDone.length - 1].id])
})

function toggleNote(id) {
  const s = new Set(openNotes.value)
  s.has(id) ? s.delete(id) : s.add(id)
  openNotes.value = s
}
function stateOf(t) { return t.done ? 'done' : t.id === run.currentTaskId ? 'current' : 'pending' }
function restart() {
  menuOpen.value = false
  if (window.confirm('Restart this Lab? The Sandbox and the Cloud Shell history will be reset. Past Lab Results are kept.')) {
    run.restart()
    openNotes.value = new Set()
  }
}
</script>

<template>
  <aside class="lab-panel" :class="{ 'lab-panel--collapsed': portal.labPanelCollapsed }" aria-label="Lab Panel">
    <template v-if="portal.labPanelCollapsed">
      <button type="button" class="lab-panel__expand" aria-label="Expand Lab Panel" @click="portal.toggleLabPanel()"><FluentIcon name="chevron-right" :size="14" /></button>
      <div class="lab-panel__rail-label">Lab · {{ run.doneCount }}/{{ run.total }}</div>
    </template>
    <LabCompletePanel v-else-if="run.isComplete" @restart="restart" />
    <template v-else>
      <div class="lab-panel__header">
        <div class="lab-panel__title-row">
          <div class="lab-panel__title">{{ run.lab.title }}</div>
          <div class="lab-panel__menu-wrap">
            <button type="button" class="lab-panel__more" aria-label="Lab options" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><FluentIcon name="more-horizontal" :size="16" /></button>
            <div v-if="menuOpen" class="lab-panel__menu" role="menu">
              <button type="button" role="menuitem" @click="restart">Restart Lab</button>
              <button type="button" role="menuitem" @click="menuOpen = false; portal.toggleLabPanel()">Collapse panel</button>
            </div>
          </div>
        </div>
        <div class="lab-panel__chips">
          <span class="pill pill--accent pill--small">{{ area.name }} ({{ area.weight }})</span>
          <span class="pill pill--muted pill--small">{{ service.label }}</span>
        </div>
        <div class="lab-panel__progress-row"><span class="lab-panel__count">{{ run.doneCount }} of {{ run.total }} tasks</span><span class="lab-panel__timer">{{ formatDuration(run.elapsedMs) }} elapsed</span></div>
        <div class="bar"><div class="bar__fill" :style="{ width: pct + '%' }" /></div>
      </div>
      <div class="lab-panel__brief">
        <button type="button" class="lab-panel__brief-toggle" :aria-expanded="briefOpen" @click="briefOpen = !briefOpen">BRIEF <FluentIcon :name="briefOpen ? 'chevron-up' : 'chevron-down'" :size="10" /></button>
        <p v-if="briefOpen" class="lab-panel__brief-text">{{ run.lab.brief }}</p>
      </div>
      <ol class="lab-panel__tasks">
        <TaskRow v-for="t in run.taskStates" :key="t.id" :task="t" :state="stateOf(t)" :hints-revealed="run.hintsRevealed[t.id] ?? 0" :solution-revealed="!!run.solutionsRevealed[t.id]" :exam-note-open="openNotes.has(t.id)" @toggle-exam-note="toggleNote(t.id)" @reveal-hint="run.revealHint(t.id)" @reveal-solution="run.revealSolution(t.id)" />
      </ol>
      <div class="lab-panel__footer"><button type="button" class="btn btn--secondary" @click="restart">Restart Lab</button></div>
    </template>
  </aside>
</template>
```

- [ ] **Step 5: LabPage.vue**

```vue
<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLabRunStore } from '../stores/labRun.js'
import { usePortalStore } from '../stores/portal.js'
import { labById } from '../data/labs/index.js'
import BladeHost from '../components/blade/BladeHost.vue'
import CloudShell from '../components/shell/CloudShell.vue'
import LabPanel from '../components/lab/LabPanel.vue'

const props = defineProps({ labId: { type: String, required: true } })
const router = useRouter()
const run = useLabRunStore()
const portal = usePortalStore()
let timer = null

function boot() {
  const lab = labById(props.labId)
  if (!lab || lab.status !== 'available') { router.replace('/'); return }
  run.load(props.labId)
  run.tick(Date.now())
  clearInterval(timer)
  timer = setInterval(() => run.tick(Date.now()), 1000)
}
function pause() { run.pauseTimer() }

onMounted(() => { boot(); window.addEventListener('beforeunload', pause) })
watch(() => props.labId, boot)
onBeforeUnmount(() => { clearInterval(timer); pause(); window.removeEventListener('beforeunload', pause) })
</script>

<template>
  <main v-if="run.lab" class="lab" @click="portal.closePanes()">
    <div class="lab__main">
      <div v-show="!portal.shell.maximized" class="lab__blade"><BladeHost /></div>
      <CloudShell v-if="portal.shell.visible" />
      <button v-else type="button" class="lab__shell-restore" @click="portal.openShell()">Open Cloud Shell</button>
    </div>
    <LabPanel />
  </main>
</template>
```

- [ ] **Step 6: Append Lab CSS** (values from artboards 2 and 3)

`src/styles/pages.css`:

```css
.lab { flex: 1; min-height: 0; display: flex; }
.lab__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lab__blade { flex: 1; min-height: 0; display: flex; background: var(--surface); }
.lab__shell-restore { align-self: flex-start; margin: 0 0 8px 24px; font-size: 12px; color: var(--accent); }
```

`src/styles/components.css`:

```css
/* ---- Lab Panel ---------------------------------------------------------- */
.lab-panel { width: var(--lab-panel-w); flex: none; background: var(--surface); border-left: 1px solid var(--border-strong); display: flex; flex-direction: column; min-height: 0; }
.lab-panel--collapsed { width: 36px; align-items: center; padding-top: 8px; gap: 12px; }
.lab-panel__expand { display: inline-flex; color: var(--text-dim); padding: 4px; }
.lab-panel__rail-label { writing-mode: vertical-rl; font-size: 11.5px; font-weight: 600; color: var(--text-dim); }
.lab-panel__header { padding: 14px 16px; border-bottom: 1px solid var(--border); flex: none; }
.lab-panel__title-row { display: flex; align-items: flex-start; gap: 8px; }
.lab-panel__title { flex: 1; font-size: 14px; font-weight: 600; line-height: 1.35; }
.lab-panel__menu-wrap { position: relative; }
.lab-panel__more { display: inline-flex; color: var(--text-dim); }
.lab-panel__menu { position: absolute; right: 0; top: 22px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-toast); border-radius: 3px; min-width: 160px; z-index: 10; padding: 4px; }
.lab-panel__menu button { display: block; width: 100%; text-align: left; padding: 6px 10px; font-size: 12.5px; border-radius: 3px; }
.lab-panel__menu button:hover { background: var(--accent-soft); }
.lab-panel__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lab-panel__progress-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 10px; margin-bottom: 6px; }
.lab-panel__count { font-size: 12px; font-weight: 600; }
.lab-panel__timer { font: 500 12px var(--font-mono); color: var(--text-dim); }
.lab-panel__timer--dark { color: var(--text-2); }
.lab-panel__brief { padding: 10px 16px; border-bottom: 1px solid var(--border); flex: none; }
.lab-panel__brief-toggle { display: flex; width: 100%; justify-content: space-between; align-items: center; font-size: 11.5px; font-weight: 600; color: var(--text-dim); }
.lab-panel__brief-text { font-size: 12px; line-height: 1.5; color: var(--text-2); margin: 5px 0 0; }
.lab-panel__tasks { flex: 1; min-height: 0; overflow: auto; list-style: none; margin: 0; padding: 4px 0; }
.lab-panel__footer { padding: 10px 16px; border-top: 1px solid var(--border); flex: none; }

/* Tasks */
.task { padding: 8px 16px; }
.task--current { background: var(--row-bg); box-shadow: inset 3px 0 0 var(--accent); padding: 10px 16px; margin-top: 2px; }
.task--pending { padding: 10px 16px; }
.task__row { display: flex; gap: 10px; }
.task__mark { width: 17px; height: 17px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
.task__mark--done { background: var(--success); color: #fff; }
.task__mark--current { border: 2px solid var(--accent); color: var(--accent); font-size: 9.5px; font-weight: 700; }
.task__mark--pending { width: 16px; height: 16px; border: 1.5px solid var(--border-input); }
.task__text { font-size: 12.5px; line-height: 1.4; }
.task--done .task__text, .task--pending .task__text { color: var(--text-dim); }
.task--current .task__text { font-weight: 500; color: var(--text); }
.task--current .task__text code { background: var(--accent-soft-2); }
.task__note-toggle { font-size: 11px; color: var(--text-faint); white-space: nowrap; margin-left: 4px; display: inline-flex; align-items: center; gap: 2px; }
.task__indent { margin: 8px 0 0 27px; }
.task__actions { display: flex; align-items: center; gap: 14px; margin: 10px 0 2px 27px; }
.task__hint-link { font-size: 12px; font-weight: 600; color: var(--accent); }
.task__solution-btn { font-size: 11.5px; color: var(--text-2); border: 1px solid var(--border-input); border-radius: 3px; padding: 3px 10px; background: var(--surface); }
.task__solution-btn:hover { background: var(--chip-bg); }

.exam-note { background: var(--success-soft); border-radius: var(--radius-m); padding: 8px 10px; }
.exam-note__label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; color: var(--success); }
.exam-note__text { font-size: 11.5px; line-height: 1.45; color: var(--text); margin-top: 3px; }
.exam-note__text code, .hint-box__text code { font-size: 10.5px; padding: 0 3px; }
.hint-box { background: var(--surface); border: 1px solid var(--border-hint); border-radius: var(--radius-m); padding: 8px 10px; }
.hint-box__label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; color: var(--text-dim); }
.hint-box__text { font-size: 11.5px; line-height: 1.45; color: var(--text-2); margin-top: 3px; }
.solution { background: var(--surface); border: 1px solid var(--border-hint); border-radius: var(--radius-m); padding: 8px 10px; }
.solution__head { display: flex; justify-content: space-between; align-items: center; }
.solution__label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; color: var(--text-dim); }
.solution__copy { font-size: 11px; color: var(--accent); font-weight: 600; }
.solution__code { margin: 4px 0 0; font: 10.5px/1.5 var(--font-mono); white-space: pre-wrap; word-break: break-all; color: var(--text); }

/* Lab complete */
.lab-complete { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.lab-complete__header { padding: 16px; background: var(--success-bg); border-bottom: 1px solid var(--success-border); flex: none; }
.lab-complete__title-row { display: flex; align-items: center; gap: 8px; }
.lab-complete__check { width: 20px; height: 20px; border-radius: 50%; background: var(--success); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.lab-complete__title { font-size: 15px; font-weight: 700; color: var(--success-text); }
.lab-complete__lab { font-size: 12px; color: var(--text-2); margin-top: 4px; }
.lab-complete__result { font-size: 11.5px; color: var(--text-2); margin-top: 10px; }
.lab-complete__notes { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; }
.lab-complete__notes-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.5px; color: var(--text-dim); }
.lab-complete__list { list-style: none; margin: 0; padding: 0; }
.lab-complete__note { display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border-faint); font-size: 11.5px; line-height: 1.45; color: var(--text-2); }
.lab-complete__note:last-child { border-bottom: 0; }
.lab-complete__num { font: 700 11px var(--font-mono); color: var(--success); width: 12px; flex: none; }
.lab-complete__actions { padding: 12px 16px; border-top: 1px solid var(--border); flex: none; display: flex; flex-direction: column; gap: 8px; }
.lab-complete__next { flex-direction: column; gap: 2px; font-size: 12.5px; }
.lab-complete__soon { font-size: 10.5px; font-weight: 500; }
```

- [ ] **Step 7: Run everything and walk the Lab**

`npx vitest run` → green. `npm run build` → OK. `npm run dev` and at 1440×900:
1. Home → Start. Blade shows "Resource groups" with the empty state; shell focused; Lab Panel shows 0 of 5, Task 1 current.
2. Type `az group create --name rg-orders --location westeurope` → spinner ~0.8 s → JSON → Task 1 ticks, Exam Note 1 opens, Blade jumps to rg-orders, bell badge 1.
3. Type `az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Standard` → ~2.5 s spinner → namespace Blade (Queues (0) | Topics (0)).
4. Type `az servicebus topic create --name order-events` → red `ERROR: the following arguments are required: --namespace-name, --resource-group/-g`.
5. Queue command from the Lab (Task 3) → Queues (1) row `orders` … Active 1 GB 0 0 0. Show hint 1 on Task 4 → matches artboard 2.
6. Topic, subscription, rule create, `$Default` delete → Task 5 ticks → panel turns into Lab complete with Exam Notes 1–5, toast top-right left of the panel, bell badge increments.
7. Reload → resumes (scrollback and complete state). Restart Lab → confirm → fresh Sandbox, Blade back to Resource groups. Back to Home → Lab card "Completed", Skill Area card 1/3.
8. Header Cloud Shell icon hides/shows the dock; minimize/maximize buttons; ArrowUp recalls history; Ctrl+L clears.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(lab): Lab Panel with live Tasks, Hints, Solutions, Exam Notes, Lab complete state and the Lab page layout"
```

---

### Task 14: Verification against the design, polish, README

**Files:**
- Create: `README.md`
- Modify: whatever the visual comparison requires (CSS only unless a bug is found)

- [ ] **Step 1: Automated checks**

```bash
npx vitest run
npm run build
```
Both must pass with zero warnings about missing icons (`fluentIcon('…')` returning '' shows as an empty box; grep the components for every `name="…"` and confirm each exists in `src/assets/icons/fluent/` or `azure/`).

- [ ] **Step 2: Visual comparison**

With `npm run dev` running, use the Playwright or Chrome DevTools MCP tools (or a manual browser) at exactly 1440×900:
- Screenshot Home; compare with artboard 1 (design lines 22–88): header heights/colours, tile spacing (6px gap, 96px tiles), card grid gaps 16px, button size.
- Drive the Lab to the artboard-2 state (Tasks 1–3 done, Task 4 current with Hint 1 shown, the failed topic command in the shell) and screenshot; compare with lines 103–226.
- Complete the Lab and screenshot; compare with artboard 3 (lines 244–368): green header, result line, notes list, three buttons, toast position.
- Check the browser console: zero errors/warnings.
- Fix discrepancies in CSS (spacing, weights, colours) and re-check. Do not change behaviour to match static artwork where the artwork is inconsistent (e.g. the Functions card's Skill Area).

- [ ] **Step 3: README.md**

```markdown
# Azure-Trainer

Private, single-user demo: hands-on preparation for exam **AI-200** in a simulated Azure portal.
You complete Labs by typing `az` commands into the Cloud Shell; the portal Blades mirror the
simulated Sandbox and the Lab's Tasks tick live. No real Azure, no accounts, never published.

- Glossary: [CONTEXT.md](./CONTEXT.md) · Spec: [SPEC.md](./SPEC.md) · Decision: [ADR-0001](./docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md)
- Design: `docs/design/Azure-Trainer Screens.dc.html` (Claude Design export) · Brief: `docs/design-prompt.md`

## Run

```bash
npm install
npm run dev      # http://localhost:5175
npm test
npm run build
```

## What the Cloud Shell understands

`az` (banner), `az --version`, `az version`, `az login`, `az account show|list`,
`az configure --defaults group=<rg> location=<loc>` / `--list-defaults`,
`az group create|show|list|delete|exists`,
`az servicebus namespace create|show|list|update|delete|exists`,
`az servicebus queue create|show|list|update|delete`,
`az servicebus topic create|show|list|delete`,
`az servicebus topic subscription create|show|list|delete`,
`az servicebus topic subscription rule create|show|list|delete`, `clear`.
Every group and command answers `--help`. Output is az-shaped JSON; errors use az wording.

## Icons

Service icons are Microsoft's official Azure architecture icons (permitted for training
materials); control glyphs are Fluent UI System Icons (MIT). Both live under `src/assets/icons/`.

## Progress

Stored in `localStorage` (`at_results`, `at_run_<labId>`). Clear site data to reset everything.
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: README and visual polish after design comparison"
```

---

## Self-review (Part 3)

- Spec coverage: three Blades with focus rules and read-only command bar hints (Task 11); Cloud Shell features from the SPEC table: prompt, history, clear, spinner, minimize/maximize/close (Task 12); Lab Panel states, Hints/Solution/Exam Notes, completion with Lab Result, toast, Restart, collapse, timer resume (Task 13); verification and README (Task 14).
- ADR-0001: no component imports `ops.js`; command-bar buttons only display a read-only hint; `BladeHost` renders from `labRun.sandbox`.
- Type consistency: `TaskRow` receives `task` with `index` and `done` from `run.taskStates`; `resolveBlade` returns the same blade shapes `bladeForEvent` produces; scrollback `err` lines already carry the `ERROR: ` prefix (added in `labRun.execute`), so the terminal prints them verbatim.

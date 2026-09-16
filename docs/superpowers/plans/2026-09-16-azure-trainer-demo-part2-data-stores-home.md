# Azure-Trainer Demo Implementation Plan — Part 2: Data, Stores, Home (Tasks 8–10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Requires Part 1 (`2026-09-16-azure-trainer-demo-part1-engine.md`) to be complete. Part 3 (`…-part3-lab-ui.md`) follows.

**Goal / Architecture / Tech Stack / Spec / Global Constraints:** identical to Part 1 — read its header before starting any task here. Visual truth: `docs/design/Azure-Trainer Screens.dc.html` (artboard 1 = Home, lines 18–97 of that file).

**Interfaces consumed from Part 1:** `runLine(sandbox, line) → { sandbox, lines: [{ text, kind: 'out'|'err' }], events, latencyMs, clear }` (`src/lib/az/shell.js`); `createSandbox()` (`src/lib/sandbox/model.js`); `loadJSON/saveJSON/removeJSON` (`src/lib/storage.js`); `<FluentIcon name size />`, `<AzureIcon name size />`; CSS tokens in `src/styles/tokens.css`; events `{ type, resourceType, name, resourceGroup, namespace, topic, subscription }`.

---

### Task 8: Content data — Skill Areas, services, Lab catalog, the Service Bus Lab, inline-code helper

**Files:**
- Create: `src/data/skillAreas.js`, `src/data/services.js`, `src/data/labs/index.js`, `src/data/labs/servicebus-order-backend.lab.js`, `src/lib/inlineCode.js`
- Test: `tests/labs.test.js`, `tests/inline-code.test.js`

**Interfaces:**
- Produces:
  - `SKILL_AREAS: [{ id, name, weight }]`, `skillAreaById(id)`.
  - `SERVICES: { [key]: { label, icon, tint } }`, `HOME_SERVICES: string[]` (order of the Home tiles).
  - `LABS: Lab[]`, `labById(id)`, where `Lab = { id, title, skillAreaId, service, minutes, status: 'available'|'coming-soon', brief, seed(sandbox) → sandbox, tasks: Task[] }` and `Task = { id, text, check(sandbox) → boolean, hints: [string, string], solution: string, examNote: string }`.
  - `renderInline(text) → string` (HTML-escaped, backticks → `<code>`).

- [ ] **Step 1: Failing tests**

`tests/inline-code.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { renderInline } from '../src/lib/inlineCode.js'

describe('renderInline', () => {
  it('escapes HTML and converts backticks to <code>', () => {
    expect(renderInline('Create `rg-orders` in <West> & "Europe"')).toBe('Create <code>rg-orders</code> in &lt;West&gt; &amp; &quot;Europe&quot;')
  })
  it('handles code containing quotes and dollar signs', () => {
    expect(renderInline("filter `region = 'EU'` and `$Default`")).toBe("filter <code>region = &#39;EU&#39;</code> and <code>$Default</code>")
  })
  it('leaves unbalanced backticks alone', () => {
    expect(renderInline('a ` b')).toBe('a ` b')
  })
})
```

`tests/labs.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { LABS, labById } from '../src/data/labs/index.js'
import { SKILL_AREAS, skillAreaById } from '../src/data/skillAreas.js'
import { SERVICES, HOME_SERVICES } from '../src/data/services.js'

function apply(sb, solution) {
  for (const line of solution.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const r = runLine(sb, line)
    const errors = r.lines.filter((l) => l.kind === 'err')
    if (errors.length) throw new Error(`solution failed: ${line}\n${errors.map((e) => e.text).join('\n')}`)
    sb = r.sandbox
  }
  return sb
}

describe('catalog integrity', () => {
  it('every Lab references a real Skill Area and service, ids unique', () => {
    const ids = new Set()
    for (const lab of LABS) {
      expect(ids.has(lab.id)).toBe(false)
      ids.add(lab.id)
      expect(skillAreaById(lab.skillAreaId)).toBeTruthy()
      expect(SERVICES[lab.service]).toBeTruthy()
      expect(lab.minutes).toBeGreaterThan(0)
    }
    expect(SKILL_AREAS.map((a) => a.id)).toEqual(['containers', 'data', 'connect', 'secure'])
    expect(HOME_SERVICES.every((k) => SERVICES[k])).toBe(true)
  })
  it('exactly one Lab is available and it has 5 Tasks with 2 hints each', () => {
    const available = LABS.filter((l) => l.status === 'available')
    expect(available).toHaveLength(1)
    const lab = available[0]
    expect(lab.id).toBe('servicebus-order-backend')
    expect(lab.tasks).toHaveLength(5)
    for (const t of lab.tasks) {
      expect(t.hints).toHaveLength(2)
      expect(typeof t.check).toBe('function')
      expect(t.solution.length).toBeGreaterThan(0)
      expect(t.examNote.length).toBeGreaterThan(0)
    }
    expect(labById('nope')).toBeUndefined()
  })
})

describe('Service Bus Lab', () => {
  const lab = labById('servicebus-order-backend')

  it('seed is an empty Sandbox and no Task is done at start', () => {
    const sb = lab.seed(createSandbox())
    expect(sb.resourceGroups).toHaveLength(0)
    expect(lab.tasks.every((t) => t.check(sb) === false)).toBe(true)
  })

  it('applying each Solution in order ticks exactly that Task', () => {
    let sb = lab.seed(createSandbox())
    lab.tasks.forEach((task, i) => {
      expect(task.check(sb)).toBe(false)
      sb = apply(sb, task.solution)
      expect(task.check(sb)).toBe(true)
      expect(lab.tasks.slice(0, i + 1).every((t) => t.check(sb))).toBe(true)
      expect(lab.tasks.slice(i + 1).every((t) => !t.check(sb))).toBe(true)
    })
  })

  it('Tasks judge state, not commands: fixing a Basic namespace with update counts', () => {
    let sb = apply(lab.seed(createSandbox()), lab.tasks[0].solution)
    sb = runLine(sb, 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic').sandbox
    expect(lab.tasks[1].check(sb)).toBe(false)
    sb = runLine(sb, 'az servicebus namespace update -g rg-orders -n sb-contoso-orders --sku Standard').sandbox
    expect(lab.tasks[1].check(sb)).toBe(true)
  })

  it('queue Task needs both flags; subscription Task needs $Default removed', () => {
    let sb = apply(lab.seed(createSandbox()), lab.tasks[0].solution + '\n' + lab.tasks[1].solution)
    sb = runLine(sb, 'az servicebus queue create -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count 5').sandbox
    expect(lab.tasks[2].check(sb)).toBe(false)
    sb = runLine(sb, 'az servicebus queue update -g rg-orders --namespace-name sb-contoso-orders -n orders --enable-dead-lettering-on-message-expiration true').sandbox
    expect(lab.tasks[2].check(sb)).toBe(true)
    sb = apply(sb, lab.tasks[3].solution)
    sb = runLine(sb, 'az servicebus topic subscription create -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events -n eu-orders').sandbox
    sb = runLine(sb, `az servicebus topic subscription rule create -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders -n eu-filter --filter-sql-expression "region='EU'"`).sandbox
    expect(lab.tasks[4].check(sb)).toBe(false)
    sb = runLine(sb, `az servicebus topic subscription rule delete -g rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders -n '$Default'`).sandbox
    expect(lab.tasks[4].check(sb)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/inline-code.test.js tests/labs.test.js` → FAIL.

- [ ] **Step 3: Implement inlineCode.js, skillAreas.js, services.js**

`src/lib/inlineCode.js`:

```js
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c])
}

// Task/Hint/Exam Note text uses backticks for code. Output is safe to bind with v-html.
export function renderInline(text) {
  const parts = String(text).split('`')
  if (parts.length % 2 === 0) return escapeHtml(text)
  return parts.map((p, i) => (i % 2 === 1 ? `<code>${escapeHtml(p)}</code>` : escapeHtml(p))).join('')
}
```

`src/data/skillAreas.js`:

```js
// The four Skill Areas of the official AI-200 "skills measured" outline, named verbatim.
export const SKILL_AREAS = [
  { id: 'containers', name: 'Develop containerized solutions on Azure', weight: '20–25%' },
  { id: 'data', name: 'Develop AI solutions by using Azure data management services', weight: '25–30%' },
  { id: 'connect', name: 'Connect to and consume Azure services', weight: '20–25%' },
  { id: 'secure', name: 'Secure, monitor, and troubleshoot Azure solutions', weight: '20–25%' },
]

export function skillAreaById(id) {
  return SKILL_AREAS.find((a) => a.id === id)
}
```

`src/data/services.js`:

```js
// Azure services shown in the Portal. `icon` is a key of src/lib/icons.js AZURE_ICONS.
export const SERVICES = {
  'service-bus': { label: 'Service Bus', icon: 'service-bus', tint: 'var(--tint-blue)' },
  'container-apps': { label: 'Container Apps', icon: 'container-apps', tint: 'var(--tint-teal)' },
  'cosmos-db': { label: 'Cosmos DB', icon: 'cosmos-db', tint: 'var(--tint-purple)' },
  'key-vault': { label: 'Key Vault', icon: 'key-vault', tint: 'var(--tint-amber)' },
  functions: { label: 'Functions', icon: 'functions', tint: 'var(--tint-violet)' },
  postgresql: { label: 'Azure Database for PostgreSQL', icon: 'postgresql', tint: 'var(--tint-steel)' },
  'managed-redis': { label: 'Managed Redis', icon: 'managed-redis', tint: 'var(--tint-red)' },
  'container-registry': { label: 'Container Registry', icon: 'container-registry', tint: 'var(--tint-slate)' },
  'event-grid': { label: 'Event Grid', icon: 'event-grid', tint: 'var(--tint-teal)' },
}

export const HOME_SERVICES = ['service-bus', 'container-apps', 'cosmos-db', 'key-vault', 'functions', 'postgresql', 'managed-redis', 'container-registry']
```

- [ ] **Step 4: Implement the Lab and the catalog**

`src/data/labs/servicebus-order-backend.lab.js` (copy strings verbatim; they are the design's content):

```js
const RG = 'rg-orders'
const NS = 'sb-contoso-orders'

function namespace(sb) {
  return sb.namespaces.find((n) => n.name === NS && n.resourceGroup === RG)
}

export const servicebusOrderBackendLab = {
  id: 'servicebus-order-backend',
  title: 'Order-processing backend on Service Bus',
  skillAreaId: 'connect',
  service: 'service-bus',
  minutes: 50,
  status: 'available',
  brief:
    "Contoso's order API must hand each order to a background processor without losing messages, and fan out order events to regional fulfilment systems. Build the messaging backbone on Azure Service Bus.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-orders` in West Europe.',
      check: (sb) => sb.resourceGroups.some((g) => g.name === RG && g.location === 'westeurope'),
      hints: [
        'Resource groups live under `az group`. Every resource you create later needs one.',
        'Two arguments: `--name` (or `-n`) and `--location` (or `-l`). The region code for West Europe is `westeurope`.',
      ],
      solution: 'az group create --name rg-orders --location westeurope',
      examNote:
        'Every az command that creates an entity needs `--resource-group`; set a default with `az configure --defaults group=rg-orders` to stop repeating it.',
    },
    {
      id: 'namespace',
      text: 'Create a Service Bus namespace `sb-contoso-orders` in `rg-orders` on the Standard tier.',
      check: (sb) => namespace(sb)?.sku === 'Standard',
      hints: [
        'The namespace is the container for queues and topics: `az servicebus namespace create`. Check the tier options with `--help`.',
        '`az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders --sku Standard`. Namespace creation takes a moment.',
      ],
      solution: 'az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders --sku Standard',
      examNote: 'Topics and subscriptions require Standard or Premium. Basic has queues only.',
    },
    {
      id: 'queue',
      text: 'Create a queue named `orders` with max delivery count 5 and dead-lettering on message expiration enabled.',
      check: (sb) => {
        const q = namespace(sb)?.queues.find((x) => x.name === 'orders')
        return !!q && q.maxDeliveryCount === 5 && q.deadLetteringOnMessageExpiration === true
      },
      hints: [
        'Both settings are queue properties; look at `az servicebus queue create --help` for the delivery and dead-letter flags.',
        'Add `--max-delivery-count 5` and `--enable-dead-lettering-on-message-expiration true` to `az servicebus queue create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders`.',
      ],
      solution:
        'az servicebus queue create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true',
      examNote:
        'Max delivery count and dead-lettering on expiry are the two queue settings that route messages to the dead-letter sub-queue at `orders/$DeadLetterQueue`.',
    },
    {
      id: 'topic',
      text: 'Create a topic named `order-events`.',
      check: (sb) => !!namespace(sb)?.topics.find((t) => t.name === 'order-events'),
      hints: [
        'Entity commands always need `--namespace-name` and `--resource-group`; the topic itself needs only `--name`.',
        '`az servicebus topic create --resource-group rg-orders --namespace-name sb-contoso-orders --name order-events`',
      ],
      solution: 'az servicebus topic create --resource-group rg-orders --namespace-name sb-contoso-orders --name order-events',
      examNote: 'A topic has no consumers of its own; nothing is delivered until a subscription exists.',
    },
    {
      id: 'subscription',
      text: "Create a subscription `eu-orders` on `order-events` whose only rule is the SQL filter `region = 'EU'`.",
      check: (sb) => {
        const t = namespace(sb)?.topics.find((x) => x.name === 'order-events')
        const s = t?.subscriptions.find((x) => x.name === 'eu-orders')
        if (!s || s.rules.length !== 1) return false
        const [r] = s.rules
        return r.filterType === 'SqlFilter' && typeof r.sqlExpression === 'string' && r.sqlExpression.replace(/\s+/g, '') === "region='EU'"
      },
      hints: [
        'Subscriptions and their rules are nested under the topic: `az servicebus topic subscription create` and `az servicebus topic subscription rule create`. Then list the rules and look at what is already there.',
        "Create the rule with `--filter-sql-expression \"region = 'EU'\"`, then delete the `$Default` rule (quote it: `--name '$Default'`), otherwise it still matches everything.",
      ],
      solution: [
        'az servicebus topic subscription create --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --name eu-orders',
        `az servicebus topic subscription rule create --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`,
        "az servicebus topic subscription rule delete --resource-group rg-orders --namespace-name sb-contoso-orders --topic-name order-events --subscription-name eu-orders --name '$Default'",
      ].join('\n'),
      examNote: 'A new subscription gets a `$Default` rule that matches everything. A SQL filter only takes effect once `$Default` is removed.',
    },
  ],
}
```

`src/data/labs/index.js`:

```js
import { servicebusOrderBackendLab } from './servicebus-order-backend.lab.js'

const comingSoon = (id, title, skillAreaId, service, minutes) => ({ id, title, skillAreaId, service, minutes, status: 'coming-soon', brief: '', seed: (sb) => sb, tasks: [] })

// Catalog order = Home card order (design artboard 1).
export const LABS = [
  servicebusOrderBackendLab,
  comingSoon('containerapps-keda', 'Deploy a Container App with KEDA scaling', 'containers', 'container-apps', 40),
  comingSoon('cosmos-vector-search', 'Cosmos DB container with vector search', 'data', 'cosmos-db', 45),
  comingSoon('keyvault-secrets', 'Store and rotate secrets in Key Vault', 'secure', 'key-vault', 30),
  comingSoon('functions-serverless-api', 'Serverless API with Azure Functions', 'connect', 'functions', 40),
  comingSoon('eventgrid-filtered-subscription', 'Event Grid custom topic with filtered subscription', 'connect', 'event-grid', 35),
]

export function labById(id) {
  return LABS.find((l) => l.id === id)
}

export function labsForSkillArea(skillAreaId) {
  return LABS.filter((l) => l.skillAreaId === skillAreaId)
}
```

Note: the design card for "Serverless API with Azure Functions" says "Develop AI solutions by using Azure data management services"; per the official AI-200 outline Functions sits under "Connect to and consume Azure services", so the catalog uses `connect`. Counts on Home are computed from data.

- [ ] **Step 5: Run tests**

`npx vitest run tests/inline-code.test.js tests/labs.test.js` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(data): Skill Areas, services, Lab catalog and the Service Bus order-backend Lab"
```

---

### Task 9: Pinia stores — progress (Lab Results), labRun (active Lab), portal (UI state)

**Files:**
- Create: `src/stores/progress.js`, `src/stores/labRun.js`, `src/stores/portal.js`, `src/lib/format.js`
- Test: `tests/progress-store.test.js`, `tests/lab-run-store.test.js`, `tests/portal-store.test.js`, `tests/format.test.js`

**Interfaces:**
- Produces:
  - `formatDuration(ms) → 'MM:SS'` (hours as `H:MM:SS`), `formatClock(iso) → 'HH:MM'`, `relativeTime(iso, now) → 'just now' | 'n min ago' | 'n h ago'`.
  - `useProgressStore`: state `results`; getters `resultsForLab(labId)`, `latestResult(labId)`; actions `addResult(result)`, `runSummary(labId) → { tasksDone, total, completedAt } | null` (reads `at_run_<labId>`), `labStatus(labId) → 'not-started'|'in-progress'|'completed'`, `skillAreaProgress(skillAreaId) → { total, completed, inProgress }`, `resetAll()`.
  - `useLabRunStore`: state `{ labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, lastTickAt, completedAt, resultId, running }`; getters `lab`, `taskStates: [{ ...task, done, index }]`, `currentTaskId`, `doneCount`, `total`, `isComplete`, `hintsUsed`, `solutionsUsed`; actions `load(labId)`, `start(labId)`, `execute(line, { sleep })`, `revealHint(taskId)`, `revealSolution(taskId)`, `tick(nowMs)`, `pauseTimer()`, `clearScrollback()`, `restart()`, `persist()`.
  - `usePortalStore`: state `{ notifications: [{ id, title, text, at }], unread, notificationsOpen, menuOpen, toast: { title, text } | null, shell: { visible, minimized, maximized }, labPanelCollapsed, blade }`; actions `notify(title, text)`, `toggleNotifications()`, `closePanes()`, `showToast(title, text)`, `dismissToast()`, `toggleShell()`, `openShell()`, `closeShell()`, `toggleShellMinimized()`, `toggleShellMaximized()`, `toggleLabPanel()`, `showBlade(blade)`, `applyEvent(event)`, `resetForLab()`; helper export `bladeForEvent(event, currentBlade) → blade`, `notificationForEvent(event) → { title, text }`.
  - Storage keys: `at_results`, `at_run_<labId>`.

- [ ] **Step 1: Failing tests**

`tests/format.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { formatDuration, formatClock, relativeTime } from '../src/lib/format.js'

describe('format', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(492000)).toBe('08:12')
    expect(formatDuration(877000)).toBe('14:37')
    expect(formatDuration(3723000)).toBe('1:02:03')
  })
  it('formatClock uses local HH:MM', () => {
    const d = new Date(2026, 8, 16, 16, 42)
    expect(formatClock(d.toISOString())).toBe('16:42')
  })
  it('relativeTime', () => {
    const now = Date.parse('2026-09-16T16:42:00Z')
    expect(relativeTime('2026-09-16T16:41:40Z', now)).toBe('just now')
    expect(relativeTime('2026-09-16T16:30:00Z', now)).toBe('12 min ago')
    expect(relativeTime('2026-09-16T13:42:00Z', now)).toBe('3 h ago')
  })
})
```

`tests/progress-store.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './storage.test.js'

describe('progress store', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('starts empty and persists results', () => {
    const p = useProgressStore()
    expect(p.results).toEqual([])
    p.addResult({ id: 'r1', labId: 'servicebus-order-backend', tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 0, durationMs: 877000, finishedAt: '2026-09-16T14:42:00.000Z' })
    expect(JSON.parse(localStorage.getItem('at_results'))).toHaveLength(1)
    expect(p.latestResult('servicebus-order-backend').id).toBe('r1')
    expect(p.latestResult('nope')).toBeNull()
  })

  it('labStatus derives from run + results', () => {
    const p = useProgressStore()
    expect(p.labStatus('servicebus-order-backend')).toBe('not-started')
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: null, sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.labStatus('servicebus-order-backend')).toBe('in-progress')
    expect(p.runSummary('servicebus-order-backend')).toEqual({ tasksDone: 0, total: 5, completedAt: null })
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: '2026-09-16T14:42:00.000Z', sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.labStatus('servicebus-order-backend')).toBe('completed')
  })

  it('skillAreaProgress counts labs', () => {
    const p = useProgressStore()
    expect(p.skillAreaProgress('connect')).toEqual({ total: 3, completed: 0, inProgress: 0 })
    localStorage.setItem('at_run_servicebus-order-backend', JSON.stringify({ labId: 'servicebus-order-backend', completedAt: null, sandbox: { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } } }))
    expect(p.skillAreaProgress('connect')).toEqual({ total: 3, completed: 0, inProgress: 1 })
    expect(p.skillAreaProgress('containers')).toEqual({ total: 1, completed: 0, inProgress: 0 })
  })
})
```

`tests/portal-store.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePortalStore, bladeForEvent, notificationForEvent } from '../src/stores/portal.js'

const LIST = { kind: 'resource-groups' }
const NS = { kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders', tab: 'queues' }

describe('bladeForEvent', () => {
  it('follows creations', () => {
    expect(bladeForEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }, LIST)).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(bladeForEvent({ type: 'created', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }, LIST)).toEqual(NS)
    expect(bladeForEvent({ type: 'created', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, LIST)).toEqual(NS)
    expect(bladeForEvent({ type: 'created', resourceType: 'topic', name: 't', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, LIST)).toEqual({ ...NS, tab: 'topics' })
    expect(bladeForEvent({ type: 'created', resourceType: 'rule', name: 'r', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 't', subscription: 's' }, LIST)).toEqual({ ...NS, tab: 'topics' })
  })
  it('falls back to the parent on deletion of the focused resource', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }, NS)).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(bladeForEvent({ type: 'deleted', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }, NS)).toEqual(LIST)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, NS)).toEqual(NS)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'namespace', name: 'other', resourceGroup: 'rg-orders' }, NS)).toEqual(NS)
  })
})

describe('notificationForEvent', () => {
  it('phrases events', () => {
    expect(notificationForEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders' })).toEqual({ title: 'Deployment succeeded', text: "Created resource group 'rg-orders'." })
    expect(notificationForEvent({ type: 'created', resourceType: 'queue', name: 'orders', namespace: 'sb-contoso-orders' })).toEqual({ title: 'Deployment succeeded', text: "Created queue 'orders' in sb-contoso-orders." })
    expect(notificationForEvent({ type: 'updated', resourceType: 'namespace', name: 'sb-contoso-orders' })).toEqual({ title: 'Update succeeded', text: "Updated Service Bus namespace 'sb-contoso-orders'." })
    expect(notificationForEvent({ type: 'deleted', resourceType: 'rule', name: '$Default', subscription: 'eu-orders' })).toEqual({ title: 'Deleted', text: "Deleted rule '$Default' on eu-orders." })
  })
})

describe('portal store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('notifications and unread count', () => {
    const p = usePortalStore()
    p.notify('Deployment succeeded', "Created resource group 'rg-orders'.")
    expect(p.notifications).toHaveLength(1)
    expect(p.unread).toBe(1)
    p.toggleNotifications()
    expect(p.notificationsOpen).toBe(true)
    expect(p.unread).toBe(0)
  })
  it('shell state machine', () => {
    const p = usePortalStore()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: false })
    p.toggleShellMinimized()
    expect(p.shell.minimized).toBe(true)
    p.toggleShellMaximized()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: true })
    p.closeShell()
    expect(p.shell.visible).toBe(false)
    p.toggleShell()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: false })
  })
  it('applyEvent updates blade and notifies; resetForLab restores defaults', () => {
    const p = usePortalStore()
    p.applyEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' })
    expect(p.blade).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(p.notifications).toHaveLength(1)
    p.showToast('Lab completed', 'x')
    p.resetForLab()
    expect(p.blade).toEqual({ kind: 'resource-groups' })
    expect(p.toast).toBeNull()
  })
})
```

`tests/lab-run-store.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { usePortalStore } from '../src/stores/portal.js'
import { fakeLocalStorage } from './storage.test.js'

const LAB = 'servicebus-order-backend'
const noSleep = () => Promise.resolve()
const opts = { sleep: noSleep }

describe('labRun store', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('start seeds a run and persists it', () => {
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.labId).toBe(LAB)
    expect(run.lab.title).toBe('Order-processing backend on Service Bus')
    expect(run.total).toBe(5)
    expect(run.doneCount).toBe(0)
    expect(run.currentTaskId).toBe('resource-group')
    expect(JSON.parse(localStorage.getItem(`at_run_${LAB}`)).labId).toBe(LAB)
  })

  it('execute echoes the command, appends output, ticks Tasks, notifies, focuses Blade', async () => {
    const run = useLabRunStore()
    const portal = usePortalStore()
    run.load(LAB)
    await run.execute('az group create -n rg-orders -l westeurope', opts)
    expect(run.scrollback[0]).toEqual({ kind: 'cmd', text: 'az group create -n rg-orders -l westeurope' })
    expect(run.scrollback[1].kind).toBe('out')
    expect(run.scrollback[1].text).toContain('"name": "rg-orders"')
    expect(run.taskStates[0].done).toBe(true)
    expect(run.doneCount).toBe(1)
    expect(run.currentTaskId).toBe('namespace')
    expect(run.history).toEqual(['az group create -n rg-orders -l westeurope'])
    expect(portal.blade).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(portal.notifications[0].text).toBe("Created resource group 'rg-orders'.")
    expect(run.running).toBe(false)
  })

  it('errors go to scrollback as err and do not change the Sandbox', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    await run.execute('az servicebus topic create --name order-events', opts)
    expect(run.scrollback[1]).toEqual({ kind: 'err', text: 'ERROR: the following arguments are required: --namespace-name, --resource-group/-g' })
    expect(run.sandbox.resourceGroups).toHaveLength(0)
  })

  it('clear empties the scrollback; blank lines only echo the prompt', async () => {
    const run = useLabRunStore()
    run.load(LAB)
    await run.execute('az account show', opts)
    await run.execute('clear', opts)
    expect(run.scrollback).toEqual([])
    await run.execute('', opts)
    expect(run.scrollback).toEqual([{ kind: 'cmd', text: '' }])
    expect(run.history).toEqual(['az account show'])
  })

  it('hints/solutions are recorded; timer ticks and pauses', () => {
    const run = useLabRunStore()
    run.load(LAB)
    run.revealHint('topic')
    run.revealHint('topic')
    run.revealHint('topic')
    expect(run.hintsRevealed.topic).toBe(2)
    expect(run.hintsUsed).toBe(2)
    run.revealSolution('topic')
    expect(run.solutionsUsed).toBe(1)
    run.tick(1000)
    run.tick(6000)
    expect(run.elapsedMs).toBe(5000)
    run.pauseTimer()
    run.tick(20000)
    expect(run.elapsedMs).toBe(5000)
    run.tick(21000)
    expect(run.elapsedMs).toBe(6000)
  })

  it('reload resumes from storage', async () => {
    let run = useLabRunStore()
    run.load(LAB)
    await run.execute('az group create -n rg-orders -l westeurope', opts)
    setActivePinia(createPinia())
    run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(1)
    expect(run.scrollback).toHaveLength(2)
  })

  it('completing all Tasks writes a Lab Result once, notifies and toasts; restart resets but keeps the result', async () => {
    const run = useLabRunStore()
    const progress = useProgressStore()
    const portal = usePortalStore()
    run.load(LAB)
    run.revealHint('topic')
    for (const t of run.lab.tasks) for (const line of t.solution.split('\n')) await run.execute(line, opts)
    expect(run.isComplete).toBe(true)
    expect(run.completedAt).toBeTruthy()
    expect(progress.results).toHaveLength(1)
    expect(progress.results[0]).toMatchObject({ labId: LAB, tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 0 })
    expect(portal.toast).toEqual({ title: 'Lab completed', text: 'Order-processing backend on Service Bus' })
    expect(portal.notifications.at(-1).title).toBe('Lab completed')
    await run.execute('az account show', opts)
    expect(progress.results).toHaveLength(1)
    run.restart()
    expect(run.doneCount).toBe(0)
    expect(run.scrollback).toEqual([])
    expect(run.completedAt).toBeNull()
    expect(run.elapsedMs).toBe(0)
    expect(progress.results).toHaveLength(1)
    expect(portal.blade).toEqual({ kind: 'resource-groups' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/format.test.js tests/progress-store.test.js tests/portal-store.test.js tests/lab-run-store.test.js` → FAIL.

- [ ] **Step 3: Implement `src/lib/format.js`**

```js
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatClock(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function relativeTime(iso, now = Date.now()) {
  const diff = Math.max(0, now - Date.parse(iso))
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ago`
}
```

- [ ] **Step 4: Implement `src/stores/progress.js`**

```js
import { defineStore } from 'pinia'
import { loadJSON, saveJSON, removeJSON } from '../lib/storage.js'
import { LABS, labById } from '../data/labs/index.js'

export const RESULTS_KEY = 'at_results'
export const runKey = (labId) => `at_run_${labId}`

export const useProgressStore = defineStore('progress', {
  state: () => ({ results: loadJSON(RESULTS_KEY, []) }),
  getters: {
    resultsForLab: (s) => (labId) => s.results.filter((r) => r.labId === labId),
    latestResult: (s) => (labId) => {
      const list = s.results.filter((r) => r.labId === labId)
      return list.length ? list[list.length - 1] : null
    },
  },
  actions: {
    addResult(result) {
      this.results.push(result)
      saveJSON(RESULTS_KEY, this.results)
    },
    // Reads the persisted run (if any) and derives the Task count from the Lab definition.
    runSummary(labId) {
      const run = loadJSON(runKey(labId), null)
      const lab = labById(labId)
      if (!run || !lab) return null
      const tasksDone = lab.tasks.filter((t) => t.check(run.sandbox)).length
      return { tasksDone, total: lab.tasks.length, completedAt: run.completedAt ?? null }
    },
    labStatus(labId) {
      const run = this.runSummary(labId)
      if (run && !run.completedAt) return 'in-progress'
      if (run?.completedAt || this.results.some((r) => r.labId === labId)) return 'completed'
      return 'not-started'
    },
    skillAreaProgress(skillAreaId) {
      const labs = LABS.filter((l) => l.skillAreaId === skillAreaId)
      const statuses = labs.map((l) => this.labStatus(l.id))
      return { total: labs.length, completed: statuses.filter((s) => s === 'completed').length, inProgress: statuses.filter((s) => s === 'in-progress').length }
    },
    resetAll() {
      this.results = []
      removeJSON(RESULTS_KEY)
      for (const l of LABS) removeJSON(runKey(l.id))
    },
  },
})
```

- [ ] **Step 5: Implement `src/stores/portal.js`**

```js
import { defineStore } from 'pinia'

export const DEFAULT_BLADE = { kind: 'resource-groups' }

const TYPE_LABEL = { resourceGroup: 'resource group', namespace: 'Service Bus namespace', queue: 'queue', topic: 'topic', subscription: 'subscription', rule: 'rule' }
const VERB = { created: 'Created', updated: 'Updated', deleted: 'Deleted' }
const TITLE = { created: 'Deployment succeeded', updated: 'Update succeeded', deleted: 'Deleted' }

export function notificationForEvent(e) {
  let where = ''
  if (e.resourceType === 'queue' || e.resourceType === 'topic') where = ` in ${e.namespace}`
  else if (e.resourceType === 'subscription') where = ` on ${e.topic}`
  else if (e.resourceType === 'rule') where = ` on ${e.subscription}`
  return { title: TITLE[e.type], text: `${VERB[e.type]} ${TYPE_LABEL[e.resourceType]} '${e.name}'${where}.` }
}

function namespaceBlade(e, tab) {
  return { kind: 'servicebus-namespace', resourceGroup: e.resourceGroup, name: e.namespace ?? e.name, tab }
}

export function bladeForEvent(e, current) {
  if (e.type === 'created' || e.type === 'updated') {
    switch (e.resourceType) {
      case 'resourceGroup': return { kind: 'resource-group', name: e.name }
      case 'namespace': return namespaceBlade(e, 'queues')
      case 'queue': return namespaceBlade(e, 'queues')
      default: return namespaceBlade(e, 'topics')
    }
  }
  // deleted
  if (e.resourceType === 'resourceGroup') {
    const affected = (current.kind === 'resource-group' && current.name === e.name) || (current.kind === 'servicebus-namespace' && current.resourceGroup === e.name)
    return affected ? DEFAULT_BLADE : current
  }
  if (e.resourceType === 'namespace') {
    const affected = current.kind === 'servicebus-namespace' && current.name === e.name && current.resourceGroup === e.resourceGroup
    return affected ? { kind: 'resource-group', name: e.resourceGroup } : current
  }
  return current
}

let seq = 0

export const usePortalStore = defineStore('portal', {
  state: () => ({
    notifications: [],
    unread: 0,
    notificationsOpen: false,
    menuOpen: false,
    toast: null,
    shell: { visible: true, minimized: false, maximized: false },
    labPanelCollapsed: false,
    blade: { ...DEFAULT_BLADE },
  }),
  actions: {
    notify(title, text) {
      this.notifications.unshift({ id: `n_${Date.now()}_${seq++}`, title, text, at: new Date().toISOString() })
      if (this.notifications.length > 50) this.notifications.length = 50
      if (!this.notificationsOpen) this.unread++
    },
    toggleNotifications() {
      this.notificationsOpen = !this.notificationsOpen
      this.menuOpen = false
      if (this.notificationsOpen) this.unread = 0
    },
    toggleMenu() {
      this.menuOpen = !this.menuOpen
      this.notificationsOpen = false
    },
    closePanes() {
      this.notificationsOpen = false
      this.menuOpen = false
    },
    dismissNotifications() {
      this.notifications = []
      this.unread = 0
    },
    showToast(title, text) {
      this.toast = { title, text }
    },
    dismissToast() {
      this.toast = null
    },
    toggleShell() {
      if (this.shell.visible) this.shell = { visible: false, minimized: false, maximized: false }
      else this.shell = { visible: true, minimized: false, maximized: false }
    },
    openShell() {
      this.shell = { visible: true, minimized: false, maximized: this.shell.maximized }
    },
    closeShell() {
      this.shell = { visible: false, minimized: false, maximized: false }
    },
    toggleShellMinimized() {
      this.shell = { visible: true, minimized: !this.shell.minimized, maximized: false }
    },
    toggleShellMaximized() {
      this.shell = { visible: true, minimized: false, maximized: !this.shell.maximized }
    },
    toggleLabPanel() {
      this.labPanelCollapsed = !this.labPanelCollapsed
    },
    showBlade(blade) {
      this.blade = blade
    },
    applyEvent(e) {
      this.blade = bladeForEvent(e, this.blade)
      const n = notificationForEvent(e)
      this.notify(n.title, n.text)
    },
    resetForLab() {
      this.blade = { ...DEFAULT_BLADE }
      this.toast = null
      this.notificationsOpen = false
      this.menuOpen = false
    },
  },
})
```

- [ ] **Step 6: Implement `src/stores/labRun.js`**

```js
import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '../lib/storage.js'
import { createSandbox } from '../lib/sandbox/model.js'
import { runLine } from '../lib/az/shell.js'
import { labById } from '../data/labs/index.js'
import { useProgressStore, runKey } from './progress.js'
import { usePortalStore } from './portal.js'

const MAX_SCROLLBACK = 600
const MAX_HISTORY = 100
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freshRun(lab) {
  return {
    labId: lab.id,
    sandbox: lab.seed(createSandbox()),
    scrollback: [],
    history: [],
    hintsRevealed: {},
    solutionsRevealed: {},
    elapsedMs: 0,
    lastTickAt: null,
    completedAt: null,
    resultId: null,
  }
}

export const useLabRunStore = defineStore('labRun', {
  state: () => ({
    labId: null,
    sandbox: createSandbox(),
    scrollback: [],
    history: [],
    hintsRevealed: {},
    solutionsRevealed: {},
    elapsedMs: 0,
    lastTickAt: null,
    completedAt: null,
    resultId: null,
    running: false,
  }),
  getters: {
    lab: (s) => (s.labId ? labById(s.labId) : null),
    taskStates() {
      if (!this.lab) return []
      return this.lab.tasks.map((t, index) => ({ ...t, index, done: t.check(this.sandbox) }))
    },
    total() { return this.lab ? this.lab.tasks.length : 0 },
    doneCount() { return this.taskStates.filter((t) => t.done).length },
    currentTaskId() { return this.taskStates.find((t) => !t.done)?.id ?? null },
    isComplete() { return this.total > 0 && this.doneCount === this.total },
    hintsUsed: (s) => Object.values(s.hintsRevealed).reduce((a, b) => a + b, 0),
    solutionsUsed: (s) => Object.keys(s.solutionsRevealed).length,
  },
  actions: {
    load(labId) {
      const saved = loadJSON(runKey(labId), null)
      const lab = labById(labId)
      if (!lab) throw new Error(`Unknown Lab '${labId}'`)
      const data = saved && saved.labId === labId ? { ...freshRun(lab), ...saved, lastTickAt: null } : freshRun(lab)
      Object.assign(this, data, { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
    start(labId) {
      const lab = labById(labId)
      if (!lab) throw new Error(`Unknown Lab '${labId}'`)
      Object.assign(this, freshRun(lab), { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
    persist() {
      if (!this.labId) return
      const { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId } = this
      saveJSON(runKey(labId), { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId })
    },
    pushLine(line) {
      this.scrollback.push(line)
      if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.splice(0, this.scrollback.length - MAX_SCROLLBACK)
    },
    async execute(line, { sleep = defaultSleep } = {}) {
      if (this.running) return null
      this.pushLine({ kind: 'cmd', text: line })
      const trimmed = line.trim()
      if (trimmed) {
        if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed)
        if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY)
      }
      const result = runLine(this.sandbox, line)
      if (result.latencyMs > 0) {
        this.running = true
        try { await sleep(result.latencyMs) } finally { this.running = false }
      }
      if (result.clear) {
        this.scrollback = []
      } else {
        for (const l of result.lines) this.pushLine(l.kind === 'err' ? { kind: 'err', text: `ERROR: ${l.text}` } : l)
      }
      this.sandbox = result.sandbox
      const portal = usePortalStore()
      for (const e of result.events) portal.applyEvent(e)
      this.checkCompletion()
      this.persist()
      return result
    },
    checkCompletion() {
      if (this.completedAt || !this.isComplete) return
      this.completedAt = new Date().toISOString()
      const result = {
        id: `res_${Date.now()}`,
        labId: this.labId,
        tasksDone: this.doneCount,
        total: this.total,
        hintsUsed: this.hintsUsed,
        solutionsUsed: this.solutionsUsed,
        durationMs: this.elapsedMs,
        finishedAt: this.completedAt,
      }
      this.resultId = result.id
      useProgressStore().addResult(result)
      const portal = usePortalStore()
      portal.notify('Lab completed', this.lab.title)
      portal.showToast('Lab completed', this.lab.title)
    },
    revealHint(taskId) {
      const task = this.lab?.tasks.find((t) => t.id === taskId)
      if (!task) return
      const n = this.hintsRevealed[taskId] ?? 0
      if (n >= task.hints.length) return
      this.hintsRevealed = { ...this.hintsRevealed, [taskId]: n + 1 }
      this.persist()
    },
    revealSolution(taskId) {
      if (!this.lab?.tasks.some((t) => t.id === taskId)) return
      this.solutionsRevealed = { ...this.solutionsRevealed, [taskId]: true }
      this.persist()
    },
    tick(nowMs = Date.now()) {
      if (this.completedAt) return
      if (this.lastTickAt !== null) this.elapsedMs += Math.max(0, nowMs - this.lastTickAt)
      this.lastTickAt = nowMs
    },
    pauseTimer() {
      this.lastTickAt = null
      this.persist()
    },
    clearScrollback() {
      this.scrollback = []
      this.persist()
    },
    restart() {
      if (!this.lab) return
      Object.assign(this, freshRun(this.lab), { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
  },
})
```

- [ ] **Step 7: Run tests**

`npx vitest run tests/format.test.js tests/progress-store.test.js tests/portal-store.test.js tests/lab-run-store.test.js` → all PASS. Then `npx vitest run` → whole suite green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(stores): progress (Lab Results), labRun (active Lab with persistence) and portal UI state"
```

---

### Task 10: Portal header, panes, toast and the Home page (design artboard 1)

**Files:**
- Create: `src/components/portal/PortalHeader.vue`, `src/components/portal/PortalMenu.vue`, `src/components/portal/NotificationsPane.vue`, `src/components/portal/ToastNotice.vue`, `src/components/home/ServicesRow.vue`, `src/components/home/SkillAreaCard.vue`, `src/components/home/LabCard.vue`
- Modify: `src/App.vue`, `src/pages/HomePage.vue`, `src/styles/components.css` (append), `src/styles/pages.css` (append), `src/router/index.js` (add lazy `/lab/:labId` route now so Home buttons work; `LabPage.vue` placeholder created here, replaced in Part 3)
- Create: `src/pages/LabPage.vue` (placeholder: renders `<main class="lab">Lab {{ labId }}</main>`)

**Interfaces:**
- Consumes: `usePortalStore`, `useProgressStore`, `LABS`, `SKILL_AREAS`, `SERVICES`, `HOME_SERVICES`, `FluentIcon`, `AzureIcon`, `formatDuration`.
- Produces: `PortalHeader` (no props; emits nothing; uses portal store), `ToastNotice` (no props), `LabCard` (`props: { lab }`), `SkillAreaCard` (`props: { area }`), `ServicesRow` (no props). CSS classes `.portal-header*`, `.pane*`, `.toast*`, `.home*`, `.svc-tile*`, `.area-card*`, `.lab-card*`.

Design reference (artboard 1): header 48px `#1E2A38`; hamburger bars `#C4CFDB`; brand mark + "Azure-Trainer" 14px/600; search 560×30 `#2B3949` border `#3D4C5E` radius 3, placeholder `#93A5B6` 13px "Search resources, services, and labs  ( / )"; five 32×32 icon buttons; account chip: "Sam Learner" 12px/600, "Sandbox directory" 10.5px `#93A5B6`, 30px circle `#4C82E8` "SL" 11px/700. Content padding 22px 40px; crumb "Home" 12.5px dim; section titles 14px/600 with 14px bottom margin; services row: 96px-wide tiles, 44px rounded (7px) tinted squares, 12px labels; Skill Area cards: white, border `#E2E7ED` (active: `#B9CCF0`), radius 6, padding 14, 44px ring (r=18, stroke 4, track `#E2E7ED`, in-progress arc `#9DB8E8`, done arc accent), title 12.5px/600, meta 11.5px dim with "· 1 in progress" accent/600; Lab cards 3-up: padding 16, 36px icon tile, title 13px/600, meta 11.5px dim, pill + "3 of 5 tasks", 4px bar, button `Resume` (`#2E5FCC`, 12.5px/600, padding 6px 18px, radius 3); coming-soon: header block opacity .55, title dim, pill "Coming soon" grey.

- [ ] **Step 1: App.vue, router, LabPage placeholder**

`src/App.vue`:

```vue
<script setup>
import PortalHeader from './components/portal/PortalHeader.vue'
import NotificationsPane from './components/portal/NotificationsPane.vue'
import PortalMenu from './components/portal/PortalMenu.vue'
import ToastNotice from './components/portal/ToastNotice.vue'
</script>

<template>
  <div class="at-root">
    <PortalHeader />
    <PortalMenu />
    <NotificationsPane />
    <ToastNotice />
    <RouterView />
  </div>
</template>
```

`src/router/index.js` routes:

```js
const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/lab/:labId', name: 'lab', component: () => import('../pages/LabPage.vue'), props: true },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
```

`src/pages/LabPage.vue` placeholder:

```vue
<script setup>
defineProps({ labId: { type: String, required: true } })
</script>

<template>
  <main class="lab">Lab {{ labId }}</main>
</template>
```

- [ ] **Step 2: PortalHeader.vue**

```vue
<script setup>
import { useRoute, useRouter } from 'vue-router'
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'
import AzureIcon from '../icons/AzureIcon.vue'

const portal = usePortalStore()
const router = useRouter()
const route = useRoute()

function onShellClick() {
  if (route.name === 'lab') portal.toggleShell()
  else portal.openShell()
}
</script>

<template>
  <header class="portal-header">
    <button class="portal-header__icon-btn" type="button" aria-label="Show portal menu" :aria-expanded="portal.menuOpen" @click="portal.toggleMenu()">
      <FluentIcon name="navigation" :size="20" />
    </button>
    <RouterLink class="portal-header__brand" to="/" @click="portal.closePanes()">
      <AzureIcon name="azure-logo" :size="18" />
      <span>Azure-Trainer</span>
    </RouterLink>
    <div class="portal-header__search-wrap">
      <label class="portal-header__search">
        <FluentIcon name="search" :size="14" />
        <input type="search" placeholder="Search resources, services, and labs  ( / )" aria-label="Search resources, services, and labs" />
      </label>
    </div>
    <nav class="portal-header__actions" aria-label="Portal actions">
      <button class="portal-header__icon-btn" type="button" aria-label="Cloud Shell" :aria-pressed="portal.shell.visible" @click="onShellClick"><FluentIcon name="window-console" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Notifications" :aria-expanded="portal.notificationsOpen" @click="portal.toggleNotifications()">
        <FluentIcon name="alert" :size="18" />
        <span v-if="portal.unread" class="portal-header__badge">{{ portal.unread }}</span>
      </button>
      <button class="portal-header__icon-btn" type="button" aria-label="Settings"><FluentIcon name="settings" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Help + support"><FluentIcon name="question-circle" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Feedback"><FluentIcon name="person-feedback" :size="18" /></button>
    </nav>
    <div class="portal-header__account">
      <div class="portal-header__account-text">
        <div class="portal-header__account-name">Sam Learner</div>
        <div class="portal-header__account-dir">Sandbox directory</div>
      </div>
      <div class="portal-header__avatar" aria-hidden="true">SL</div>
    </div>
  </header>
</template>
```

- [ ] **Step 3: PortalMenu.vue, NotificationsPane.vue, ToastNotice.vue**

`PortalMenu.vue`:

```vue
<script setup>
import { usePortalStore } from '../../stores/portal.js'
import AzureIcon from '../icons/AzureIcon.vue'

const portal = usePortalStore()
</script>

<template>
  <div v-if="portal.menuOpen" class="pane pane--menu" role="menu">
    <RouterLink class="pane__item" to="/" role="menuitem" @click="portal.closePanes()"><AzureIcon name="dashboard" :size="16" /> Home</RouterLink>
    <RouterLink class="pane__item" to="/#labs" role="menuitem" @click="portal.closePanes()"><AzureIcon name="all-resources" :size="16" /> Labs</RouterLink>
    <div class="pane__section">Favorites</div>
    <div class="pane__item pane__item--static"><AzureIcon name="resource-group" :size="16" /> Resource groups</div>
    <div class="pane__item pane__item--static"><AzureIcon name="service-bus" :size="16" /> Service Bus</div>
    <div class="pane__item pane__item--static"><AzureIcon name="subscription" :size="16" /> Subscriptions</div>
  </div>
</template>
```

`NotificationsPane.vue`:

```vue
<script setup>
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'
import { relativeTime } from '../../lib/format.js'

const portal = usePortalStore()
</script>

<template>
  <aside v-if="portal.notificationsOpen" class="pane pane--notifications" aria-label="Notifications">
    <div class="pane__header">
      <span>Notifications</span>
      <button type="button" class="pane__link" @click="portal.dismissNotifications()">Dismiss all</button>
      <button type="button" class="pane__close" aria-label="Close" @click="portal.toggleNotifications()"><FluentIcon name="dismiss" :size="14" /></button>
    </div>
    <div v-if="!portal.notifications.length" class="pane__empty">No new notifications</div>
    <ul v-else class="pane__list">
      <li v-for="n in portal.notifications" :key="n.id" class="notice">
        <span class="notice__dot" aria-hidden="true"><FluentIcon name="checkmark" :size="10" /></span>
        <div class="notice__body">
          <div class="notice__title">{{ n.title }}</div>
          <div class="notice__text">{{ n.text }}</div>
          <div class="notice__time">{{ relativeTime(n.at) }}</div>
        </div>
      </li>
    </ul>
  </aside>
</template>
```

`ToastNotice.vue` (position: right of the Lab Panel on the Lab page, per artboard 3 `right: 372px`; 24px on Home):

```vue
<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'

const portal = usePortalStore()
const route = useRoute()
const style = computed(() => ({ right: route.name === 'lab' && !portal.labPanelCollapsed ? '372px' : '24px' }))

let timer = null
watch(() => portal.toast, (t) => {
  if (timer) clearTimeout(timer)
  if (t) timer = setTimeout(() => portal.dismissToast(), 8000)
})
</script>

<template>
  <div v-if="portal.toast" class="toast" role="status" :style="style">
    <span class="toast__dot" aria-hidden="true"><FluentIcon name="checkmark" :size="10" /></span>
    <div class="toast__body">
      <div class="toast__title">{{ portal.toast.title }}</div>
      <div class="toast__text">{{ portal.toast.text }}</div>
    </div>
    <button type="button" class="toast__close" aria-label="Dismiss" @click="portal.dismissToast()"><FluentIcon name="dismiss" :size="12" /></button>
  </div>
</template>
```

- [ ] **Step 4: Home components**

`ServicesRow.vue`:

```vue
<script setup>
import { SERVICES, HOME_SERVICES } from '../../data/services.js'
import AzureIcon from '../icons/AzureIcon.vue'
</script>

<template>
  <div class="svc-row">
    <div class="svc-tile">
      <div class="svc-tile__icon svc-tile__icon--create" style="background: var(--tint-blue)">+</div>
      <div class="svc-tile__label">Create a resource</div>
    </div>
    <div v-for="key in HOME_SERVICES" :key="key" class="svc-tile">
      <div class="svc-tile__icon" :style="{ background: SERVICES[key].tint }"><AzureIcon :name="SERVICES[key].icon" :size="22" /></div>
      <div class="svc-tile__label">{{ SERVICES[key].label }}</div>
    </div>
    <div class="svc-tile">
      <div class="svc-tile__icon svc-tile__icon--more" style="background: var(--tint-grey)">···</div>
      <div class="svc-tile__label">More services</div>
    </div>
  </div>
</template>
```

`SkillAreaCard.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { useProgressStore } from '../../stores/progress.js'

const props = defineProps({ area: { type: Object, required: true } })
const progress = useProgressStore()
const stats = computed(() => progress.skillAreaProgress(props.area.id))
const C = 2 * Math.PI * 18
const doneDash = computed(() => `${(stats.value.completed / Math.max(1, stats.value.total)) * C} ${C}`)
const activeDash = computed(() => `${((stats.value.completed + stats.value.inProgress * 0.15) / Math.max(1, stats.value.total)) * C} ${C}`)
const plural = (n) => (n === 1 ? 'lab' : 'labs')
</script>

<template>
  <div class="area-card" :class="{ 'area-card--active': stats.inProgress > 0 }">
    <svg class="area-card__ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" stroke-width="4" />
      <circle v-if="stats.inProgress" cx="22" cy="22" r="18" fill="none" stroke="var(--accent-ring)" stroke-width="4" :stroke-dasharray="activeDash" stroke-linecap="round" transform="rotate(-90 22 22)" />
      <circle v-if="stats.completed" cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" stroke-width="4" :stroke-dasharray="doneDash" stroke-linecap="round" transform="rotate(-90 22 22)" />
      <text x="22" y="26" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">{{ stats.completed }}/{{ stats.total }}</text>
    </svg>
    <div>
      <div class="area-card__title">{{ area.name }}</div>
      <div class="area-card__meta">
        {{ area.weight }} · {{ stats.completed }} of {{ stats.total }} {{ plural(stats.total) }}<template v-if="stats.inProgress"> · <span class="area-card__active">{{ stats.inProgress }} in progress</span></template>
      </div>
    </div>
  </div>
</template>
```

`LabCard.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { useProgressStore } from '../../stores/progress.js'
import { SERVICES } from '../../data/services.js'
import { skillAreaById } from '../../data/skillAreas.js'
import AzureIcon from '../icons/AzureIcon.vue'

const props = defineProps({ lab: { type: Object, required: true } })
const progress = useProgressStore()
const service = computed(() => SERVICES[props.lab.service])
const area = computed(() => skillAreaById(props.lab.skillAreaId))
const comingSoon = computed(() => props.lab.status !== 'available')
const status = computed(() => (comingSoon.value ? 'coming-soon' : progress.labStatus(props.lab.id)))
const summary = computed(() => (comingSoon.value ? null : progress.runSummary(props.lab.id)))
const pct = computed(() => (summary.value ? Math.round((summary.value.tasksDone / summary.value.total) * 100) : 0))
const label = computed(() => ({ 'not-started': 'Not started', 'in-progress': 'In progress', completed: 'Completed', 'coming-soon': 'Coming soon' })[status.value])
const button = computed(() => ({ 'not-started': 'Start', 'in-progress': 'Resume', completed: 'Open' })[status.value])
</script>

<template>
  <article class="lab-card" :class="{ 'lab-card--active': status === 'in-progress', 'lab-card--soon': comingSoon }">
    <div class="lab-card__head">
      <div class="lab-card__icon" :style="{ background: service.tint }"><AzureIcon :name="service.icon" :size="20" /></div>
      <div>
        <div class="lab-card__title">{{ lab.title }}</div>
        <div class="lab-card__meta">{{ area.name }} · ~{{ lab.minutes }} min</div>
      </div>
    </div>
    <div class="lab-card__status">
      <span class="pill" :class="status === 'coming-soon' || status === 'not-started' ? 'pill--muted' : 'pill--accent'">{{ label }}</span>
      <span v-if="summary" class="lab-card__count">{{ summary.tasksDone }} of {{ summary.total }} tasks</span>
    </div>
    <div v-if="summary" class="bar lab-card__bar" :class="{ 'bar--success': status === 'completed' }"><div class="bar__fill" :style="{ width: pct + '%' }" /></div>
    <div v-if="!comingSoon" class="lab-card__actions">
      <RouterLink class="btn btn--primary" :to="{ name: 'lab', params: { labId: lab.id } }">{{ button }}</RouterLink>
    </div>
  </article>
</template>
```

- [ ] **Step 5: HomePage.vue**

```vue
<script setup>
import ServicesRow from '../components/home/ServicesRow.vue'
import SkillAreaCard from '../components/home/SkillAreaCard.vue'
import LabCard from '../components/home/LabCard.vue'
import { SKILL_AREAS } from '../data/skillAreas.js'
import { LABS } from '../data/labs/index.js'
</script>

<template>
  <main class="home">
    <div class="home__crumb">Home</div>
    <h2 class="home__section">Azure services</h2>
    <ServicesRow />
    <h2 class="home__section">Labs by Skill Area</h2>
    <div class="home__areas">
      <SkillAreaCard v-for="area in SKILL_AREAS" :key="area.id" :area="area" />
    </div>
    <h2 id="labs" class="home__section">Labs</h2>
    <div class="home__labs">
      <LabCard v-for="lab in LABS" :key="lab.id" :lab="lab" />
    </div>
  </main>
</template>
```

- [ ] **Step 6: Append CSS**

Append to `src/styles/components.css`:

```css
/* ---- Portal header ------------------------------------------------------ */
.portal-header { height: var(--header-h); flex: none; background: var(--header-bg); color: #fff; display: flex; align-items: center; gap: 14px; padding: 0 14px; position: relative; z-index: 20; }
.portal-header__icon-btn { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; color: var(--header-icon); border-radius: 3px; position: relative; }
.portal-header__icon-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.portal-header__icon-btn[aria-pressed="true"] { background: rgba(255, 255, 255, 0.12); color: #fff; }
.portal-header__brand { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-size: 14px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap; }
.portal-header__brand:hover { color: #fff; text-decoration: none; }
.portal-header__search-wrap { flex: 1; display: flex; justify-content: center; }
.portal-header__search { width: 560px; height: 30px; background: var(--header-search-bg); border: 1px solid var(--header-search-border); border-radius: 3px; display: flex; align-items: center; gap: 8px; padding: 0 10px; color: var(--header-muted); }
.portal-header__search input { flex: 1; background: transparent; border: 0; color: #fff; font: inherit; font-size: 13px; outline: none; }
.portal-header__search input::placeholder { color: var(--header-muted); }
.portal-header__actions { display: flex; align-items: center; gap: 4px; }
.portal-header__badge { position: absolute; top: 2px; right: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--danger); color: #fff; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.portal-header__account { display: flex; align-items: center; gap: 9px; margin-left: 6px; }
.portal-header__account-text { text-align: right; }
.portal-header__account-name { font-size: 12px; font-weight: 600; line-height: 1.2; }
.portal-header__account-dir { font-size: 10.5px; color: var(--header-muted); line-height: 1.3; }
.portal-header__avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--header-accent); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }

/* ---- Panes (portal menu, notifications) --------------------------------- */
.pane { position: absolute; top: var(--header-h); background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-toast); z-index: 30; font-size: 12.5px; }
.pane--menu { left: 0; width: 260px; padding: 8px; border-top: 0; }
.pane--notifications { right: 0; width: 360px; max-height: calc(100vh - var(--header-h)); display: flex; flex-direction: column; border-top: 0; }
.pane__item { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-radius: 3px; color: var(--text); }
.pane__item:hover { background: var(--accent-soft); text-decoration: none; }
.pane__item--static { color: var(--text-dim); cursor: default; }
.pane__item--static:hover { background: transparent; }
.pane__section { font-size: 11px; font-weight: 600; color: var(--text-dim); padding: 10px 10px 4px; }
.pane__header { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px; }
.pane__header > span { flex: 1; }
.pane__link { font-size: 12px; color: var(--accent); font-weight: 500; }
.pane__close { color: var(--text-dim); display: inline-flex; }
.pane__empty { padding: 24px 14px; color: var(--text-dim); text-align: center; }
.pane__list { list-style: none; margin: 0; padding: 4px 0; overflow: auto; }
.notice { display: flex; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-faint); }
.notice__dot, .toast__dot { width: 18px; height: 18px; flex: none; border-radius: 50%; background: var(--success); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.notice__title, .toast__title { font-size: 13px; font-weight: 600; }
.notice__text, .toast__text { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.notice__time { font-size: 11px; color: var(--text-faint); margin-top: 4px; }

/* ---- Toast -------------------------------------------------------------- */
.toast { position: fixed; top: calc(var(--header-h) + 10px); width: 340px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-m); box-shadow: var(--shadow-toast); padding: 12px 14px; display: flex; gap: 10px; z-index: 40; }
.toast__body { flex: 1; }
.toast__close { color: var(--text-faint); display: inline-flex; align-self: flex-start; }

/* ---- Home: service tiles, Skill Area cards, Lab cards ------------------- */
.svc-row { display: flex; gap: 6px; margin-bottom: 34px; }
.svc-tile { width: 96px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.svc-tile__icon { width: 44px; height: 44px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.svc-tile__icon--create { font: 300 22px var(--font-body); color: var(--accent); }
.svc-tile__icon--more { font-size: 16px; font-weight: 700; color: var(--text-dim); letter-spacing: 1px; }
.svc-tile__label { font-size: 12px; text-align: center; line-height: 1.3; }

.area-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-l); padding: 14px; display: flex; gap: 12px; align-items: center; }
.area-card--active { border-color: var(--border-accent); }
.area-card__ring { flex: none; }
.area-card__title { font-size: 12.5px; font-weight: 600; line-height: 1.35; }
.area-card__meta { font-size: 11.5px; color: var(--text-dim); margin-top: 3px; }
.area-card__active { color: var(--accent); font-weight: 600; }

.lab-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-l); padding: 16px; }
.lab-card--active { border-color: var(--border-accent); }
.lab-card__head { display: flex; gap: 10px; align-items: flex-start; }
.lab-card--soon .lab-card__head { opacity: 0.55; }
.lab-card--soon .lab-card__title { color: var(--text-dim); }
.lab-card--soon .lab-card__meta { color: var(--text-faint); }
.lab-card__icon { width: 36px; height: 36px; flex: none; border-radius: var(--radius-l); display: flex; align-items: center; justify-content: center; }
.lab-card__title { font-size: 13px; font-weight: 600; line-height: 1.35; }
.lab-card__meta { font-size: 11.5px; color: var(--text-dim); margin-top: 3px; }
.lab-card__status { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.lab-card__count { font-size: 11.5px; color: var(--text-dim); }
.lab-card__bar { margin-top: 8px; }
.lab-card__actions { margin-top: 12px; }
```

Append to `src/styles/pages.css`:

```css
.home__section { font-size: 14px; font-weight: 600; margin: 0 0 14px; }
.home__areas { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 34px; }
.home__labs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding-bottom: 32px; }
```

- [ ] **Step 7: Verify in the browser**

```bash
npm run dev
```
Open `http://localhost:5175/` at 1440×900 and compare with artboard 1: header layout, tiles with the official Azure icons, four Skill Area cards ("0/1", "0/1", "0/3", "0/1" since Functions is under Connect), six Lab cards (first "Not started" with a "Start" button, five "Coming soon"). Click the bell (empty pane), the hamburger (menu), the Cloud Shell icon (no-op on Home beyond state). Click "Start" → placeholder Lab page renders "Lab servicebus-order-backend". Run `npx vitest run` → green; `npm run build` → OK.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): portal header, menu and notification panes, toast, Home page with Skill Area and Lab cards"
```

---

## Self-review (Part 2)

- Spec coverage: Lab shape and content (Task 8), persistence keys and resume semantics, Lab Result fields, Skill Area counts, notifications/toast/shell state, Blade focus rules (Task 9), Home screen (Task 10). Header Cloud Shell icon toggles the dock only on the Lab page (Home has no dock).
- Type consistency: `runSummary → { tasksDone, total, completedAt }` used by `LabCard`; `labStatus` values `'not-started'|'in-progress'|'completed'` used by `LabCard` and `skillAreaProgress`; `bladeForEvent` returns the exact blade shapes consumed by Part 3's `BladeHost`; scrollback entries `{ kind: 'cmd'|'out'|'err', text }` consumed by Part 3's `ShellTerminal` (errors are stored already prefixed with `ERROR: `).

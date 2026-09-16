# Azure-Trainer Demo Implementation Plan — Part 1: Foundation & Engine (Tasks 1–7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Part 2 (Tasks 8–14: data, stores, UI) is in `2026-09-16-azure-trainer-demo-part2-ui.md` and depends on this part.

**Goal:** Build the playable demo of Azure-Trainer: a simulated Azure portal whose Cloud Shell runs a whitelisted `az` subset against an in-memory Sandbox, with one Service Bus Lab whose Tasks tick live.

**Architecture:** Pure-function engine (`src/lib/sandbox` = state + operations, `src/lib/az` = tokenizer, argparse-style parser, command tree, az-shaped output/errors) with no Vue imports, fully unit-tested. Pinia stores wrap the engine and persist to localStorage. Vue components are thin renderers of store state, styled with global CSS tokens taken from the design file.

**Tech Stack:** Vue 3.5, Vite 6, Pinia 2, vue-router 4, vitest 2. JavaScript only. Plain CSS. Inline SVG icons (official Azure + Fluent).

**Spec:** `E:\Projects\Vue\Azure-Trainer\SPEC.md` (read it first), glossary `CONTEXT.md`, decision `docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md`, visual truth `docs/design/Azure-Trainer Screens.dc.html`.

## Global Constraints

- Project root: `E:\Projects\Vue\Azure-Trainer`. All paths below are relative to it. Run all commands from it.
- JavaScript only (no TypeScript), `<script setup>` in components, 2-space indent, single quotes, no semicolons (match Net-Trainer style).
- No new runtime dependencies beyond `vue`, `pinia`, `vue-router`. Dev deps only `vite`, `@vitejs/plugin-vue`, `vitest`.
- Engine code in `src/lib/**` must not import Vue or Pinia.
- Tests run with `npx vitest run <file>`; node environment; fake `localStorage` via the helper shown in Task 1.
- Terminology in code, comments and UI copy follows CONTEXT.md: Portal, Blade, Cloud Shell, Sandbox, Skill Area, Lab, Task, Hint, Solution, Exam Note, Lab Panel, Lab Result. Never "Exercise", "Terminal", "Sidebar", "Score".
- localStorage key prefix `at_`.
- Commit after every task with a conventional-commit message. Never add a GitHub Pages workflow.
- The Cloud Shell is the only mutation path (ADR-0001). Nothing in the Portal UI may call a sandbox operation.

## File structure (whole demo)

```
Azure-Trainer/
├── index.html, vite.config.js, package.json, .gitignore
├── src/
│   ├── main.js, App.vue
│   ├── router/index.js
│   ├── styles/{index,tokens,components,pages}.css
│   ├── assets/icons/azure/*.svg        (already present: official Azure icons)
│   ├── assets/icons/fluent/*.svg       (already present: Fluent UI System Icons, 20 regular)
│   ├── lib/
│   │   ├── storage.js                  loadJSON/saveJSON
│   │   ├── icons.js                    icon registries (raw SVG maps)
│   │   ├── inlineCode.js               backtick → <code> renderer (escaped)
│   │   ├── sandbox/{model,locations,errors,ops}.js
│   │   └── az/{tokenize,args,format,help,tree,arm,run,shell}.js
│   │       └── commands/{index,misc,account,configure,group,servicebus-namespace,servicebus-queue,servicebus-topic,servicebus-subscription,servicebus-rule}.js
│   ├── data/{skillAreas,services}.js, data/labs/{index,servicebus-order-backend.lab}.js
│   ├── stores/{progress,labRun,portal}.js
│   ├── components/icons/{FluentIcon,AzureIcon}.vue
│   ├── components/portal/{PortalHeader,PortalMenu,NotificationsPane,ToastNotice}.vue
│   ├── components/home/{ServicesRow,SkillAreaCard,LabCard}.vue
│   ├── components/blade/{BladeHost,ResourceMenu,BladeHeader,EssentialsGrid,MetricCard,EntityTable,ResourceGroupsBlade,ResourceGroupBlade,ServiceBusNamespaceBlade}.vue
│   ├── components/shell/{CloudShell,ShellTerminal}.vue
│   ├── components/lab/{LabPanel,TaskRow,HintBox,ExamNote,LabCompletePanel}.vue
│   └── pages/{HomePage,LabPage}.vue
└── tests/*.test.js
```

---

### Task 1: Scaffold the project (git, Vite, router, styles, storage helper)

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `src/main.js`, `src/App.vue`, `src/router/index.js`, `src/pages/HomePage.vue` (placeholder), `src/styles/index.css`, `src/styles/tokens.css`, `src/styles/components.css`, `src/styles/pages.css`, `src/lib/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `loadJSON(key, fallback)`, `saveJSON(key, value)` from `src/lib/storage.js`; CSS custom properties listed in `tokens.css` (used by every later component); router with routes `home` (`/`) and catch-all.

- [ ] **Step 1: Initialise git and write package.json**

```bash
cd E:\Projects\Vue\Azure-Trainer
git init
```

`package.json`:

```json
{
  "name": "azure-trainer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "pinia": "^2.3.0",
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.1",
    "vite": "^6.0.7",
    "vitest": "^2.1.8"
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.DS_Store
*.local
.vite/
.claude/
*.log
```

- [ ] **Step 2: Vite config, index.html, main.js, App.vue, router, placeholder page**

`vite.config.js`:

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: { port: 5175 },
  test: { environment: 'node' },
})
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Azure-Trainer</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

`src/main.js`:

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/index.css'

createApp(App).use(createPinia()).use(router).mount('#app')
```

`src/App.vue` (the header is added in Task 10):

```vue
<script setup></script>

<template>
  <div class="at-root">
    <RouterView />
  </div>
</template>
```

`src/router/index.js`:

```js
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const history = import.meta.env.PROD
  ? createWebHashHistory(import.meta.env.BASE_URL)
  : createWebHistory(import.meta.env.BASE_URL)

const router = createRouter({ history, routes })

export default router
```

`src/pages/HomePage.vue` (placeholder, replaced in Task 10):

```vue
<script setup></script>

<template>
  <main class="home">
    <div class="home__crumb">Home</div>
  </main>
</template>
```

- [ ] **Step 3: Styles — tokens from the design file**

`src/styles/index.css`:

```css
@import './tokens.css';
@import './components.css';
@import './pages.css';
```

`src/styles/tokens.css` (every value is lifted from `docs/design/Azure-Trainer Screens.dc.html`):

```css
/* Azure-Trainer — design tokens. Source of truth: docs/design/Azure-Trainer Screens.dc.html */
:root {
  /* Surfaces */
  --portal-bg: #F4F6F8;
  --surface: #FFFFFF;
  --chip-bg: #EEF1F4;
  --code-bg: #F0F3F6;
  --row-bg: #F5F9FF;

  /* Lines */
  --border: #E2E7ED;
  --border-strong: #D5DCE3;
  --border-input: #CBD4DD;
  --border-faint: #EEF1F4;
  --border-accent: #B9CCF0;
  --border-hint: #DCE4EE;

  /* Text */
  --text: #1C2733;
  --text-2: #33404D;
  --text-dim: #5A6B7C;
  --text-faint: #98A5B3;

  /* Accent */
  --accent: #2E5FCC;
  --accent-strong: #2851AF;
  --accent-soft: #EDF2FC;
  --accent-soft-2: #E4ECF8;
  --accent-ring: #9DB8E8;

  /* Status */
  --success: #1E7A3C;
  --success-text: #175A2C;
  --success-soft: #EFF7F1;
  --success-bg: #EAF5EC;
  --success-border: #CFE6D4;
  --danger: #C0392B;

  /* Header */
  --header-bg: #1E2A38;
  --header-search-bg: #2B3949;
  --header-search-border: #3D4C5E;
  --header-icon: #C4CFDB;
  --header-muted: #93A5B6;
  --header-accent: #4C82E8;

  /* Cloud Shell */
  --shell-header-bg: #141B23;
  --shell-bg: #0D1117;
  --shell-text: #C9D4DE;
  --shell-muted: #8B9AAB;
  --shell-title: #DDE6EF;
  --shell-handle: #3A4552;
  --shell-border: #2A3340;
  --shell-green: #7EE787;
  --shell-blue: #6CB6FF;
  --shell-red: #F1707B;

  /* Service tile tints (Home) */
  --tint-blue: #EDF2FC;
  --tint-teal: #E7F4F4;
  --tint-purple: #F1ECFA;
  --tint-amber: #FBF3E4;
  --tint-violet: #F2EEFB;
  --tint-steel: #EAF1F8;
  --tint-red: #FAECEA;
  --tint-slate: #EAF0F5;
  --tint-grey: #EEF1F4;

  /* Type */
  --font-body: 'Public Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;

  /* Layout */
  --header-h: 48px;
  --resource-menu-w: 240px;
  --lab-panel-w: 360px;
  --shell-h: 280px;
  --shell-header-h: 34px;
  --radius-s: 3px;
  --radius-m: 4px;
  --radius-l: 6px;
  --shadow-toast: 0 6px 20px rgba(23, 32, 42, 0.18);
}
```

`src/styles/components.css` (base reset now; component blocks are appended by later tasks):

```css
/* Azure-Trainer — component styles. Appended per component task. */
*,
*::before,
*::after { box-sizing: border-box; }

html, body, #app { height: 100%; margin: 0; }
body {
  background: var(--portal-bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-strong); text-decoration: underline; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
code { font: 11px var(--font-mono); background: var(--code-bg); padding: 0 4px; border-radius: 3px; }

.at-root { height: 100vh; display: flex; flex-direction: column; min-width: 1280px; }

/* Icons */
.icon { display: inline-flex; flex: none; line-height: 0; }
.icon svg { width: 100%; height: 100%; display: block; }

/* Pills / chips */
.pill { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
.pill--accent { color: var(--accent-strong); background: var(--accent-soft); }
.pill--muted { color: var(--text-dim); background: var(--chip-bg); }
.pill--small { font-size: 10.5px; }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 6px 18px; border-radius: var(--radius-s); border: 1px solid transparent; }
.btn--primary { background: var(--accent); color: #fff; }
.btn--primary:hover { background: var(--accent-strong); }
.btn--secondary { background: var(--surface); color: var(--text); border-color: var(--border-input); }
.btn--secondary:hover { background: var(--chip-bg); }
.btn--disabled, .btn:disabled { background: var(--code-bg); color: var(--text-faint); cursor: default; }
.btn--block { display: flex; width: 100%; padding: 8px; font-size: 13px; }

/* Progress bar */
.bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.bar__fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 240ms ease; }
.bar--success { background: var(--success-border); }
.bar--success .bar__fill { background: var(--success); }
```

`src/styles/pages.css`:

```css
/* Azure-Trainer — page layouts. Appended per page task. */
.home { flex: 1; min-height: 0; overflow: auto; padding: 22px 40px; }
.home__crumb { font-size: 12.5px; color: var(--text-dim); margin-bottom: 20px; }
```

- [ ] **Step 4: Write the failing storage test**

`tests/storage.test.js`:

```js
import { beforeEach, describe, expect, it } from 'vitest'
import { loadJSON, saveJSON } from '../src/lib/storage.js'

export function fakeLocalStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

describe('storage', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
  })

  it('round-trips a value', () => {
    saveJSON('at_x', { a: 1 })
    expect(loadJSON('at_x', null)).toEqual({ a: 1 })
  })

  it('returns fallback for missing key', () => {
    expect(loadJSON('at_missing', [])).toEqual([])
  })

  it('returns fallback for corrupt JSON', () => {
    globalThis.localStorage.setItem('at_bad', '{nope')
    expect(loadJSON('at_bad', 42)).toBe(42)
  })

  it('removeJSON deletes the key', () => {
    saveJSON('at_x', 1)
    removeJSON('at_x')
    expect(loadJSON('at_x', 'gone')).toBe('gone')
  })
})
```

Add `removeJSON` to the import line: `import { loadJSON, saveJSON, removeJSON } from '../src/lib/storage.js'`.

- [ ] **Step 5: Install and run the test to see it fail**

```bash
npm install
npx vitest run tests/storage.test.js
```
Expected: FAIL (cannot resolve `../src/lib/storage.js`).

- [ ] **Step 6: Implement storage.js**

```js
export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or unavailable — progress is best-effort
  }
}

export function removeJSON(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
```

- [ ] **Step 7: Run tests, dev build**

```bash
npx vitest run tests/storage.test.js
npm run build
```
Expected: 4 tests PASS; build succeeds (dist/ created).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Azure-Trainer (Vite + Vue 3 + Pinia + router, design tokens, storage helper)"
```

---

### Task 2: Icon registries and icon components

**Files:**
- Create: `src/lib/icons.js`, `src/components/icons/FluentIcon.vue`, `src/components/icons/AzureIcon.vue`
- Test: `tests/icons.test.js`
- Existing assets: `src/assets/icons/fluent/*.svg` (Fluent 20px regular; paths carry `fill="#212121"`), `src/assets/icons/azure/*.svg` (official Azure icons with gradients).

**Interfaces:**
- Produces: `fluentIcon(name) → string` (SVG markup using `currentColor`, no width/height attrs), `azureIcon(name) → string` (SVG markup without width/height attrs), `FLUENT_ICONS`, `AZURE_ICONS` (name → markup). `<FluentIcon name="alert" :size="16" />`, `<AzureIcon name="service-bus" :size="20" />`.
- Fluent names available: navigation, search, window-console, alert, settings, question-circle, person-feedback, star, pin, dismiss, delete, arrow-sync, folder-arrow-right, arrow-right, chevron-down, chevron-right, chevron-up, checkmark, checkmark-circle-filled, circle, more-horizontal, arrow-sort, add, code, open, subtract, maximize, arrow-counterclockwise, arrow-upload, info, dismiss-circle, play.
- Azure names available: azure-logo, service-bus, container-apps, cosmos-db, key-vault, functions, postgresql, managed-redis, container-registry, event-grid, resource-group, subscription, cloud-shell, all-resources, queue, dashboard, help-and-support, tag, search.

- [ ] **Step 1: Write the failing test**

`tests/icons.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { fluentIcon, azureIcon, toCurrentColor, stripSize, FLUENT_ICONS, AZURE_ICONS } from '../src/lib/icons.js'

describe('icon registries', () => {
  it('loads the fluent set with currentColor fills and no fixed size', () => {
    const svg = fluentIcon('alert')
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).not.toContain('#212121')
    expect(svg).not.toMatch(/<svg[^>]*\swidth="/)
    expect(Object.keys(FLUENT_ICONS).length).toBeGreaterThanOrEqual(30)
  })

  it('loads the azure set keeping colours but dropping fixed size', () => {
    const svg = azureIcon('service-bus')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="0 0 18 18"')
    expect(svg).not.toMatch(/<svg[^>]*\swidth="/)
    expect(Object.keys(AZURE_ICONS)).toEqual(expect.arrayContaining(['azure-logo', 'resource-group', 'cloud-shell']))
  })

  it('returns an empty string for unknown names', () => {
    expect(fluentIcon('nope')).toBe('')
    expect(azureIcon('nope')).toBe('')
  })

  it('helpers are pure string transforms', () => {
    expect(toCurrentColor('<svg width="20" height="20"><path fill="#212121"/></svg>')).toBe('<svg><path fill="currentColor"/></svg>')
    expect(stripSize('<svg xmlns="x" width="18" height="18" viewBox="0 0 18 18"></svg>')).toBe('<svg xmlns="x" viewBox="0 0 18 18"></svg>')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

`npx vitest run tests/icons.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/icons.js`**

```js
// Icon registries. Fluent UI System Icons (Microsoft, MIT) for controls; official Azure
// architecture icons for services. Both are inlined as raw SVG at build time.
const fluentFiles = import.meta.glob('../assets/icons/fluent/*.svg', { query: '?raw', import: 'default', eager: true })
const azureFiles = import.meta.glob('../assets/icons/azure/*.svg', { query: '?raw', import: 'default', eager: true })

function keyOf(path) {
  return path.split('/').pop().replace(/\.svg$/, '')
}

export function stripSize(svg) {
  return svg
    .replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1')
    .replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1')
}

export function toCurrentColor(svg) {
  return stripSize(svg).replace(/fill="#212121"/g, 'fill="currentColor"')
}

export const FLUENT_ICONS = Object.fromEntries(
  Object.entries(fluentFiles).map(([path, svg]) => [keyOf(path), toCurrentColor(svg)]),
)

export const AZURE_ICONS = Object.fromEntries(
  Object.entries(azureFiles).map(([path, svg]) => [keyOf(path), stripSize(svg)]),
)

export function fluentIcon(name) {
  return FLUENT_ICONS[name] ?? ''
}

export function azureIcon(name) {
  return AZURE_ICONS[name] ?? ''
}
```

- [ ] **Step 4: Components**

`src/components/icons/FluentIcon.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { fluentIcon } from '../../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 },
})
const svg = computed(() => fluentIcon(props.name))
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="icon icon--fluent" :style="style" aria-hidden="true" v-html="svg" />
</template>
```

`src/components/icons/AzureIcon.vue`:

```vue
<script setup>
import { computed } from 'vue'
import { azureIcon } from '../../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 20 },
})
const svg = computed(() => azureIcon(props.name))
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="icon icon--azure" :style="style" aria-hidden="true" v-html="svg" />
</template>
```

- [ ] **Step 5: Run tests**

`npx vitest run tests/icons.test.js` → 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: official Azure + Fluent icon registries and inline icon components"
```

---

### Task 3: Sandbox model and operations

**Files:**
- Create: `src/lib/sandbox/model.js`, `src/lib/sandbox/locations.js`, `src/lib/sandbox/errors.js`, `src/lib/sandbox/ops.js`
- Test: `tests/sandbox-ops.test.js`, `tests/locations.test.js`

**Interfaces:**
- Produces (all pure; `op(sandbox, params) → { sandbox, resource }` on a deep clone, or throws `AzError`):
  - `createSandbox()`, `cloneSandbox(sb)`, `SUBSCRIPTION_ID`, `SUBSCRIPTION_NAME`, `TENANT_ID`
  - `normalizeLocation(input) → code|null`, `displayLocation(code) → string`, `LOCATIONS`
  - `class AzError extends Error { code, kind: 'arm'|'cli' }`
  - `createResourceGroup(sb, { name, location, tags })`, `getResourceGroup(sb, name)`, `deleteResourceGroup(sb, { name })`, `listResourceGroups(sb)`
  - `createNamespace(sb, { resourceGroup, name, location, sku, tags })`, `getNamespace(sb, resourceGroup, name)`, `updateNamespace(sb, { resourceGroup, name, sku, tags })`, `deleteNamespace(sb, { resourceGroup, name })`, `listNamespaces(sb, resourceGroup|null)`
  - `createQueue(sb, { resourceGroup, namespace, name, ...props })`, `getQueue(sb, resourceGroup, namespace, name)`, `updateQueue(sb, {...})`, `deleteQueue(sb, {...})`, `listQueues(sb, resourceGroup, namespace)`
  - `createTopic`, `getTopic`, `deleteTopic`, `listTopics` (same param style)
  - `createSubscription(sb, { resourceGroup, namespace, topic, name, ...props })`, `getSubscription(sb, rg, ns, topic, name)`, `deleteSubscription`, `listSubscriptions(sb, rg, ns, topic)`
  - `createRule(sb, { resourceGroup, namespace, topic, subscription, name, filterType, sqlExpression, correlationFilter })`, `getRule(sb, rg, ns, topic, sub, name)`, `deleteRule`, `listRules(sb, rg, ns, topic, sub)`
  - `setDefaults(sb, { group, location })`

- [ ] **Step 1: Write failing tests**

`tests/locations.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { normalizeLocation, displayLocation } from '../src/lib/sandbox/locations.js'

describe('locations', () => {
  it('normalises codes and display names', () => {
    expect(normalizeLocation('westeurope')).toBe('westeurope')
    expect(normalizeLocation('WestEurope')).toBe('westeurope')
    expect(normalizeLocation('West Europe')).toBe('westeurope')
    expect(normalizeLocation('  east us 2 ')).toBe('eastus2')
    expect(normalizeLocation('marsnorth')).toBeNull()
  })
  it('displays codes', () => {
    expect(displayLocation('westeurope')).toBe('West Europe')
    expect(displayLocation('unknown')).toBe('unknown')
  })
})
```

`tests/sandbox-ops.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { AzError } from '../src/lib/sandbox/errors.js'
import * as ops from '../src/lib/sandbox/ops.js'

function withNamespace(sku = 'Standard') {
  let sb = createSandbox()
  sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
  sb = ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku }).sandbox
  return sb
}

describe('resource groups', () => {
  it('creates a group and does not mutate the input', () => {
    const sb0 = createSandbox()
    const { sandbox, resource } = ops.createResourceGroup(sb0, { name: 'rg-orders', location: 'West Europe' })
    expect(sb0.resourceGroups).toHaveLength(0)
    expect(sandbox.resourceGroups).toHaveLength(1)
    expect(resource).toMatchObject({ name: 'rg-orders', location: 'westeurope', tags: null })
    expect(typeof resource.createdAt).toBe('string')
  })
  it('is idempotent on re-create (PUT semantics) and updates location', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'northeurope', tags: { env: 'dev' } }).sandbox
    expect(sb.resourceGroups).toHaveLength(1)
    expect(sb.resourceGroups[0]).toMatchObject({ location: 'northeurope', tags: { env: 'dev' } })
  })
  it('rejects unknown locations with an ARM error', () => {
    expect(() => ops.createResourceGroup(createSandbox(), { name: 'rg', location: 'marsnorth' })).toThrow(AzError)
    try { ops.createResourceGroup(createSandbox(), { name: 'rg', location: 'marsnorth' }) } catch (e) {
      expect(e.code).toBe('LocationNotAvailableForResourceGroup')
      expect(e.kind).toBe('arm')
    }
  })
  it('rejects invalid names', () => {
    expect(() => ops.createResourceGroup(createSandbox(), { name: 'bad name!', location: 'westeurope' })).toThrow(/ResourceGroupNotValid|invalid/i)
  })
  it('getResourceGroup throws ResourceGroupNotFound', () => {
    try { ops.getResourceGroup(createSandbox(), 'rg-x'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceGroupNotFound')
      expect(e.message).toBe("Resource group 'rg-x' could not be found.")
    }
  })
  it('deletes a group with everything inside it', () => {
    let sb = withNamespace()
    sb = ops.deleteResourceGroup(sb, { name: 'rg-orders' }).sandbox
    expect(sb.resourceGroups).toHaveLength(0)
    expect(sb.namespaces).toHaveLength(0)
  })
})

describe('namespaces', () => {
  it('creates with Standard default sku and the group location', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    const { resource } = ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders' })
    expect(resource).toMatchObject({ name: 'sb-contoso-orders', resourceGroup: 'rg-orders', location: 'westeurope', sku: 'Standard', queues: [], topics: [] })
  })
  it('requires the group to exist', () => {
    try { ops.createNamespace(createSandbox(), { resourceGroup: 'rg-x', name: 'sb-abcdef' }); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceGroupNotFound')
    }
  })
  it('validates the namespace name', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'ab' })).toThrow(/namespace is invalid/)
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: '1abcdef' })).toThrow(/namespace is invalid/)
  })
  it('rejects unknown sku', () => {
    let sb = createSandbox()
    sb = ops.createResourceGroup(sb, { name: 'rg-orders', location: 'westeurope' }).sandbox
    expect(() => ops.createNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku: 'Gold' })).toThrow(/sku/i)
  })
  it('updates sku and looks up by group + name', () => {
    let sb = withNamespace('Basic')
    sb = ops.updateNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders', sku: 'Standard' }).sandbox
    expect(ops.getNamespace(sb, 'rg-orders', 'sb-contoso-orders').sku).toBe('Standard')
    try { ops.getNamespace(sb, 'rg-orders', 'sb-nope'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('ResourceNotFound')
      expect(e.message).toContain("'Microsoft.ServiceBus/namespaces/sb-nope' under resource group 'rg-orders' was not found")
    }
  })
  it('lists namespaces, optionally by group', () => {
    let sb = withNamespace()
    sb = ops.createResourceGroup(sb, { name: 'rg-two', location: 'eastus' }).sandbox
    sb = ops.createNamespace(sb, { resourceGroup: 'rg-two', name: 'sb-second-ns' }).sandbox
    expect(ops.listNamespaces(sb)).toHaveLength(2)
    expect(ops.listNamespaces(sb, 'rg-two')).toHaveLength(1)
  })
})

describe('queues', () => {
  it('creates with az defaults and applies overrides', () => {
    const sb = withNamespace()
    const { resource } = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
    expect(resource).toMatchObject({ name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, lockDuration: 'PT1M', maxSizeInMegabytes: 1024, status: 'Active', requiresSession: false })
  })
  it('update keeps unspecified properties', () => {
    let sb = withNamespace()
    sb = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', maxDeliveryCount: 5 }).sandbox
    sb = ops.updateQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders', deadLetteringOnMessageExpiration: true }).sandbox
    expect(ops.getQueue(sb, 'rg-orders', 'sb-contoso-orders', 'orders')).toMatchObject({ maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
  })
  it('delete and list', () => {
    let sb = withNamespace()
    sb = ops.createQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders' }).sandbox
    expect(ops.listQueues(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(1)
    sb = ops.deleteQueue(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'orders' }).sandbox
    expect(ops.listQueues(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(0)
    try { ops.getQueue(sb, 'rg-orders', 'sb-contoso-orders', 'orders'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('NotFound')
    }
  })
})

describe('topics, subscriptions, rules', () => {
  it('refuses topics on Basic tier with the az wording', () => {
    const sb = withNamespace('Basic')
    try { ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('BadRequest')
      expect(e.message).toBe("SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.")
    }
  })
  it('creates topic, subscription with $Default rule, then a custom rule', () => {
    let sb = withNamespace()
    sb = ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    sb = ops.createSubscription(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', name: 'eu-orders' }).sandbox
    const sub = ops.getSubscription(sb, 'rg-orders', 'sb-contoso-orders', 'order-events', 'eu-orders')
    expect(sub.rules).toEqual([expect.objectContaining({ name: '$Default', filterType: 'SqlFilter', sqlExpression: '1=1' })])
    sb = ops.createRule(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders', name: 'eu-filter', sqlExpression: "region = 'EU'" }).sandbox
    sb = ops.deleteRule(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders', name: '$Default' }).sandbox
    const rules = ops.listRules(sb, 'rg-orders', 'sb-contoso-orders', 'order-events', 'eu-orders')
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: 'eu-filter', filterType: 'SqlFilter', sqlExpression: "region = 'EU'" })
  })
  it('topic/subscription/rule lookups throw NotFound with the entity path', () => {
    const sb = withNamespace()
    try { ops.getTopic(sb, 'rg-orders', 'sb-contoso-orders', 'nope'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('NotFound')
      expect(e.message).toContain("Entity 'sb-contoso-orders:Topic:nope' was not found")
    }
  })
  it('deleting a topic removes its subscriptions; deleting a namespace removes entities', () => {
    let sb = withNamespace()
    sb = ops.createTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    sb = ops.createSubscription(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', name: 'eu-orders' }).sandbox
    sb = ops.deleteTopic(sb, { resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', name: 'order-events' }).sandbox
    expect(ops.listTopics(sb, 'rg-orders', 'sb-contoso-orders')).toHaveLength(0)
    sb = ops.deleteNamespace(sb, { resourceGroup: 'rg-orders', name: 'sb-contoso-orders' }).sandbox
    expect(sb.namespaces).toHaveLength(0)
  })
})

describe('defaults', () => {
  it('stores az configure defaults', () => {
    let sb = createSandbox()
    sb = ops.setDefaults(sb, { group: 'rg-orders' }).sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: null })
    sb = ops.setDefaults(sb, { location: 'westeurope' }).sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: 'westeurope' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/locations.test.js tests/sandbox-ops.test.js` → FAIL (modules missing).

- [ ] **Step 3: Implement model, locations, errors**

`src/lib/sandbox/model.js`:

```js
export const SUBSCRIPTION_ID = '7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37'
export const SUBSCRIPTION_NAME = 'Sandbox'
export const TENANT_ID = '3c1f5a8e-9d2b-4f6a-8e7c-1b2d3e4f5a6b'
export const USER_NAME = 'sam.learner@sandbox.onmicrosoft.com'

export function createSandbox() {
  return { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } }
}

export function cloneSandbox(sb) {
  return JSON.parse(JSON.stringify(sb))
}

export function nowIso() {
  return new Date().toISOString()
}
```

`src/lib/sandbox/locations.js`:

```js
export const LOCATIONS = {
  westeurope: 'West Europe',
  northeurope: 'North Europe',
  eastus: 'East US',
  eastus2: 'East US 2',
  centralus: 'Central US',
  westus: 'West US',
  westus2: 'West US 2',
  westus3: 'West US 3',
  uksouth: 'UK South',
  ukwest: 'UK West',
  francecentral: 'France Central',
  germanywestcentral: 'Germany West Central',
  swedencentral: 'Sweden Central',
  switzerlandnorth: 'Switzerland North',
  norwayeast: 'Norway East',
  polandcentral: 'Poland Central',
  italynorth: 'Italy North',
  southeastasia: 'Southeast Asia',
  eastasia: 'East Asia',
  japaneast: 'Japan East',
  australiaeast: 'Australia East',
  canadacentral: 'Canada Central',
  brazilsouth: 'Brazil South',
  southafricanorth: 'South Africa North',
  centralindia: 'Central India',
}

export function normalizeLocation(input) {
  if (typeof input !== 'string') return null
  const key = input.toLowerCase().replace(/\s+/g, '')
  return Object.hasOwn(LOCATIONS, key) ? key : null
}

export function displayLocation(code) {
  return LOCATIONS[code] ?? code
}
```

`src/lib/sandbox/errors.js`:

```js
// AzError.kind: 'arm' → az prints "ERROR: (Code) Message\nCode: Code\nMessage: Message";
//               'cli' → az prints "ERROR: Message" only.
export class AzError extends Error {
  constructor(code, message, { kind = 'arm' } = {}) {
    super(message)
    this.name = 'AzError'
    this.code = code
    this.kind = kind
  }
}

export function notFoundEntity(namespace, type, name) {
  return new AzError('NotFound', `Entity '${namespace}:${type}:${name}' was not found.`)
}
```

- [ ] **Step 4: Implement ops.js**

```js
import { cloneSandbox, nowIso } from './model.js'
import { normalizeLocation, LOCATIONS } from './locations.js'
import { AzError, notFoundEntity } from './errors.js'

const SKUS = ['Basic', 'Standard', 'Premium']
const RG_NAME_RE = /^[-\w.()]{1,90}$/
const NS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9-]{4,48}[a-zA-Z0-9]$/
const ENTITY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/~]{0,259}$/
const RULE_NAME_RE = /^[A-Za-z0-9$][A-Za-z0-9$._\-]{0,49}$/

const MAX_TTL = 'P10675199DT2H48M5.4775807S'

export const QUEUE_DEFAULTS = {
  maxDeliveryCount: 10,
  deadLetteringOnMessageExpiration: false,
  defaultMessageTimeToLive: MAX_TTL,
  lockDuration: 'PT1M',
  maxSizeInMegabytes: 1024,
  requiresSession: false,
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: 'PT10M',
  enablePartitioning: false,
  enableBatchedOperations: true,
  status: 'Active',
}

export const TOPIC_DEFAULTS = {
  maxSizeInMegabytes: 1024,
  defaultMessageTimeToLive: MAX_TTL,
  requiresDuplicateDetection: false,
  duplicateDetectionHistoryTimeWindow: 'PT10M',
  enablePartitioning: false,
  enableBatchedOperations: true,
  supportOrdering: true,
  status: 'Active',
}

export const SUBSCRIPTION_DEFAULTS = {
  maxDeliveryCount: 10,
  lockDuration: 'PT1M',
  deadLetteringOnMessageExpiration: false,
  deadLetteringOnFilterEvaluationExceptions: true,
  defaultMessageTimeToLive: MAX_TTL,
  requiresSession: false,
  enableBatchedOperations: true,
  status: 'Active',
}

function pickDefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

function requireName(name, re, error) {
  if (typeof name !== 'string' || !re.test(name)) throw error
}

// ---- resource groups -------------------------------------------------------

function findGroup(sb, name) {
  return sb.resourceGroups.find((g) => g.name.toLowerCase() === String(name).toLowerCase())
}

export function getResourceGroup(sb, name) {
  const g = findGroup(sb, name)
  if (!g) throw new AzError('ResourceGroupNotFound', `Resource group '${name}' could not be found.`)
  return g
}

export function listResourceGroups(sb) {
  return sb.resourceGroups
}

export function createResourceGroup(sb, { name, location, tags = null }) {
  requireName(name, RG_NAME_RE, new AzError('ResourceGroupNotValid', `Resource group name '${name}' is invalid. Resource group names only allow alphanumeric characters, periods, underscores, hyphens and parenthesis and cannot end in a period.`))
  const loc = normalizeLocation(location)
  if (!loc) throw new AzError('LocationNotAvailableForResourceGroup', `The provided location '${location}' is not available for resource group. List of available regions is '${Object.keys(LOCATIONS).join(',')}'.`)
  const next = cloneSandbox(sb)
  let g = findGroup(next, name)
  if (g) {
    g.location = loc
    g.tags = tags ?? g.tags
  } else {
    g = { name, location: loc, tags, createdAt: nowIso() }
    next.resourceGroups.push(g)
  }
  return { sandbox: next, resource: g }
}

export function deleteResourceGroup(sb, { name }) {
  getResourceGroup(sb, name)
  const next = cloneSandbox(sb)
  next.resourceGroups = next.resourceGroups.filter((g) => g.name.toLowerCase() !== name.toLowerCase())
  next.namespaces = next.namespaces.filter((n) => n.resourceGroup.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- namespaces ------------------------------------------------------------

function findNamespace(sb, resourceGroup, name) {
  return sb.namespaces.find(
    (n) => n.resourceGroup.toLowerCase() === String(resourceGroup).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase(),
  )
}

export function getNamespace(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const ns = findNamespace(sb, resourceGroup, name)
  if (!ns) throw new AzError('ResourceNotFound', `The Resource 'Microsoft.ServiceBus/namespaces/${name}' under resource group '${resourceGroup}' was not found. For more details please go to https://aka.ms/ARMResourceNotFoundFix`)
  return ns
}

export function listNamespaces(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.namespaces
  getResourceGroup(sb, resourceGroup)
  return sb.namespaces.filter((n) => n.resourceGroup.toLowerCase() === resourceGroup.toLowerCase())
}

function checkSku(sku) {
  if (!SKUS.includes(sku)) throw new AzError('InvalidArgumentValue', `argument --sku: invalid choice: '${sku}' (choose from 'Basic', 'Standard', 'Premium')`, { kind: 'cli' })
}

export function createNamespace(sb, { resourceGroup, name, location, sku = 'Standard', tags = null }) {
  const g = getResourceGroup(sb, resourceGroup)
  requireName(name, NS_NAME_RE, new AzError('BadRequest', 'The specified service namespace is invalid. Namespace names must be between 6 and 50 characters long, contain only letters, numbers, and hyphens, start with a letter, and end with a letter or number.'))
  checkSku(sku)
  let loc = g.location
  if (location !== undefined && location !== null) {
    loc = normalizeLocation(location)
    if (!loc) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for resource type 'Microsoft.ServiceBus/namespaces'.`)
  }
  if (sb.namespaces.some((n) => n.name.toLowerCase() === name.toLowerCase() && n.resourceGroup.toLowerCase() !== resourceGroup.toLowerCase())) {
    throw new AzError('Conflict', `The specified name is not available. Namespace '${name}' already exists in another resource group.`)
  }
  const next = cloneSandbox(sb)
  let ns = findNamespace(next, resourceGroup, name)
  if (ns) {
    ns.sku = sku
    ns.tags = tags ?? ns.tags
  } else {
    ns = { name, resourceGroup: g.name, location: loc, sku, tags, createdAt: nowIso(), queues: [], topics: [] }
    next.namespaces.push(ns)
  }
  return { sandbox: next, resource: ns }
}

export function updateNamespace(sb, { resourceGroup, name, sku, tags }) {
  getNamespace(sb, resourceGroup, name)
  if (sku !== undefined) checkSku(sku)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, name)
  if (sku !== undefined) ns.sku = sku
  if (tags !== undefined) ns.tags = tags
  return { sandbox: next, resource: ns }
}

export function deleteNamespace(sb, { resourceGroup, name }) {
  getNamespace(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  next.namespaces = next.namespaces.filter((n) => !(n.resourceGroup.toLowerCase() === resourceGroup.toLowerCase() && n.name.toLowerCase() === name.toLowerCase()))
  return { sandbox: next, resource: null }
}

// ---- queues ----------------------------------------------------------------

function findQueue(ns, name) {
  return ns.queues.find((q) => q.name.toLowerCase() === String(name).toLowerCase())
}

export function getQueue(sb, resourceGroup, namespace, name) {
  const ns = getNamespace(sb, resourceGroup, namespace)
  const q = findQueue(ns, name)
  if (!q) throw notFoundEntity(namespace, 'Queue', name)
  return q
}

export function listQueues(sb, resourceGroup, namespace) {
  return getNamespace(sb, resourceGroup, namespace).queues
}

export function createQueue(sb, { resourceGroup, namespace, name, ...props }) {
  getNamespace(sb, resourceGroup, namespace)
  requireName(name, ENTITY_NAME_RE, new AzError('BadRequest', `The entity name '${name}' is invalid. Entity names can contain letters, numbers, periods, hyphens, underscores and slashes, and must be 1-260 characters long.`))
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  let q = findQueue(ns, name)
  if (q) {
    Object.assign(q, pickDefined(props))
  } else {
    q = { name, ...QUEUE_DEFAULTS, ...pickDefined(props), createdAt: nowIso() }
    ns.queues.push(q)
  }
  return { sandbox: next, resource: q }
}

export function updateQueue(sb, { resourceGroup, namespace, name, ...props }) {
  getQueue(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const q = findQueue(findNamespace(next, resourceGroup, namespace), name)
  Object.assign(q, pickDefined(props))
  return { sandbox: next, resource: q }
}

export function deleteQueue(sb, { resourceGroup, namespace, name }) {
  getQueue(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  ns.queues = ns.queues.filter((q) => q.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- topics ----------------------------------------------------------------

function findTopic(ns, name) {
  return ns.topics.find((t) => t.name.toLowerCase() === String(name).toLowerCase())
}

export function getTopic(sb, resourceGroup, namespace, name) {
  const ns = getNamespace(sb, resourceGroup, namespace)
  const t = findTopic(ns, name)
  if (!t) throw notFoundEntity(namespace, 'Topic', name)
  return t
}

export function listTopics(sb, resourceGroup, namespace) {
  return getNamespace(sb, resourceGroup, namespace).topics
}

export function createTopic(sb, { resourceGroup, namespace, name, ...props }) {
  const ns0 = getNamespace(sb, resourceGroup, namespace)
  if (ns0.sku === 'Basic') throw new AzError('BadRequest', `SubCode=40000. Cannot operate on type Topic because the namespace '${namespace}' is using 'Basic' tier.`)
  requireName(name, ENTITY_NAME_RE, new AzError('BadRequest', `The entity name '${name}' is invalid. Entity names can contain letters, numbers, periods, hyphens, underscores and slashes, and must be 1-260 characters long.`))
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  let t = findTopic(ns, name)
  if (t) {
    Object.assign(t, pickDefined(props))
  } else {
    t = { name, ...TOPIC_DEFAULTS, ...pickDefined(props), createdAt: nowIso(), subscriptions: [] }
    ns.topics.push(t)
  }
  return { sandbox: next, resource: t }
}

export function deleteTopic(sb, { resourceGroup, namespace, name }) {
  getTopic(sb, resourceGroup, namespace, name)
  const next = cloneSandbox(sb)
  const ns = findNamespace(next, resourceGroup, namespace)
  ns.topics = ns.topics.filter((t) => t.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- subscriptions ---------------------------------------------------------

function findSubscription(t, name) {
  return t.subscriptions.find((s) => s.name.toLowerCase() === String(name).toLowerCase())
}

export function getSubscription(sb, resourceGroup, namespace, topic, name) {
  const t = getTopic(sb, resourceGroup, namespace, topic)
  const s = findSubscription(t, name)
  if (!s) throw notFoundEntity(namespace, `Topic:${topic}|Subscription`, name)
  return s
}

export function listSubscriptions(sb, resourceGroup, namespace, topic) {
  return getTopic(sb, resourceGroup, namespace, topic).subscriptions
}

export function createSubscription(sb, { resourceGroup, namespace, topic, name, ...props }) {
  getTopic(sb, resourceGroup, namespace, topic)
  requireName(name, /^[A-Za-z0-9][A-Za-z0-9._\-]{0,49}$/, new AzError('BadRequest', `The subscription name '${name}' is invalid. Subscription names can contain letters, numbers, periods, hyphens and underscores, and must be 1-50 characters long.`))
  const next = cloneSandbox(sb)
  const t = findTopic(findNamespace(next, resourceGroup, namespace), topic)
  let s = findSubscription(t, name)
  if (s) {
    Object.assign(s, pickDefined(props))
  } else {
    s = {
      name,
      ...SUBSCRIPTION_DEFAULTS,
      ...pickDefined(props),
      createdAt: nowIso(),
      rules: [{ name: '$Default', filterType: 'SqlFilter', sqlExpression: '1=1', correlationFilter: null, createdAt: nowIso() }],
    }
    t.subscriptions.push(s)
  }
  return { sandbox: next, resource: s }
}

export function deleteSubscription(sb, { resourceGroup, namespace, topic, name }) {
  getSubscription(sb, resourceGroup, namespace, topic, name)
  const next = cloneSandbox(sb)
  const t = findTopic(findNamespace(next, resourceGroup, namespace), topic)
  t.subscriptions = t.subscriptions.filter((s) => s.name.toLowerCase() !== name.toLowerCase())
  return { sandbox: next, resource: null }
}

// ---- rules -----------------------------------------------------------------

function findRule(s, name) {
  return s.rules.find((r) => r.name === name)
}

export function getRule(sb, resourceGroup, namespace, topic, subscription, name) {
  const s = getSubscription(sb, resourceGroup, namespace, topic, subscription)
  const r = findRule(s, name)
  if (!r) throw notFoundEntity(namespace, `Topic:${topic}|Subscription:${subscription}|Rule`, name)
  return r
}

export function listRules(sb, resourceGroup, namespace, topic, subscription) {
  return getSubscription(sb, resourceGroup, namespace, topic, subscription).rules
}

export function createRule(sb, { resourceGroup, namespace, topic, subscription, name, filterType = 'SqlFilter', sqlExpression = null, correlationFilter = null }) {
  getSubscription(sb, resourceGroup, namespace, topic, subscription)
  requireName(name, RULE_NAME_RE, new AzError('BadRequest', `The rule name '${name}' is invalid. Rule names can contain letters, numbers, periods, hyphens, underscores and the dollar sign, and must be 1-50 characters long.`))
  if (filterType === 'SqlFilter' && !sqlExpression) throw new AzError('BadRequest', 'A SqlFilter rule requires --filter-sql-expression.', { kind: 'cli' })
  if (filterType === 'CorrelationFilter' && !correlationFilter) throw new AzError('BadRequest', 'A CorrelationFilter rule requires at least one correlation property (e.g. --correlation-id or --label).', { kind: 'cli' })
  const next = cloneSandbox(sb)
  const s = findSubscription(findTopic(findNamespace(next, resourceGroup, namespace), topic), subscription)
  let r = findRule(s, name)
  const body = { filterType, sqlExpression: filterType === 'SqlFilter' ? sqlExpression : null, correlationFilter: filterType === 'CorrelationFilter' ? correlationFilter : null }
  if (r) {
    Object.assign(r, body)
  } else {
    r = { name, ...body, createdAt: nowIso() }
    s.rules.push(r)
  }
  return { sandbox: next, resource: r }
}

export function deleteRule(sb, { resourceGroup, namespace, topic, subscription, name }) {
  getRule(sb, resourceGroup, namespace, topic, subscription, name)
  const next = cloneSandbox(sb)
  const s = findSubscription(findTopic(findNamespace(next, resourceGroup, namespace), topic), subscription)
  s.rules = s.rules.filter((r) => r.name !== name)
  return { sandbox: next, resource: null }
}

// ---- defaults --------------------------------------------------------------

export function setDefaults(sb, { group, location }) {
  const next = cloneSandbox(sb)
  if (group !== undefined) next.defaults.group = group === '' ? null : group
  if (location !== undefined) next.defaults.location = location === '' ? null : location
  return { sandbox: next, resource: next.defaults }
}
```

- [ ] **Step 5: Run tests**

`npx vitest run tests/locations.test.js tests/sandbox-ops.test.js` → all PASS. If `Object.hasOwn` is unavailable on the Node version, replace with `Object.prototype.hasOwnProperty.call(LOCATIONS, key)`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sandbox): model, locations, AzError and pure resource operations"
```

---

### Task 4: az core — tokenizer, argument parser, JSON formatter, help renderer

**Files:**
- Create: `src/lib/az/tokenize.js`, `src/lib/az/args.js`, `src/lib/az/format.js`, `src/lib/az/help.js`
- Test: `tests/az-tokenize.test.js`, `tests/az-args.test.js`, `tests/az-format.test.js`, `tests/az-help.test.js`

**Interfaces:**
- Produces:
  - `tokenize(line) → { tokens: string[]|null, error: string|null }`
  - Arg spec object: `{ name: '--resource-group', aliases: ['-g'], required: false, kind: 'string'|'int'|'bool'|'flag'|'list', choices: string[]|undefined, defaultsKey: 'group'|'location'|undefined, help: string, dest: 'resourceGroup' }`. `dest` is the key in `values`.
  - `parseArgs(argSpecs, tokens, defaults) → { values: object, error: string|null, wantsHelp: boolean }` where `defaults` is `sandbox.defaults`.
  - `toAzJson(value) → string` (sorted keys, 2 spaces).
  - `renderCommandHelp(node) → string`, `renderGroupHelp(node) → string` where node shapes are defined in Task 5 (`{ type: 'command', path: string[], summary, args }` / `{ type: 'group', path, summary, children: { [name]: node } }`).

- [ ] **Step 1: Failing tests**

`tests/az-tokenize.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lib/az/tokenize.js'

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('az group create -n rg -l westeurope').tokens).toEqual(['az', 'group', 'create', '-n', 'rg', '-l', 'westeurope'])
  })
  it('handles single and double quotes', () => {
    expect(tokenize(`--filter-sql-expression "region = 'EU'"`).tokens).toEqual(['--filter-sql-expression', "region = 'EU'"])
    expect(tokenize(`--name '$Default'`).tokens).toEqual(['--name', '$Default'])
    expect(tokenize(`--location "West Europe"`).tokens).toEqual(['--location', 'West Europe'])
  })
  it('expands unknown $VARS to empty outside single quotes (bash behaviour)', () => {
    expect(tokenize('--name $Default').tokens).toEqual(['--name', ''])
    expect(tokenize('--name "$Default"').tokens).toEqual(['--name', ''])
  })
  it('supports backslash escapes and --key=value stays one token', () => {
    expect(tokenize('a\\ b --k=v').tokens).toEqual(['a b', '--k=v'])
  })
  it('reports unterminated quotes', () => {
    const r = tokenize(`--name "oops`)
    expect(r.tokens).toBeNull()
    expect(r.error).toBe("unexpected EOF while looking for matching `\"'")
  })
  it('returns an empty list for blank input', () => {
    expect(tokenize('   ').tokens).toEqual([])
  })
})
```

`tests/az-args.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/lib/az/args.js'

const SPECS = [
  { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name.' },
  { name: '--resource-group', aliases: ['-g'], required: true, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Group.' },
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Max.' },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'DLQ.' },
  { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['Basic', 'Standard', 'Premium'], dest: 'sku', help: 'Sku.' },
  { name: '--yes', aliases: ['-y'], required: false, kind: 'flag', dest: 'yes', help: 'Confirm.' },
  { name: '--tags', aliases: [], required: false, kind: 'list', dest: 'tags', help: 'Tags.' },
]
const NO_DEFAULTS = { group: null, location: null }

describe('parseArgs', () => {
  it('parses values, aliases, --k=v, ints, bools, flags, lists', () => {
    const r = parseArgs(SPECS, ['-n', 'orders', '--resource-group=rg', '--max-delivery-count', '5', '--enable-dead-lettering-on-message-expiration', 'true', '--yes', '--tags', 'a=1', 'b=2'], NO_DEFAULTS)
    expect(r.error).toBeNull()
    expect(r.values).toEqual({ name: 'orders', resourceGroup: 'rg', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, yes: true, tags: { a: '1', b: '2' } })
  })
  it('reports missing required args with aliases, argparse style', () => {
    const r = parseArgs(SPECS, [], NO_DEFAULTS)
    expect(r.error).toBe('the following arguments are required: --name/-n, --resource-group/-g')
  })
  it('fills --resource-group from az configure defaults', () => {
    const r = parseArgs(SPECS, ['-n', 'x'], { group: 'rg-orders', location: null })
    expect(r.error).toBeNull()
    expect(r.values.resourceGroup).toBe('rg-orders')
  })
  it('rejects unrecognized arguments (with their values)', () => {
    const r = parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--foo', 'bar', '--baz'], NO_DEFAULTS)
    expect(r.error).toBe('unrecognized arguments: --foo bar --baz')
  })
  it('validates ints, bools and choices', () => {
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--max-delivery-count', 'five'], NO_DEFAULTS).error).toBe("argument --max-delivery-count: invalid int value: 'five'")
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--enable-dead-lettering-on-message-expiration', 'yes'], NO_DEFAULTS).error).toBe("argument --enable-dead-lettering-on-message-expiration: invalid choice: 'yes' (choose from 'false', 'true')")
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--sku', 'Gold'], NO_DEFAULTS).error).toBe("argument --sku: invalid choice: 'Gold' (choose from 'Basic', 'Standard', 'Premium')")
  })
  it('reports a missing value', () => {
    expect(parseArgs(SPECS, ['-g', 'rg', '-n'], NO_DEFAULTS).error).toBe('argument --name/-n: expected one argument')
    expect(parseArgs(SPECS, ['-n', '', '-g', 'rg'], NO_DEFAULTS).error).toBe('argument --name/-n: expected one argument')
  })
  it('detects --help anywhere', () => {
    expect(parseArgs(SPECS, ['-h'], NO_DEFAULTS).wantsHelp).toBe(true)
    expect(parseArgs(SPECS, ['-n', 'x', '--help'], NO_DEFAULTS).wantsHelp).toBe(true)
  })
})
```

`tests/az-format.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { toAzJson } from '../src/lib/az/format.js'

describe('toAzJson', () => {
  it('sorts keys recursively and indents with two spaces', () => {
    const out = toAzJson({ name: 'orders', countDetails: { deadLetterMessageCount: 0, activeMessageCount: 0 }, id: '/x' })
    expect(out).toBe(['{', '  "countDetails": {', '    "activeMessageCount": 0,', '    "deadLetterMessageCount": 0', '  },', '  "id": "/x",', '  "name": "orders"', '}'].join('\n'))
  })
  it('keeps array order and handles null', () => {
    expect(toAzJson([{ b: 1, a: null }])).toBe('[\n  {\n    "a": null,\n    "b": 1\n  }\n]')
  })
})
```

`tests/az-help.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { renderCommandHelp, renderGroupHelp } from '../src/lib/az/help.js'

const cmd = {
  type: 'command',
  path: ['servicebus', 'queue', 'create'],
  summary: 'Create the ServiceBus Queue.',
  args: [
    { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name of Queue.' },
    { name: '--namespace-name', aliases: [], required: true, kind: 'string', dest: 'namespace', help: 'Name of Namespace.' },
    { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Number of maximum deliveries.', defaultValue: 10 },
    { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'Sessions.' },
  ],
  examples: [{ summary: 'Create a queue with DLQ on expiry.', command: 'az servicebus queue create -g rg -n q --namespace-name ns --enable-dead-lettering-on-message-expiration true' }],
}
const group = {
  type: 'group',
  path: ['servicebus', 'queue'],
  summary: 'Manage Azure Service Bus Queue and Authorization Rule.',
  children: { create: cmd, delete: { type: 'command', path: ['servicebus', 'queue', 'delete'], summary: 'Delete the Queue.', args: [] }, authorization: { type: 'group', path: ['servicebus', 'queue', 'authorization'], summary: 'Manage rules.', children: {} } },
}

describe('help', () => {
  it('renders a command with Arguments and Examples', () => {
    const text = renderCommandHelp(cmd)
    expect(text).toContain('Command\n    az servicebus queue create : Create the ServiceBus Queue.')
    expect(text).toContain('Arguments')
    expect(text).toContain('--name -n           [Required] : Name of Queue.')
    expect(text).toContain('--max-delivery-count           : Number of maximum deliveries.  Default: 10.')
    expect(text).toContain("--enable-session               : Sessions.  Allowed values: false, true.")
    expect(text).toContain('Global Arguments')
    expect(text).toContain('Examples\n    Create a queue with DLQ on expiry.')
    expect(text).toContain('To search AI knowledge base for examples, use: az find "az servicebus queue create"')
  })
  it('renders a group with Subgroups and Commands', () => {
    const text = renderGroupHelp(group)
    expect(text).toContain('Group\n    az servicebus queue : Manage Azure Service Bus Queue and Authorization Rule.')
    expect(text).toContain('Subgroups:\n    authorization : Manage rules.')
    expect(text).toContain('Commands:\n    create        : Create the ServiceBus Queue.\n    delete        : Delete the Queue.')
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/az-tokenize.test.js tests/az-args.test.js tests/az-format.test.js tests/az-help.test.js` → FAIL.

- [ ] **Step 3: Implement tokenize.js**

```js
// Bash-like tokenizer: whitespace splitting, '…' literal quotes, "…" quotes with \ escapes,
// backslash escapes outside quotes, and $IDENT expansion to '' outside single quotes
// (the Sandbox shell has no variables, exactly like a fresh bash session).
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y

export function tokenize(line) {
  const tokens = []
  let cur = ''
  let has = false
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote === "'") {
      if (ch === "'") { quote = null; continue }
      cur += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue }
      if (ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { cur += line[++i]; continue }
      if (ch === '$') { i = expandVar(line, i); continue }
      cur += ch
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue }
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue }
    if (ch === '$') { has = true; i = expandVar(line, i); continue }
    if (/\s/.test(ch)) {
      if (has) { tokens.push(cur); cur = ''; has = false }
      continue
    }
    cur += ch
    has = true
  }
  if (quote) return { tokens: null, error: `unexpected EOF while looking for matching \`${quote}'` }
  if (has) tokens.push(cur)
  return { tokens, error: null }
}

// Returns the index of the last consumed character of "$IDENT" (or of "$" alone).
function expandVar(line, dollarIndex) {
  IDENT_RE.lastIndex = dollarIndex + 1
  const m = IDENT_RE.exec(line)
  return m ? dollarIndex + m[0].length : dollarIndex
}
```

- [ ] **Step 4: Implement args.js**

```js
// argparse-flavoured parsing of az arguments.
export const HELP_FLAGS = ['--help', '-h']

export function displayName(spec) {
  return [spec.name, ...(spec.aliases ?? [])].join('/')
}

function findSpec(specs, token) {
  return specs.find((s) => s.name === token || (s.aliases ?? []).includes(token))
}

export function parseArgs(specs, tokens, defaults = { group: null, location: null }) {
  const values = {}
  const unrecognized = []
  let wantsHelp = false
  let error = null

  const fail = (msg) => { if (!error) error = msg }

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i]
    if (HELP_FLAGS.includes(tok)) { wantsHelp = true; continue }
    let inlineValue = null
    if (tok.startsWith('--') && tok.includes('=')) {
      const eq = tok.indexOf('=')
      inlineValue = tok.slice(eq + 1)
      tok = tok.slice(0, eq)
    }
    if (!tok.startsWith('-')) { unrecognized.push(tok); continue }
    const spec = findSpec(specs, tok)
    if (!spec) {
      unrecognized.push(tokens[i])
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) unrecognized.push(tokens[++i])
      continue
    }
    if (spec.kind === 'flag') { values[spec.dest] = true; continue }
    if (spec.kind === 'list') {
      const items = inlineValue !== null ? [inlineValue] : []
      while (inlineValue === null && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) items.push(tokens[++i])
      values[spec.dest] = Object.fromEntries(items.map((kv) => { const j = kv.indexOf('='); return j === -1 ? [kv, ''] : [kv.slice(0, j), kv.slice(j + 1)] }))
      continue
    }
    let raw = inlineValue
    if (raw === null) {
      if (i + 1 >= tokens.length || (tokens[i + 1].startsWith('-') && tokens[i + 1].length > 1 && !/^-\d/.test(tokens[i + 1]))) {
        fail(`argument ${displayName(spec)}: expected one argument`)
        continue
      }
      raw = tokens[++i]
    }
    if (raw === '') { fail(`argument ${displayName(spec)}: expected one argument`); continue }
    if (spec.kind === 'int') {
      if (!/^-?\d+$/.test(raw)) { fail(`argument ${spec.name}: invalid int value: '${raw}'`); continue }
      values[spec.dest] = parseInt(raw, 10)
      continue
    }
    if (spec.kind === 'bool') {
      const v = raw.toLowerCase()
      if (v !== 'true' && v !== 'false') { fail(`argument ${spec.name}: invalid choice: '${raw}' (choose from 'false', 'true')`); continue }
      values[spec.dest] = v === 'true'
      continue
    }
    if (spec.choices && !spec.choices.includes(raw)) {
      fail(`argument ${spec.name}: invalid choice: '${raw}' (choose from ${spec.choices.map((c) => `'${c}'`).join(', ')})`)
      continue
    }
    values[spec.dest] = raw
  }

  if (wantsHelp) return { values, error: null, wantsHelp: true }

  for (const spec of specs) {
    if (values[spec.dest] === undefined && spec.defaultsKey && defaults?.[spec.defaultsKey]) values[spec.dest] = defaults[spec.defaultsKey]
  }
  const missing = specs.filter((s) => s.required && values[s.dest] === undefined)
  if (!error && missing.length) error = `the following arguments are required: ${missing.map(displayName).join(', ')}`
  if (!error && unrecognized.length) error = `unrecognized arguments: ${unrecognized.join(' ')}`
  return { values, error, wantsHelp: false }
}
```

- [ ] **Step 5: Implement format.js and help.js**

`src/lib/az/format.js`:

```js
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  return v
}

export function toAzJson(value) {
  return JSON.stringify(sortKeys(value), null, 2)
}
```

`src/lib/az/help.js`:

```js
const GLOBAL_ARGS = [
  ['--debug', 'Increase logging verbosity to show all debug logs.'],
  ['--help -h', 'Show this help message and exit.'],
  ['--only-show-errors', 'Only show errors, suppressing warnings.'],
  ['--output -o', 'Output format.  Allowed values: json, jsonc, none, table, tsv, yaml, yamlc.  Default: json.'],
  ['--query', 'JMESPath query string. See http://jmespath.org/ for more information and examples.'],
  ['--subscription', 'Name or ID of subscription. You can configure the default subscription using `az account set -s NAME_OR_ID`.'],
  ['--verbose', 'Increase logging verbosity. Use --debug for full debug logs.'],
]

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function argLabel(a) {
  return [a.name, ...(a.aliases ?? [])].join(' ')
}

function argHelp(a) {
  let h = a.help ?? ''
  if (a.kind === 'bool') h += '  Allowed values: false, true.'
  else if (a.choices) h += `  Allowed values: ${a.choices.join(', ')}.`
  if (a.defaultValue !== undefined) h += `  Default: ${a.defaultValue}.`
  return h
}

function renderArgs(title, args) {
  if (!args.length) return ''
  const width = Math.max(...args.map((a) => argLabel(a).length)) + 1
  const lines = args.map((a) => `    ${pad(argLabel(a), width)}${a.required ? '[Required]' : '          '} : ${argHelp(a)}`)
  return `${title}\n${lines.join('\n')}\n`
}

export function renderCommandHelp(node) {
  const full = `az ${node.path.join(' ')}`
  const required = node.args.filter((a) => a.required)
  const optional = node.args.filter((a) => !a.required)
  let out = `\nCommand\n    ${full} : ${node.summary}\n\n`
  out += renderArgs('Arguments', [...required, ...optional])
  out += '\n'
  out += `Global Arguments\n${GLOBAL_ARGS.map(([n, h]) => `    ${pad(n, 20)}: ${h}`).join('\n')}\n`
  if (node.examples?.length) {
    out += `\nExamples\n${node.examples.map((e) => `    ${e.summary}\n        ${e.command}`).join('\n\n')}\n`
  }
  out += `\nTo search AI knowledge base for examples, use: az find "${full}"\n`
  return out
}

export function renderGroupHelp(node) {
  const full = node.path.length ? `az ${node.path.join(' ')}` : 'az'
  const entries = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b))
  const groups = entries.filter(([, n]) => n.type === 'group')
  const cmds = entries.filter(([, n]) => n.type === 'command')
  const width = Math.max(0, ...entries.map(([k]) => k.length)) + 1
  let out = `\nGroup\n    ${full} : ${node.summary}\n`
  if (groups.length) out += `\nSubgroups:\n${groups.map(([k, n]) => `    ${pad(k, width)}: ${n.summary}`).join('\n')}\n`
  if (cmds.length) out += `\nCommands:\n${cmds.map(([k, n]) => `    ${pad(k, width)}: ${n.summary}`).join('\n')}\n`
  out += `\nTo search AI knowledge base for examples, use: az find "${full}"\n`
  return out
}
```

- [ ] **Step 6: Run tests**

`npx vitest run tests/az-tokenize.test.js tests/az-args.test.js tests/az-format.test.js tests/az-help.test.js` → all PASS. If the help padding assertions fail by a space, adjust `pad` widths so that `--name -n           [Required] : Name of Queue.` (label column = longest label + 1) holds for the fixture; the fixture's longest label is `--enable-dead-lettering-on-message-expiration`? No — in the fixture it is `--max-delivery-count` (20 chars) → column 21; `--name -n` (9) + 12 spaces. Keep the fixture as the contract.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(az): bash-like tokenizer, argparse-style argument parser, az JSON formatter and help renderer"
```

---

### Task 5: az command tree, runner, shell line dispatcher, non-Service-Bus commands

**Files:**
- Create: `src/lib/az/tree.js`, `src/lib/az/arm.js`, `src/lib/az/run.js`, `src/lib/az/shell.js`, `src/lib/az/commands/index.js`, `src/lib/az/commands/misc.js`, `src/lib/az/commands/account.js`, `src/lib/az/commands/configure.js`, `src/lib/az/commands/group.js`
- Test: `tests/az-run.test.js`

**Interfaces:**
- Produces:
  - `tree.js`: `defineGroup(path, summary, children) → groupNode`, `defineCommand(path, summary, { args, run, latencyMs, examples }) → commandNode`, shared arg specs `ARG.resourceGroup`, `ARG.name(help)`, `ARG.namespace`, `ARG.topic`, `ARG.subscription`, `ARG.location(required)`, `ARG.tags`, `ARG.yes`.
  - command `run(ctx, values) → { sandbox, output, events }` where `ctx = { sandbox }`, `output` is an object/array (JSON-printed), a string (printed raw) or `null` (nothing), `events` optional array.
  - `arm.js`: `presentResourceGroup(rg)`, `presentNamespace(ns)`, `presentQueue(q, ns)`, `presentTopic(t, ns)`, `presentSubscription(s, t, ns)`, `presentRule(r, s, t, ns)`, `presentAccount()`.
  - `run.js`: `runAz(sandbox, tokens) → { sandbox, lines: [{ text, kind: 'out'|'err' }], events, latencyMs }` (tokens exclude the leading `az`).
  - `shell.js`: `runLine(sandbox, line) → { sandbox, lines, events, latencyMs, clear: boolean }` (handles `clear`, blank, `az …`, `command not found`).
  - `commands/index.js`: `buildTree() → groupNode` (root, path `[]`), memoised as `AZ_TREE`.
  - Events: `{ type: 'created'|'updated'|'deleted', resourceType: 'resourceGroup'|'namespace'|'queue'|'topic'|'subscription'|'rule', name, resourceGroup, namespace, topic, subscription }`.

- [ ] **Step 1: Failing tests**

`tests/az-run.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

function out(r) { return r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n') }
function err(r) { return r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n') }

describe('shell dispatcher', () => {
  it('clear, blank, unknown commands', () => {
    const sb = createSandbox()
    expect(runLine(sb, 'clear').clear).toBe(true)
    expect(runLine(sb, '   ').lines).toEqual([])
    expect(err(runLine(sb, 'kubectl get pods'))).toBe('bash: kubectl: command not found')
    expect(err(runLine(sb, 'az group create --name "oops'))).toBe("bash: unexpected EOF while looking for matching `\"'")
  })
  it('bare az prints the banner and base commands', () => {
    const r = runLine(createSandbox(), 'az')
    expect(out(r)).toContain('Welcome to the cool new Azure CLI!')
    expect(out(r)).toContain('group')
    expect(out(r)).toContain('servicebus')
  })
  it('az --version / az version', () => {
    expect(out(runLine(createSandbox(), 'az --version'))).toContain('azure-cli')
    expect(JSON.parse(out(runLine(createSandbox(), 'az version'))['azure-cli'])).toBeUndefined
    expect(JSON.parse(out(runLine(createSandbox(), 'az version')))['azure-cli']).toBe('2.78.0')
  })
  it('unknown group / command wording with suggestion', () => {
    expect(err(runLine(createSandbox(), 'az servicebus quene create'))).toBe("'quene' is misspelled or not recognized by the system.\nThe most similar choice to 'quene' is:\n        queue")
    expect(err(runLine(createSandbox(), 'az frobnicate'))).toBe("'frobnicate' is misspelled or not recognized by the system.")
  })
  it('group help and command help', () => {
    expect(out(runLine(createSandbox(), 'az group --help'))).toContain('Group\n    az group : Manage resource groups and template deployments.')
    expect(out(runLine(createSandbox(), 'az group create -h'))).toContain('Command\n    az group create : Create a new resource group.')
    expect(out(runLine(createSandbox(), 'az servicebus'))).toContain('Group\n    az servicebus')
  })
})

describe('az account / configure / login', () => {
  it('account show returns the Sandbox subscription', () => {
    const r = runLine(createSandbox(), 'az account show')
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ id: SUBSCRIPTION_ID, name: 'Sandbox', state: 'Enabled', isDefault: true })
    expect(JSON.parse(out(runLine(createSandbox(), 'az account list')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(createSandbox(), 'az login')))).toHaveLength(1)
  })
  it('configure defaults', () => {
    let sb = createSandbox()
    const r = runLine(sb, 'az configure --defaults group=rg-orders location=westeurope')
    expect(r.lines).toEqual([])
    sb = r.sandbox
    expect(sb.defaults).toEqual({ group: 'rg-orders', location: 'westeurope' })
    expect(JSON.parse(out(runLine(sb, 'az configure --list-defaults')))).toEqual([{ name: 'group', source: 'sandbox', value: 'rg-orders' }, { name: 'location', source: 'sandbox', value: 'westeurope' }])
    expect(err(runLine(sb, 'az configure'))).toContain('interactive')
  })
})

describe('az group', () => {
  it('create → sorted JSON, event, latency', () => {
    const r = runLine(createSandbox(), 'az group create --name rg-orders --location westeurope')
    expect(r.latencyMs).toBe(800)
    expect(r.events).toEqual([{ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }])
    const j = JSON.parse(out(r))
    expect(j).toEqual({ id: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-orders`, location: 'westeurope', managedBy: null, name: 'rg-orders', properties: { provisioningState: 'Succeeded' }, tags: null, type: 'Microsoft.Resources/resourceGroups' })
    expect(out(r).split('\n')[1]).toBe(`  "id": "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-orders",`)
  })
  it('accepts -g as alias for --name and "West Europe"', () => {
    const r = runLine(createSandbox(), 'az group create -g rg-orders -l "West Europe"')
    expect(err(r)).toBe('')
    expect(r.sandbox.resourceGroups[0].location).toBe('westeurope')
  })
  it('missing args and ARM errors are formatted like az', () => {
    expect(err(runLine(createSandbox(), 'az group create --name rg-orders'))).toBe('the following arguments are required: --location/-l')
    expect(err(runLine(createSandbox(), 'az group show --name rg-x'))).toBe("(ResourceGroupNotFound) Resource group 'rg-x' could not be found.\nCode: ResourceGroupNotFound\nMessage: Resource group 'rg-x' could not be found.")
  })
  it('show / list / exists / delete', () => {
    let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
    expect(JSON.parse(out(runLine(sb, 'az group show -n rg-orders'))).name).toBe('rg-orders')
    expect(JSON.parse(out(runLine(sb, 'az group list')))).toHaveLength(1)
    expect(out(runLine(sb, 'az group exists -n rg-orders'))).toBe('true')
    expect(out(runLine(sb, 'az group exists -n nope'))).toBe('false')
    expect(err(runLine(sb, 'az group delete -n rg-orders'))).toBe('Operation cancelled. Pass --yes to confirm deletion in the Sandbox.')
    const r = runLine(sb, 'az group delete -n rg-orders --yes')
    expect(r.lines).toEqual([])
    expect(r.sandbox.resourceGroups).toHaveLength(0)
    expect(r.events).toEqual([{ type: 'deleted', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }])
  })
})
```

Note: the line `expect(JSON.parse(out(runLine(createSandbox(), 'az version'))['azure-cli'])).toBeUndefined` is a typo — delete it; keep only the following assertion.

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/az-run.test.js` → FAIL.

- [ ] **Step 3: Implement tree.js**

```js
export function defineGroup(path, summary, children) {
  return { type: 'group', path, summary, children }
}

export function defineCommand(path, summary, { args = [], run, latencyMs = 250, examples = [] }) {
  return { type: 'command', path, summary, args, run, latencyMs, examples }
}

export const LATENCY = { read: 250, mutate: 900, group: 800, namespace: 2500 }

export const ARG = {
  resourceGroup: { name: '--resource-group', aliases: ['-g'], required: true, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Name of resource group. You can configure the default group using `az configure --defaults group=<name>`.' },
  resourceGroupOptional: { name: '--resource-group', aliases: ['-g'], required: false, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Name of resource group. You can configure the default group using `az configure --defaults group=<name>`.' },
  name: (help) => ({ name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help }),
  namespace: { name: '--namespace-name', aliases: [], required: true, kind: 'string', dest: 'namespace', help: 'Name of Namespace.' },
  topic: { name: '--topic-name', aliases: [], required: true, kind: 'string', dest: 'topic', help: 'Name of Topic.' },
  subscription: { name: '--subscription-name', aliases: [], required: true, kind: 'string', dest: 'subscription', help: 'Name of Subscription.' },
  location: (required) => ({ name: '--location', aliases: ['-l'], required, kind: 'string', dest: 'location', defaultsKey: 'location', help: 'Location. Values from: `az account list-locations`. You can configure the default location using `az configure --defaults location=<location>`.' }),
  tags: { name: '--tags', aliases: [], required: false, kind: 'list', dest: 'tags', help: 'Space-separated tags: key[=value] [key[=value] ...]. Use "" to clear existing tags.' },
  yes: { name: '--yes', aliases: ['-y'], required: false, kind: 'flag', dest: 'yes', help: 'Do not prompt for confirmation.' },
  noWait: { name: '--no-wait', aliases: [], required: false, kind: 'flag', dest: 'noWait', help: 'Do not wait for the long-running operation to finish.' },
}

export function event(type, resourceType, fields) {
  return { type, resourceType, ...fields }
}
```

- [ ] **Step 4: Implement arm.js (ARM-shaped presenters)**

```js
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME, TENANT_ID, USER_NAME } from '../sandbox/model.js'

const SUB = `/subscriptions/${SUBSCRIPTION_ID}`

export function presentResourceGroup(rg) {
  return {
    id: `${SUB}/resourceGroups/${rg.name}`,
    location: rg.location,
    managedBy: null,
    name: rg.name,
    properties: { provisioningState: 'Succeeded' },
    tags: rg.tags,
    type: 'Microsoft.Resources/resourceGroups',
  }
}

function nsId(ns) {
  return `${SUB}/resourceGroups/${ns.resourceGroup}/providers/Microsoft.ServiceBus/namespaces/${ns.name}`
}

export function presentNamespace(ns) {
  return {
    alternateName: null,
    createdAt: ns.createdAt,
    disableLocalAuth: false,
    encryption: null,
    id: nsId(ns),
    identity: null,
    location: ns.location,
    metricId: `${SUBSCRIPTION_ID}:${ns.name}`,
    minimumTlsVersion: '1.2',
    name: ns.name,
    premiumMessagingPartitions: ns.sku === 'Premium' ? 1 : 0,
    privateEndpointConnections: null,
    provisioningState: 'Succeeded',
    publicNetworkAccess: 'Enabled',
    resourceGroup: ns.resourceGroup,
    serviceBusEndpoint: `https://${ns.name}.servicebus.windows.net:443/`,
    sku: { capacity: ns.sku === 'Premium' ? 1 : null, name: ns.sku, tier: ns.sku },
    status: 'Active',
    tags: ns.tags ?? {},
    type: 'Microsoft.ServiceBus/Namespaces',
    updatedAt: ns.createdAt,
    zoneRedundant: ns.sku === 'Premium',
  }
}

const ZERO_COUNTS = { activeMessageCount: 0, deadLetterMessageCount: 0, scheduledMessageCount: 0, transferDeadLetterMessageCount: 0, transferMessageCount: 0 }

export function presentQueue(q, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    countDetails: { ...ZERO_COUNTS },
    createdAt: q.createdAt,
    deadLetteringOnMessageExpiration: q.deadLetteringOnMessageExpiration,
    defaultMessageTimeToLive: q.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: q.duplicateDetectionHistoryTimeWindow,
    enableBatchedOperations: q.enableBatchedOperations,
    enableExpress: false,
    enablePartitioning: q.enablePartitioning,
    forwardDeadLetteredMessagesTo: null,
    forwardTo: null,
    id: `${nsId(ns)}/queues/${q.name}`,
    location: ns.location,
    lockDuration: q.lockDuration,
    maxDeliveryCount: q.maxDeliveryCount,
    maxMessageSizeInKilobytes: ns.sku === 'Premium' ? 1024 : 256,
    maxSizeInMegabytes: q.maxSizeInMegabytes,
    messageCount: 0,
    name: q.name,
    requiresDuplicateDetection: q.requiresDuplicateDetection,
    requiresSession: q.requiresSession,
    resourceGroup: ns.resourceGroup,
    sizeInBytes: 0,
    status: q.status,
    type: 'Microsoft.ServiceBus/namespaces/queues',
    updatedAt: q.createdAt,
  }
}

export function presentTopic(t, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    countDetails: { ...ZERO_COUNTS },
    createdAt: t.createdAt,
    defaultMessageTimeToLive: t.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: t.duplicateDetectionHistoryTimeWindow,
    enableBatchedOperations: t.enableBatchedOperations,
    enableExpress: false,
    enablePartitioning: t.enablePartitioning,
    id: `${nsId(ns)}/topics/${t.name}`,
    location: ns.location,
    maxMessageSizeInKilobytes: ns.sku === 'Premium' ? 1024 : 256,
    maxSizeInMegabytes: t.maxSizeInMegabytes,
    name: t.name,
    requiresDuplicateDetection: t.requiresDuplicateDetection,
    resourceGroup: ns.resourceGroup,
    sizeInBytes: 0,
    status: t.status,
    subscriptionCount: t.subscriptions.length,
    supportOrdering: t.supportOrdering,
    type: 'Microsoft.ServiceBus/namespaces/topics',
    updatedAt: t.createdAt,
  }
}

export function presentSubscription(s, t, ns) {
  return {
    accessedAt: '0001-01-01T00:00:00+00:00',
    autoDeleteOnIdle: 'P10675199DT2H48M5.4775807S',
    clientAffineProperties: null,
    countDetails: { ...ZERO_COUNTS },
    createdAt: s.createdAt,
    deadLetteringOnFilterEvaluationExceptions: s.deadLetteringOnFilterEvaluationExceptions,
    deadLetteringOnMessageExpiration: s.deadLetteringOnMessageExpiration,
    defaultMessageTimeToLive: s.defaultMessageTimeToLive,
    duplicateDetectionHistoryTimeWindow: null,
    enableBatchedOperations: s.enableBatchedOperations,
    forwardDeadLetteredMessagesTo: null,
    forwardTo: null,
    id: `${nsId(ns)}/topics/${t.name}/subscriptions/${s.name}`,
    isClientAffine: false,
    location: ns.location,
    lockDuration: s.lockDuration,
    maxDeliveryCount: s.maxDeliveryCount,
    messageCount: 0,
    name: s.name,
    requiresSession: s.requiresSession,
    resourceGroup: ns.resourceGroup,
    status: s.status,
    type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions',
    updatedAt: s.createdAt,
  }
}

export function presentRule(r, s, t, ns) {
  return {
    action: {},
    correlationFilter: r.filterType === 'CorrelationFilter' ? { ...r.correlationFilter, requiresPreprocessing: true } : null,
    filterType: r.filterType,
    id: `${nsId(ns)}/topics/${t.name}/subscriptions/${s.name}/rules/${r.name}`,
    location: ns.location,
    name: r.name,
    resourceGroup: ns.resourceGroup,
    sqlFilter: r.filterType === 'SqlFilter' ? { compatibilityLevel: 20, requiresPreprocessing: false, sqlExpression: r.sqlExpression } : null,
    type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules',
  }
}

export function presentAccount() {
  return {
    environmentName: 'AzureCloud',
    homeTenantId: TENANT_ID,
    id: SUBSCRIPTION_ID,
    isDefault: true,
    managedByTenants: [],
    name: SUBSCRIPTION_NAME,
    state: 'Enabled',
    tenantId: TENANT_ID,
    user: { name: USER_NAME, type: 'user' },
  }
}
```

- [ ] **Step 5: Implement commands/misc.js, account.js, configure.js, group.js**

`src/lib/az/commands/misc.js`:

```js
import { defineCommand, LATENCY } from '../tree.js'

export const BANNER = String.raw`
     /\
    /  \    _____   _ _  ___ _
   / /\ \  |_  / | | | \'__/ _\
  / ____ \  / /| |_| | | |  __/
 /_/    \_\/___|\__,_|_|  \___|


Welcome to the cool new Azure CLI!

Use ` + '`az --version`' + ` to display the current version.
Here are the base commands:
`

export const VERSION_JSON = { 'azure-cli': '2.78.0', 'azure-cli-core': '2.78.0', 'azure-cli-telemetry': '1.1.0', extensions: {} }

export const VERSION_TEXT = `azure-cli                         2.78.0

core                              2.78.0
telemetry                          1.1.0

Dependencies:
msal                            1.34.0
azure-mgmt-resource             23.4.0

Python location '/usr/bin/python3.12'
Config directory '/home/user/.azure'
Extensions directory '/home/user/.azure/cliextensions'

Python (Linux) 3.12.3

Legal docs and information: aka.ms/AzureCliLegal


Your CLI is up-to-date.`

export const versionCommand = defineCommand(['version'], 'Show the versions of Azure CLI modules and extensions in JSON format by default or format configured by --output.', {
  latencyMs: LATENCY.read,
  run: ({ sandbox }) => ({ sandbox, output: VERSION_JSON }),
})
```

`src/lib/az/commands/account.js`:

```js
import { defineGroup, defineCommand, LATENCY } from '../tree.js'
import { presentAccount } from '../arm.js'

export const loginCommand = defineCommand(['login'], 'Log in to Azure.', {
  latencyMs: LATENCY.read,
  run: ({ sandbox }) => ({ sandbox, output: [presentAccount()] }),
})

export const accountGroup = defineGroup(['account'], 'Manage Azure subscription information.', {
  show: defineCommand(['account', 'show'], 'Get the details of a subscription.', {
    latencyMs: LATENCY.read,
    run: ({ sandbox }) => ({ sandbox, output: presentAccount() }),
  }),
  list: defineCommand(['account', 'list'], 'Get a list of subscriptions for the logged in account.', {
    latencyMs: LATENCY.read,
    run: ({ sandbox }) => ({ sandbox, output: [presentAccount()] }),
  }),
})
```

`src/lib/az/commands/configure.js`:

```js
import { defineCommand, LATENCY } from '../tree.js'
import { setDefaults } from '../../sandbox/ops.js'
import { AzError } from '../../sandbox/errors.js'

export const configureCommand = defineCommand(['configure'], 'Manage Azure CLI configuration. This command is interactive.', {
  latencyMs: LATENCY.read,
  args: [
    { name: '--defaults', aliases: ['-d'], required: false, kind: 'list', dest: 'defaults', help: "Space-separated 'name=value' pairs for common argument defaults." },
    { name: '--list-defaults', aliases: ['-l'], required: false, kind: 'flag', dest: 'listDefaults', help: 'List all applicable defaults.' },
    { name: '--scope', aliases: [], required: false, kind: 'string', choices: ['global', 'local'], dest: 'scope', help: 'Scope of defaults. Using "local" for settings only effective under current folder.' },
  ],
  run: ({ sandbox }, values) => {
    if (values.listDefaults) {
      const output = Object.entries(sandbox.defaults).filter(([, v]) => v).map(([name, value]) => ({ name, source: 'sandbox', value }))
      return { sandbox, output }
    }
    if (values.defaults) {
      const allowed = ['group', 'location']
      const bad = Object.keys(values.defaults).find((k) => !allowed.includes(k))
      if (bad) throw new AzError('InvalidArgumentValue', `Unsupported default '${bad}' in the Sandbox. Supported: ${allowed.join(', ')}.`, { kind: 'cli' })
      return { sandbox: setDefaults(sandbox, values.defaults).sandbox, output: null }
    }
    throw new AzError('Interactive', 'Interactive configuration is not available in the Sandbox Cloud Shell. Use `az configure --defaults group=<name> location=<location>` or `az configure --list-defaults`.', { kind: 'cli' })
  },
})
```

`src/lib/az/commands/group.js`:

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentResourceGroup } from '../arm.js'
import { AzError } from '../../sandbox/errors.js'

const GROUP_NAME = { name: '--name', aliases: ['-n', '--resource-group', '-g'], required: true, kind: 'string', dest: 'name', help: 'Name of the new resource group.' }

export const groupGroup = defineGroup(['group'], 'Manage resource groups and template deployments.', {
  create: defineCommand(['group', 'create'], 'Create a new resource group.', {
    latencyMs: LATENCY.group,
    args: [GROUP_NAME, ARG.location(true), ARG.tags],
    examples: [{ summary: 'Create a new resource group in the West US region.', command: 'az group create -l westus -n MyResourceGroup' }],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.createResourceGroup(sandbox, { name: v.name, location: v.location, tags: v.tags ?? null })
      return { sandbox: next, output: presentResourceGroup(resource), events: [event('created', 'resourceGroup', { name: resource.name, resourceGroup: resource.name })] }
    },
  }),
  show: defineCommand(['group', 'show'], 'Gets a resource group.', {
    args: [GROUP_NAME],
    run: ({ sandbox }, v) => ({ sandbox, output: presentResourceGroup(ops.getResourceGroup(sandbox, v.name)) }),
  }),
  list: defineCommand(['group', 'list'], 'List resource groups.', {
    run: ({ sandbox }) => ({ sandbox, output: ops.listResourceGroups(sandbox).map(presentResourceGroup) }),
  }),
  exists: defineCommand(['group', 'exists'], 'Check the existence of a resource group.', {
    args: [GROUP_NAME],
    run: ({ sandbox }, v) => ({ sandbox, output: sandbox.resourceGroups.some((g) => g.name.toLowerCase() === v.name.toLowerCase()) ? 'true' : 'false' }),
  }),
  delete: defineCommand(['group', 'delete'], 'Delete a resource group.', {
    latencyMs: LATENCY.mutate,
    args: [GROUP_NAME, ARG.yes, ARG.noWait],
    run: ({ sandbox }, v) => {
      ops.getResourceGroup(sandbox, v.name)
      if (!v.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
      const { sandbox: next } = ops.deleteResourceGroup(sandbox, { name: v.name })
      return { sandbox: next, output: null, events: [event('deleted', 'resourceGroup', { name: v.name, resourceGroup: v.name })] }
    },
  }),
})
```

- [ ] **Step 6: Implement commands/index.js (Service Bus groups are added in Tasks 6–7; import them now as empty placeholders so the tree builds)**

Create `src/lib/az/commands/servicebus.js` placeholder that Tasks 6–7 will fill:

```js
import { defineGroup } from '../tree.js'

export const servicebusGroup = defineGroup(['servicebus'], 'Manage Azure Service Bus namespaces, queues, topics, subscriptions, rules and geo-disaster recovery configuration alias.', {})
```

`src/lib/az/commands/index.js`:

```js
import { defineGroup } from '../tree.js'
import { versionCommand } from './misc.js'
import { accountGroup, loginCommand } from './account.js'
import { configureCommand } from './configure.js'
import { groupGroup } from './group.js'
import { servicebusGroup } from './servicebus.js'

let cached = null

export function buildTree() {
  if (cached) return cached
  cached = defineGroup([], 'Azure CLI (Sandbox)', {
    account: accountGroup,
    configure: configureCommand,
    group: groupGroup,
    login: loginCommand,
    servicebus: servicebusGroup,
    version: versionCommand,
  })
  return cached
}
```

- [ ] **Step 7: Implement run.js and shell.js**

`src/lib/az/run.js`:

```js
import { buildTree } from './commands/index.js'
import { parseArgs, HELP_FLAGS } from './args.js'
import { toAzJson } from './format.js'
import { renderCommandHelp, renderGroupHelp } from './help.js'
import { AzError } from '../sandbox/errors.js'
import { BANNER, VERSION_TEXT } from './commands/misc.js'

function similar(word, candidates) {
  const w = word.toLowerCase()
  return candidates.filter((c) => {
    const d = levenshtein(w, c.toLowerCase())
    return d <= Math.max(1, Math.floor(c.length / 3))
  })
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

function formatError(e) {
  if (e instanceof AzError && e.kind === 'arm') return `(${e.code}) ${e.message}\nCode: ${e.code}\nMessage: ${e.message}`
  return e.message
}

function bannerText(root) {
  const width = Math.max(...Object.keys(root.children).map((k) => k.length)) + 4
  const rows = Object.entries(root.children).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `    ${k.padEnd(width)}: ${n.summary}`)
  return `${BANNER}${rows.join('\n')}\n`
}

// tokens: argv after the leading "az"
export function runAz(sandbox, tokens) {
  const root = buildTree()
  const out = (text) => ({ text, kind: 'out' })
  const err = (text) => ({ text, kind: 'err' })

  if (tokens.length === 0) return { sandbox, lines: [out(bannerText(root))], events: [], latencyMs: 0 }
  if (tokens.length === 1 && tokens[0] === '--version') return { sandbox, lines: [out(VERSION_TEXT)], events: [], latencyMs: 250 }
  if (tokens.length === 1 && HELP_FLAGS.includes(tokens[0])) return { sandbox, lines: [out(renderGroupHelp(root))], events: [], latencyMs: 0 }

  let node = root
  let i = 0
  while (i < tokens.length && node.type === 'group') {
    const tok = tokens[i]
    if (HELP_FLAGS.includes(tok)) return { sandbox, lines: [out(renderGroupHelp(node))], events: [], latencyMs: 0 }
    const child = node.children[tok]
    if (!child) {
      const suggestions = similar(tok, Object.keys(node.children))
      let msg = `'${tok}' is misspelled or not recognized by the system.`
      if (suggestions.length === 1) msg += `\nThe most similar choice to '${tok}' is:\n        ${suggestions[0]}`
      else if (suggestions.length > 1) msg += `\nThe most similar choices to '${tok}' are:\n${suggestions.map((s) => `        ${s}`).join('\n')}`
      return { sandbox, lines: [err(msg)], events: [], latencyMs: 0 }
    }
    node = child
    i++
  }
  if (node.type === 'group') return { sandbox, lines: [out(renderGroupHelp(node))], events: [], latencyMs: 0 }

  const { values, error, wantsHelp } = parseArgs(node.args, tokens.slice(i), sandbox.defaults)
  if (wantsHelp) return { sandbox, lines: [out(renderCommandHelp(node))], events: [], latencyMs: 0 }
  if (error) return { sandbox, lines: [err(error)], events: [], latencyMs: 0 }

  try {
    const result = node.run({ sandbox }, values)
    const lines = []
    if (result.output !== null && result.output !== undefined) {
      lines.push(out(typeof result.output === 'string' ? result.output : toAzJson(result.output)))
    }
    return { sandbox: result.sandbox ?? sandbox, lines, events: result.events ?? [], latencyMs: node.latencyMs }
  } catch (e) {
    if (e instanceof AzError) return { sandbox, lines: [err(formatError(e))], events: [], latencyMs: Math.min(node.latencyMs, 600) }
    throw e
  }
}
```

`src/lib/az/shell.js`:

```js
import { tokenize } from './tokenize.js'
import { runAz } from './run.js'

const EMPTY = (sandbox) => ({ sandbox, lines: [], events: [], latencyMs: 0, clear: false })

export function runLine(sandbox, line) {
  const { tokens, error } = tokenize(line)
  if (error) return { ...EMPTY(sandbox), lines: [{ text: `bash: ${error}`, kind: 'err' }] }
  if (tokens.length === 0) return EMPTY(sandbox)
  const [cmd, ...rest] = tokens
  if (cmd === 'clear') return { ...EMPTY(sandbox), clear: true }
  if (cmd === 'az') return { ...runAz(sandbox, rest), clear: false }
  return { ...EMPTY(sandbox), lines: [{ text: `bash: ${cmd}: command not found`, kind: 'err' }] }
}
```

- [ ] **Step 8: Run tests**

`npx vitest run tests/az-run.test.js` → all PASS (the `az servicebus` group test passes because the placeholder group exists). Then `npx vitest run` → whole suite green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(az): command tree, runner with az-style errors/help, shell dispatcher, group/account/configure/version commands"
```

---

### Task 6: `az servicebus namespace` and `az servicebus queue`

**Files:**
- Create: `src/lib/az/commands/servicebus-namespace.js`, `src/lib/az/commands/servicebus-queue.js`
- Modify: `src/lib/az/commands/servicebus.js` (register children `namespace`, `queue`)
- Test: `tests/az-servicebus-namespace.test.js`, `tests/az-servicebus-queue.test.js`

**Interfaces:**
- Consumes: `defineGroup/defineCommand/ARG/LATENCY/event` (Task 5), ops and presenters (Tasks 3, 5).
- Produces: groups `namespaceGroup` (path `['servicebus','namespace']`, commands create/show/list/update/delete/exists) and `queueGroup` (`['servicebus','queue']`, create/show/list/update/delete). Events: `created|updated|deleted` for `namespace` (fields `name, resourceGroup`) and `queue` (fields `name, resourceGroup, namespace`).

- [ ] **Step 1: Failing tests**

`tests/az-servicebus-namespace.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
const withGroup = () => runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox

describe('az servicebus namespace', () => {
  it('create with defaults', () => {
    const r = runLine(withGroup(), 'az servicebus namespace create --resource-group rg-orders --name sb-contoso-orders')
    expect(err(r)).toBe('')
    expect(r.latencyMs).toBe(2500)
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ name: 'sb-contoso-orders', location: 'westeurope', resourceGroup: 'rg-orders', sku: { name: 'Standard', tier: 'Standard' }, serviceBusEndpoint: 'https://sb-contoso-orders.servicebus.windows.net:443/', status: 'Active' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }])
  })
  it('create with --sku and --location, invalid sku', () => {
    const r = runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic -l northeurope')
    expect(JSON.parse(out(r))).toMatchObject({ sku: { name: 'Basic' }, location: 'northeurope' })
    expect(err(runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Gold'))).toBe("argument --sku: invalid choice: 'Gold' (choose from 'Basic', 'Premium', 'Standard')")
  })
  it('uses the configured default group', () => {
    let sb = withGroup()
    sb = runLine(sb, 'az configure --defaults group=rg-orders').sandbox
    const r = runLine(sb, 'az servicebus namespace create -n sb-contoso-orders')
    expect(err(r)).toBe('')
    expect(r.sandbox.namespaces[0].resourceGroup).toBe('rg-orders')
  })
  it('requires args and reports missing group', () => {
    expect(err(runLine(withGroup(), 'az servicebus namespace create -n sb-contoso-orders'))).toBe('the following arguments are required: --resource-group/-g')
    expect(err(runLine(withGroup(), 'az servicebus namespace create -g rg-x -n sb-contoso-orders'))).toContain("(ResourceGroupNotFound) Resource group 'rg-x' could not be found.")
  })
  it('show / list / exists / update / delete', () => {
    let sb = runLine(withGroup(), 'az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku Basic').sandbox
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace show -g rg-orders -n sb-contoso-orders'))).name).toBe('sb-contoso-orders')
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace list')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace list -g rg-orders')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace exists -n sb-contoso-orders')))).toEqual({ message: null, nameAvailable: false, reason: 'NameInUse' })
    expect(JSON.parse(out(runLine(sb, 'az servicebus namespace exists -n sb-other-name')))).toEqual({ message: null, nameAvailable: true, reason: null })
    const u = runLine(sb, 'az servicebus namespace update -g rg-orders -n sb-contoso-orders --sku Standard')
    expect(JSON.parse(out(u)).sku.name).toBe('Standard')
    expect(u.events).toEqual([{ type: 'updated', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }])
    const d = runLine(u.sandbox, 'az servicebus namespace delete -g rg-orders -n sb-contoso-orders')
    expect(d.lines).toEqual([])
    expect(d.sandbox.namespaces).toHaveLength(0)
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'namespace' })
  })
  it('has help', () => {
    expect(out(runLine(createSandbox(), 'az servicebus namespace create --help'))).toContain('--sku')
  })
})
```

`tests/az-servicebus-queue.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
function withNamespace(sku = 'Standard') {
  let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
  return runLine(sb, `az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku ${sku}`).sandbox
}
const Q = 'az servicebus queue'

describe('az servicebus queue', () => {
  it('create with the Lab flags', () => {
    const r = runLine(withNamespace(), `${Q} create --resource-group rg-orders --namespace-name sb-contoso-orders --name orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true`)
    expect(err(r)).toBe('')
    expect(r.latencyMs).toBe(900)
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ name: 'orders', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, maxSizeInMegabytes: 1024, messageCount: 0, requiresSession: false, resourceGroup: 'rg-orders', status: 'Active', type: 'Microsoft.ServiceBus/namespaces/queues' })
    expect(j.countDetails).toEqual({ activeMessageCount: 0, deadLetterMessageCount: 0, scheduledMessageCount: 0, transferDeadLetterMessageCount: 0, transferMessageCount: 0 })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
  })
  it('missing --namespace-name is reported exactly like the design transcript', () => {
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --name orders`))).toBe('the following arguments are required: --namespace-name')
  })
  it('bool and int validation, unknown namespace', () => {
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count five`))).toBe("argument --max-delivery-count: invalid int value: 'five'")
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders --enable-dead-lettering-on-message-expiration yes`))).toBe("argument --enable-dead-lettering-on-message-expiration: invalid choice: 'yes' (choose from 'false', 'true')")
    expect(err(runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-nope -n orders`))).toContain("(ResourceNotFound) The Resource 'Microsoft.ServiceBus/namespaces/sb-nope' under resource group 'rg-orders' was not found.")
  })
  it('other flags map to properties', () => {
    const r = runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n q2 --lock-duration PT30S --default-message-time-to-live P14D --max-size 2048 --enable-session true --enable-partitioning false --enable-duplicate-detection true --duplicate-detection-history-time-window PT20M --status Disabled`)
    expect(JSON.parse(out(r))).toMatchObject({ lockDuration: 'PT30S', defaultMessageTimeToLive: 'P14D', maxSizeInMegabytes: 2048, requiresSession: true, enablePartitioning: false, requiresDuplicateDetection: true, duplicateDetectionHistoryTimeWindow: 'PT20M', status: 'Disabled' })
  })
  it('show / list / update / delete', () => {
    let sb = runLine(withNamespace(), `${Q} create -g rg-orders --namespace-name sb-contoso-orders -n orders`).sandbox
    expect(JSON.parse(out(runLine(sb, `${Q} show -g rg-orders --namespace-name sb-contoso-orders -n orders`))).maxDeliveryCount).toBe(10)
    expect(JSON.parse(out(runLine(sb, `${Q} list -g rg-orders --namespace-name sb-contoso-orders`)))).toHaveLength(1)
    const u = runLine(sb, `${Q} update -g rg-orders --namespace-name sb-contoso-orders -n orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true`)
    expect(JSON.parse(out(u))).toMatchObject({ maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true })
    expect(u.events[0]).toMatchObject({ type: 'updated', resourceType: 'queue', name: 'orders' })
    const d = runLine(u.sandbox, `${Q} delete -g rg-orders --namespace-name sb-contoso-orders -n orders`)
    expect(d.lines).toEqual([])
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'queue', name: 'orders' })
    expect(err(runLine(d.sandbox, `${Q} show -g rg-orders --namespace-name sb-contoso-orders -n orders`))).toContain("(NotFound) Entity 'sb-contoso-orders:Queue:orders' was not found.")
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/az-servicebus-namespace.test.js tests/az-servicebus-queue.test.js` → FAIL (`'namespace' is misspelled…`).

- [ ] **Step 3: Implement servicebus-namespace.js**

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentNamespace } from '../arm.js'

const NAME = ARG.name('Name of Namespace.')
const SKU = { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['Basic', 'Premium', 'Standard'], dest: 'sku', help: 'Namespace SKU.', defaultValue: 'Standard' }
const CAPACITY = { name: '--capacity', aliases: [], required: false, kind: 'int', dest: 'capacity', help: 'Number of message units. This property is only applicable to namespaces of Premium SKU.' }

const nsEvent = (type, ns) => event(type, 'namespace', { name: ns.name, resourceGroup: ns.resourceGroup })

export const namespaceGroup = defineGroup(['servicebus', 'namespace'], 'Manage Azure Service Bus Namespace.', {
  create: defineCommand(['servicebus', 'namespace', 'create'], 'Create a Service Bus Namespace.', {
    latencyMs: LATENCY.namespace,
    args: [NAME, ARG.resourceGroup, ARG.location(false), SKU, CAPACITY, ARG.tags],
    examples: [{ summary: 'Create a Service Bus Namespace.', command: 'az servicebus namespace create --resource-group myresourcegroup --name mynamespace --location westus --tags tag1=value1 tag2=value2 --sku Standard' }],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.createNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name, location: v.location, sku: v.sku ?? 'Standard', tags: v.tags ?? null })
      return { sandbox: next, output: presentNamespace(resource), events: [nsEvent('created', resource)] }
    },
  }),
  show: defineCommand(['servicebus', 'namespace', 'show'], 'Get a description for the specified namespace.', {
    args: [NAME, ARG.resourceGroup],
    run: ({ sandbox }, v) => ({ sandbox, output: presentNamespace(ops.getNamespace(sandbox, v.resourceGroup, v.name)) }),
  }),
  list: defineCommand(['servicebus', 'namespace', 'list'], 'List all the available namespaces within the subscription by resource group & default.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, v) => ({ sandbox, output: ops.listNamespaces(sandbox, v.resourceGroup ?? null).map(presentNamespace) }),
  }),
  exists: defineCommand(['servicebus', 'namespace', 'exists'], 'Check the give namespace name availability.', {
    args: [NAME],
    run: ({ sandbox }, v) => {
      const taken = sandbox.namespaces.some((n) => n.name.toLowerCase() === v.name.toLowerCase())
      return { sandbox, output: taken ? { message: null, nameAvailable: false, reason: 'NameInUse' } : { message: null, nameAvailable: true, reason: null } }
    },
  }),
  update: defineCommand(['servicebus', 'namespace', 'update'], 'Update a service namespace.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.resourceGroup, SKU, CAPACITY, ARG.tags],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.updateNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name, sku: v.sku, tags: v.tags })
      return { sandbox: next, output: presentNamespace(resource), events: [nsEvent('updated', resource)] }
    },
  }),
  delete: defineCommand(['servicebus', 'namespace', 'delete'], 'Delete an existing namespace. This operation also removes all associated resources under the namespace.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.resourceGroup, ARG.noWait],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.name)
      const { sandbox: next } = ops.deleteNamespace(sandbox, { resourceGroup: v.resourceGroup, name: v.name })
      return { sandbox: next, output: null, events: [nsEvent('deleted', ns)] }
    },
  }),
})
```

- [ ] **Step 4: Implement servicebus-queue.js**

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentQueue } from '../arm.js'

const NAME = ARG.name('Name of Queue.')
const STATUS = { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' }

export const QUEUE_PROPERTY_ARGS = [
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'The maximum delivery count. A message is automatically deadlettered after this number of deliveries.', defaultValue: 10 },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'A value that indicates whether this queue has dead letter support when a message expires.' },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8601 default message timespan to live value. This is the duration after which the message expires, starting from when the message is sent to Service Bus.' },
  { name: '--lock-duration', aliases: [], required: false, kind: 'string', dest: 'lockDuration', help: 'ISO 8601 timespan duration of a peek-lock; that is, the amount of time that the message is locked for other receivers. The maximum value for LockDuration is 5 minutes; the default value is 1 minute.' },
  { name: '--max-size', aliases: [], required: false, kind: 'int', dest: 'maxSizeInMegabytes', help: 'The maximum size of the queue in megabytes, which is the size of memory allocated for the queue.', defaultValue: 1024 },
  { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'A value that indicates whether the queue supports the concept of sessions.' },
  { name: '--enable-partitioning', aliases: [], required: false, kind: 'bool', dest: 'enablePartitioning', help: 'A value that indicates whether the queue is to be partitioned across multiple message brokers.' },
  { name: '--enable-duplicate-detection', aliases: [], required: false, kind: 'bool', dest: 'requiresDuplicateDetection', help: 'A value indicating if this queue requires duplicate detection.' },
  { name: '--duplicate-detection-history-time-window', aliases: [], required: false, kind: 'string', dest: 'duplicateDetectionHistoryTimeWindow', help: 'ISO 8601 timeSpan structure that defines the duration of the duplicate detection history. The default value is 10 minutes.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  STATUS,
]

const PROPERTY_KEYS = QUEUE_PROPERTY_ARGS.map((a) => a.dest)

function props(v) {
  return Object.fromEntries(PROPERTY_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
}

const qEvent = (type, v) => event(type, 'queue', { name: v.name, resourceGroup: v.resourceGroup, namespace: v.namespace })

export const queueGroup = defineGroup(['servicebus', 'queue'], 'Manage Azure Service Bus Queue and Authorization Rule.', {
  create: defineCommand(['servicebus', 'queue', 'create'], 'Create the Service Bus Queue.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup, ...QUEUE_PROPERTY_ARGS],
    examples: [{ summary: 'Create a Service Bus Queue with dead-lettering on message expiration.', command: 'az servicebus queue create --resource-group myresourcegroup --namespace-name mynamespace --name myqueue --enable-dead-lettering-on-message-expiration true' }],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const { sandbox: next, resource } = ops.createQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentQueue(resource, ns), events: [qEvent('created', v)] }
    },
  }),
  show: defineCommand(['servicebus', 'queue', 'show'], 'Get a description for the specified queue.', {
    args: [NAME, ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => ({ sandbox, output: presentQueue(ops.getQueue(sandbox, v.resourceGroup, v.namespace, v.name), ops.getNamespace(sandbox, v.resourceGroup, v.namespace)) }),
  }),
  list: defineCommand(['servicebus', 'queue', 'list'], 'List the queues within a namespace.', {
    args: [ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      return { sandbox, output: ops.listQueues(sandbox, v.resourceGroup, v.namespace).map((q) => presentQueue(q, ns)) }
    },
  }),
  update: defineCommand(['servicebus', 'queue', 'update'], 'Update the Service Bus Queue.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup, ...QUEUE_PROPERTY_ARGS],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const { sandbox: next, resource } = ops.updateQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentQueue(resource, ns), events: [qEvent('updated', v)] }
    },
  }),
  delete: defineCommand(['servicebus', 'queue', 'delete'], 'Delete a queue from the specified namespace in a resource group.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const { sandbox: next } = ops.deleteQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name })
      return { sandbox: next, output: null, events: [qEvent('deleted', v)] }
    },
  }),
})
```

- [ ] **Step 5: Register in servicebus.js**

```js
import { defineGroup } from '../tree.js'
import { namespaceGroup } from './servicebus-namespace.js'
import { queueGroup } from './servicebus-queue.js'

export const servicebusGroup = defineGroup(['servicebus'], 'Manage Azure Service Bus namespaces, queues, topics, subscriptions, rules and geo-disaster recovery configuration alias.', {
  namespace: namespaceGroup,
  queue: queueGroup,
})
```

- [ ] **Step 6: Run tests, whole suite**

`npx vitest run` → all PASS. (Note the choices order in the sku error is alphabetical `'Basic', 'Premium', 'Standard'` because `choices` is declared in that order; the Task 3 ops error is only hit when ops are called directly.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(az): servicebus namespace and queue command groups"
```

---

### Task 7: `az servicebus topic`, `topic subscription`, `topic subscription rule`

**Files:**
- Create: `src/lib/az/commands/servicebus-topic.js`, `src/lib/az/commands/servicebus-subscription.js`, `src/lib/az/commands/servicebus-rule.js`
- Modify: `src/lib/az/commands/servicebus.js` (register `topic`, nest `subscription` under topic and `rule` under subscription)
- Test: `tests/az-servicebus-topic.test.js`

**Interfaces:**
- Produces: `topicGroup` (`['servicebus','topic']`: create/show/list/delete + child group `subscription`), `subscriptionGroup` (`['servicebus','topic','subscription']`: create/show/list/delete + child group `rule`), `ruleGroup` (`['servicebus','topic','subscription','rule']`: create/show/list/delete). Events: `topic` (`name, resourceGroup, namespace`), `subscription` (`+ topic`), `rule` (`+ topic, subscription`).

- [ ] **Step 1: Failing tests**

`tests/az-servicebus-topic.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (r) => r.lines.filter((l) => l.kind === 'out').map((l) => l.text).join('\n')
const err = (r) => r.lines.filter((l) => l.kind === 'err').map((l) => l.text).join('\n')
function withNamespace(sku = 'Standard') {
  let sb = runLine(createSandbox(), 'az group create -n rg-orders -l westeurope').sandbox
  return runLine(sb, `az servicebus namespace create -g rg-orders -n sb-contoso-orders --sku ${sku}`).sandbox
}
const T = 'az servicebus topic'
const BASE = '-g rg-orders --namespace-name sb-contoso-orders'

describe('az servicebus topic', () => {
  it('create / Basic tier error / missing namespace-name (design transcript)', () => {
    const r = runLine(withNamespace(), `${T} create ${BASE} --name order-events`)
    expect(err(r)).toBe('')
    expect(JSON.parse(out(r))).toMatchObject({ name: 'order-events', subscriptionCount: 0, status: 'Active', type: 'Microsoft.ServiceBus/namespaces/topics' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'topic', name: 'order-events', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }])
    expect(err(runLine(withNamespace('Basic'), `${T} create ${BASE} --name order-events`))).toBe("(BadRequest) SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.\nCode: BadRequest\nMessage: SubCode=40000. Cannot operate on type Topic because the namespace 'sb-contoso-orders' is using 'Basic' tier.")
    expect(err(runLine(withNamespace(), `${T} create --name order-events`))).toBe('the following arguments are required: --namespace-name, --resource-group/-g')
    expect(err(runLine(withNamespace(), `${T} create -g rg-orders --name order-events`))).toBe('the following arguments are required: --namespace-name')
  })
  it('show / list / delete', () => {
    let sb = runLine(withNamespace(), `${T} create ${BASE} -n order-events`).sandbox
    expect(JSON.parse(out(runLine(sb, `${T} show ${BASE} -n order-events`))).name).toBe('order-events')
    expect(JSON.parse(out(runLine(sb, `${T} list ${BASE}`)))).toHaveLength(1)
    const d = runLine(sb, `${T} delete ${BASE} -n order-events`)
    expect(d.lines).toEqual([])
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'topic' })
  })
})

describe('az servicebus topic subscription (+ rule)', () => {
  const S = 'az servicebus topic subscription'
  const R = 'az servicebus topic subscription rule'
  const withTopic = () => runLine(withNamespace(), `${T} create ${BASE} -n order-events`).sandbox

  it('create subscription → $Default rule; list rules', () => {
    const r = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events --name eu-orders`)
    expect(err(r)).toBe('')
    expect(JSON.parse(out(r))).toMatchObject({ name: 'eu-orders', maxDeliveryCount: 10, status: 'Active', type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'subscription', name: 'eu-orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events' }])
    const rules = JSON.parse(out(runLine(r.sandbox, `${R} list ${BASE} --topic-name order-events --subscription-name eu-orders`)))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ name: '$Default', filterType: 'SqlFilter', sqlFilter: { sqlExpression: '1=1' } })
  })
  it('rule create with SQL filter matches the design output; delete $Default with quotes', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    const r = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name eu-filter --filter-sql-expression "region = 'EU'"`)
    expect(err(r)).toBe('')
    const j = JSON.parse(out(r))
    expect(j).toMatchObject({ filterType: 'SqlFilter', name: 'eu-filter', sqlFilter: { requiresPreprocessing: false, sqlExpression: "region = 'EU'" }, type: 'Microsoft.ServiceBus/namespaces/topics/subscriptions/rules' })
    expect(r.events).toEqual([{ type: 'created', resourceType: 'rule', name: 'eu-filter', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 'order-events', subscription: 'eu-orders' }])
    const d = runLine(r.sandbox, `${R} delete ${BASE} --topic-name order-events --subscription-name eu-orders --name '$Default'`)
    expect(d.lines).toEqual([])
    expect(d.sandbox.namespaces[0].topics[0].subscriptions[0].rules.map((x) => x.name)).toEqual(['eu-filter'])
  })
  it('unquoted $Default expands to empty and fails like bash+az would', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(err(runLine(sb, `${R} delete ${BASE} --topic-name order-events --subscription-name eu-orders --name $Default`))).toBe('argument --name/-n: expected one argument')
  })
  it('SqlFilter without expression, CorrelationFilter with --correlation-id', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(err(runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name r1`))).toBe('A SqlFilter rule requires --filter-sql-expression.')
    const c = runLine(sb, `${R} create ${BASE} --topic-name order-events --subscription-name eu-orders --name r2 --filter-type CorrelationFilter --correlation-id abc --label orders`)
    expect(JSON.parse(out(c))).toMatchObject({ filterType: 'CorrelationFilter', correlationFilter: { correlationId: 'abc', label: 'orders' }, sqlFilter: null })
  })
  it('subscription show / list / delete; rule show; not-found wording', () => {
    let sb = runLine(withTopic(), `${S} create ${BASE} --topic-name order-events -n eu-orders`).sandbox
    expect(JSON.parse(out(runLine(sb, `${S} show ${BASE} --topic-name order-events -n eu-orders`))).name).toBe('eu-orders')
    expect(JSON.parse(out(runLine(sb, `${S} list ${BASE} --topic-name order-events`)))).toHaveLength(1)
    expect(JSON.parse(out(runLine(sb, `${R} show ${BASE} --topic-name order-events --subscription-name eu-orders -n '$Default'`))).name).toBe('$Default')
    expect(err(runLine(sb, `${S} show ${BASE} --topic-name order-events -n nope`))).toContain("(NotFound) Entity 'sb-contoso-orders:Topic:order-events|Subscription:nope' was not found.")
    const d = runLine(sb, `${S} delete ${BASE} --topic-name order-events -n eu-orders`)
    expect(d.events[0]).toMatchObject({ type: 'deleted', resourceType: 'subscription', name: 'eu-orders' })
    expect(JSON.parse(out(runLine(d.sandbox, `${T} show ${BASE} -n order-events`))).subscriptionCount).toBe(0)
  })
  it('help exists for nested groups', () => {
    expect(out(runLine(createSandbox(), `${R} --help`))).toContain('Group\n    az servicebus topic subscription rule')
    expect(out(runLine(createSandbox(), `${R} create -h`))).toContain('--filter-sql-expression')
  })
})
```

- [ ] **Step 2: Run to verify failure**

`npx vitest run tests/az-servicebus-topic.test.js` → FAIL.

- [ ] **Step 3: Implement servicebus-rule.js**

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentRule } from '../arm.js'

const NAME = ARG.name('Name of Rule.')
const FILTER_TYPE = { name: '--filter-type', aliases: [], required: false, kind: 'string', choices: ['CorrelationFilter', 'SqlFilter'], dest: 'filterType', help: 'Rule Filter types.', defaultValue: 'SqlFilter' }
const SQL = { name: '--filter-sql-expression', aliases: [], required: false, kind: 'string', dest: 'sqlExpression', help: 'SQL expression. e.g. myproperty=test.' }
const CORRELATION_ARGS = [
  { name: '--correlation-id', aliases: [], required: false, kind: 'string', dest: 'correlationId', help: 'Identifier of correlation.' },
  { name: '--label', aliases: [], required: false, kind: 'string', dest: 'label', help: 'Application specific label.' },
  { name: '--message-id', aliases: [], required: false, kind: 'string', dest: 'messageId', help: 'Identifier of message.' },
  { name: '--to', aliases: [], required: false, kind: 'string', dest: 'to', help: 'Address to send to.' },
  { name: '--reply-to', aliases: [], required: false, kind: 'string', dest: 'replyTo', help: 'Address of the queue to reply to.' },
  { name: '--session-id', aliases: [], required: false, kind: 'string', dest: 'sessionId', help: 'Session identifier.' },
  { name: '--content-type', aliases: [], required: false, kind: 'string', dest: 'contentType', help: 'Content type of message.' },
]
const SCOPE = [NAME, ARG.namespace, ARG.topic, ARG.subscription, ARG.resourceGroup]

function correlationFilter(v) {
  const entries = CORRELATION_ARGS.map((a) => [a.dest, v[a.dest]]).filter(([, val]) => val !== undefined)
  return entries.length ? Object.fromEntries(entries) : null
}

const rEvent = (type, v) => event(type, 'rule', { name: v.name, resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, subscription: v.subscription })

function context(sandbox, v) {
  const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
  const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
  const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription)
  return { ns, t, s }
}

export const ruleGroup = defineGroup(['servicebus', 'topic', 'subscription', 'rule'], 'Manage Azure Service Bus Rule.', {
  create: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'create'], 'Create the ServiceBus Rule for Subscription.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, FILTER_TYPE, SQL, ...CORRELATION_ARGS],
    examples: [{ summary: 'Create Rule.', command: "az servicebus topic subscription rule create --resource-group myresourcegroup --namespace-name mynamespace --topic-name mytopic --subscription-name mysubscription --name myrule --filter-sql-expression \"myproperty='test'\"" }],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.createRule(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, subscription: v.subscription, name: v.name, filterType: v.filterType ?? 'SqlFilter', sqlExpression: v.sqlExpression ?? null, correlationFilter: correlationFilter(v) })
      const { ns, t, s } = context(next, v)
      return { sandbox: next, output: presentRule(resource, s, t, ns), events: [rEvent('created', v)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'show'], 'Get the description for the specified rule.', {
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { ns, t, s } = context(sandbox, v)
      return { sandbox, output: presentRule(ops.getRule(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription, v.name), s, t, ns) }
    },
  }),
  list: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'list'], 'List all the rules within given topic-subscription.', {
    args: [ARG.namespace, ARG.topic, ARG.subscription, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const { ns, t, s } = context(sandbox, v)
      return { sandbox, output: ops.listRules(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription).map((r) => presentRule(r, s, t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'delete'], 'Delete an existing rule.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { sandbox: next } = ops.deleteRule(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, subscription: v.subscription, name: v.name })
      return { sandbox: next, output: null, events: [rEvent('deleted', v)] }
    },
  }),
})
```

- [ ] **Step 4: Implement servicebus-subscription.js**

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentSubscription } from '../arm.js'
import { ruleGroup } from './servicebus-rule.js'

const NAME = ARG.name('Name of Subscription.')
const PROPERTY_ARGS = [
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Number of maximum deliveries.', defaultValue: 10 },
  { name: '--lock-duration', aliases: [], required: false, kind: 'string', dest: 'lockDuration', help: 'ISO 8601 lock duration timespan for the subscription. The default value is 1 minute.' },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'Value that indicates whether a subscription has dead letter support when a message expires.' },
  { name: '--dead-letter-on-filter-exceptions', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnFilterEvaluationExceptions', help: 'Value that indicates whether a subscription has dead letter support on filter evaluation exceptions.' },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8061 Default message timespan to live value.' },
  { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'Value indicating if a subscription supports the concept of sessions.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' },
]
const KEYS = PROPERTY_ARGS.map((a) => a.dest)
const props = (v) => Object.fromEntries(KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
const SCOPE = [NAME, ARG.namespace, ARG.topic, ARG.resourceGroup]
const sEvent = (type, v) => event(type, 'subscription', { name: v.name, resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic })

function context(sandbox, v) {
  return { ns: ops.getNamespace(sandbox, v.resourceGroup, v.namespace), t: ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic) }
}

export const subscriptionGroup = defineGroup(['servicebus', 'topic', 'subscription'], 'Manage Azure Service Bus Subscription.', {
  create: defineCommand(['servicebus', 'topic', 'subscription', 'create'], 'Create the ServiceBus Subscription.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, ...PROPERTY_ARGS],
    examples: [{ summary: 'Create a new Subscription.', command: 'az servicebus topic subscription create --resource-group myresourcegroup --namespace-name mynamespace --topic-name mytopic --name mysubscription' }],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.createSubscription(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, name: v.name, ...props(v) })
      const { ns, t } = context(next, v)
      return { sandbox: next, output: presentSubscription(resource, t, ns), events: [sEvent('created', v)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'subscription', 'show'], 'Get a subscription description for the specified topic.', {
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      return { sandbox, output: presentSubscription(ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.name), t, ns) }
    },
  }),
  list: defineCommand(['servicebus', 'topic', 'subscription', 'list'], 'List all the subscriptions under a specified topic.', {
    args: [ARG.namespace, ARG.topic, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      return { sandbox, output: ops.listSubscriptions(sandbox, v.resourceGroup, v.namespace, v.topic).map((s) => presentSubscription(s, t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'subscription', 'delete'], 'Delete a subscription from the specified topic.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { sandbox: next } = ops.deleteSubscription(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, name: v.name })
      return { sandbox: next, output: null, events: [sEvent('deleted', v)] }
    },
  }),
  rule: ruleGroup,
})
```

- [ ] **Step 5: Implement servicebus-topic.js and register**

```js
import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentTopic } from '../arm.js'
import { subscriptionGroup } from './servicebus-subscription.js'

const NAME = ARG.name('Name of Topic.')
const PROPERTY_ARGS = [
  { name: '--max-size', aliases: [], required: false, kind: 'int', dest: 'maxSizeInMegabytes', help: 'Maximum size of topic in megabytes, which is the size of the memory allocated for the topic.', defaultValue: 1024 },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8601 Default message timespan to live value.' },
  { name: '--enable-partitioning', aliases: [], required: false, kind: 'bool', dest: 'enablePartitioning', help: 'Value that indicates whether the topic to be partitioned across multiple message brokers is enabled.' },
  { name: '--enable-duplicate-detection', aliases: [], required: false, kind: 'bool', dest: 'requiresDuplicateDetection', help: 'Value indicating if this topic requires duplicate detection.' },
  { name: '--duplicate-detection-history-time-window', aliases: [], required: false, kind: 'string', dest: 'duplicateDetectionHistoryTimeWindow', help: 'ISO8601 timespan structure that defines the duration of the duplicate detection history. The default value is 10 minutes.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  { name: '--enable-ordering', aliases: [], required: false, kind: 'bool', dest: 'supportOrdering', help: 'Value that indicates whether the topic supports ordering.' },
  { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' },
]
const KEYS = PROPERTY_ARGS.map((a) => a.dest)
const props = (v) => Object.fromEntries(KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
const SCOPE = [NAME, ARG.namespace, ARG.resourceGroup]
const tEvent = (type, v) => event(type, 'topic', { name: v.name, resourceGroup: v.resourceGroup, namespace: v.namespace })

export const topicGroup = defineGroup(['servicebus', 'topic'], 'Manage Azure Service Bus Topic and Authorization Rule.', {
  create: defineCommand(['servicebus', 'topic', 'create'], 'Create the Service Bus Topic.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, ...PROPERTY_ARGS],
    examples: [{ summary: 'Create a new Service Bus Topic.', command: 'az servicebus topic create --resource-group myresourcegroup --namespace-name mynamespace --name mytopic' }],
    run: ({ sandbox }, v) => {
      const { sandbox: next, resource } = ops.createTopic(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentTopic(resource, ops.getNamespace(next, v.resourceGroup, v.namespace)), events: [tEvent('created', v)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'show'], 'Get a description for the specified topic.', {
    args: SCOPE,
    run: ({ sandbox }, v) => ({ sandbox, output: presentTopic(ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.name), ops.getNamespace(sandbox, v.resourceGroup, v.namespace)) }),
  }),
  list: defineCommand(['servicebus', 'topic', 'list'], 'List all the topics in a namespace.', {
    args: [ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      return { sandbox, output: ops.listTopics(sandbox, v.resourceGroup, v.namespace).map((t) => presentTopic(t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'delete'], 'Delete a topic from the specified namespace and resource group.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { sandbox: next } = ops.deleteTopic(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name })
      return { sandbox: next, output: null, events: [tEvent('deleted', v)] }
    },
  }),
  subscription: subscriptionGroup,
})
```

`src/lib/az/commands/servicebus.js` becomes:

```js
import { defineGroup } from '../tree.js'
import { namespaceGroup } from './servicebus-namespace.js'
import { queueGroup } from './servicebus-queue.js'
import { topicGroup } from './servicebus-topic.js'

export const servicebusGroup = defineGroup(['servicebus'], 'Manage Azure Service Bus namespaces, queues, topics, subscriptions, rules and geo-disaster recovery configuration alias.', {
  namespace: namespaceGroup,
  queue: queueGroup,
  topic: topicGroup,
})
```

- [ ] **Step 6: Run the whole suite**

`npx vitest run` → all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(az): servicebus topic, subscription and rule command groups"
```

---

## Self-review (Part 1)

- Spec coverage: tokenizer (bash quoting, `$IDENT`), argparse semantics, sorted-JSON output, help on every node, every command in the SPEC table, error wording samples, latency values, events — all have tasks. `-o table`/`--query` deliberately absent (non-goals); the help lists them under Global Arguments only, matching real az text.
- Type consistency: `runLine(sandbox, line) → { sandbox, lines, events, latencyMs, clear }`; `lines[].kind ∈ 'out'|'err'`; events use `resourceType ∈ resourceGroup|namespace|queue|topic|subscription|rule`. Part 2 consumes exactly these names.
- One intentional deviation from real az: `az group delete` without `--yes` errors instead of prompting (no interactive stdin in the Sandbox). Documented in SPEC and the error text.

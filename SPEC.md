# Azure-Trainer — Implementation Spec (demo)

A private, single-user static Vue app for hands-on preparation for exam **AI-200**. Glossary terms
(Portal, Blade, Cloud Shell, Sandbox, Skill Area, Lab, Task, Hint, Solution, Exam Note, Lab Panel,
Lab Result) are defined in [CONTEXT.md](./CONTEXT.md) and used exactly. Architecture decision:
[ADR-0001](./docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md). Visual source of truth:
[docs/design/Azure-Trainer Screens.dc.html](./docs/design/Azure-Trainer%20Screens.dc.html) (three
1440×900 artboards: Home, Lab running, Lab complete). Design brief: [docs/design-prompt.md](./docs/design-prompt.md).

## Goals of the demo

- One playable Lab ("Order-processing backend on Service Bus", 5 Tasks) end to end.
- The Cloud Shell is the only way to change the Sandbox. Blades are read-only mirrors.
- Tasks tick live after every command; Hints, Solution and Exam Notes per Task.
- A Lab resumes after reload; completing it writes a Lab Result; Home shows progress per Skill Area.
- Look: the design file, pixel-close, with **official icons**: Microsoft's Azure service icons
  (`src/assets/icons/azure/*.svg`, from the Azure Architecture Icons v24 set) and Fluent UI System
  Icons (`src/assets/icons/fluent/*.svg`) for header, command-bar and shell controls.

## Non-goals (demo)

No real Azure, no AI, no accounts, no deploy workflow (the app is never published), no portal-click
mutation, no tab completion, no `-o table`, no `--query`, no PowerShell, no mobile layout, no dark theme.

## Stack & conventions (mirrors Net-Trainer)

- Vue 3 + Vite 6 + Pinia 2 + vue-router 4. JS only, `<script setup>`, 2-space indent.
- Router: `createWebHashHistory` in production, `createWebHistory` in dev. Vite `base: '/'`, dev port 5175.
- Styling: plain CSS tokens, global stylesheets imported in order `tokens.css → components.css → pages.css`
  from `src/styles/index.css`. No scoped styles, no Tailwind.
- Fonts (Google Fonts): Public Sans 400/500/600/700, JetBrains Mono 400/500/700.
- Tests: vitest, node environment, fake `localStorage` where needed. No component-DOM tests.
- Persistence: localStorage, key prefix `at_`.
- Desktop-only: designed at 1440×900, must work at 1280 wide. The app shell fills the viewport
  (`height: 100vh`, no page scroll); Blade content and Lab Panel scroll internally.
- Icons are inlined SVG. Fluent SVGs get `fill="#212121"` replaced by `currentColor` at load;
  Azure SVGs keep their colours.

## Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | HomePage | Design screen 1: services row, Skill Area cards, Lab cards |
| `/lab/:labId` | LabPage | Design screens 2 and 3: Blade + Cloud Shell + Lab Panel |
| anything else | redirect `/` | |

## Sandbox model (`src/lib/sandbox/`)

```js
sandbox = {
  resourceGroups: [{ name, location /* 'westeurope' */, tags: null|{}, createdAt }],
  namespaces: [{ name, resourceGroup, location, sku: 'Basic'|'Standard'|'Premium', tags, createdAt,
                 queues: [queue], topics: [topic] }],
  defaults: { group: null, location: null },       // az configure --defaults
}
queue        = { name, maxDeliveryCount: 10, deadLetteringOnMessageExpiration: false,
                 defaultMessageTimeToLive: 'P10675199DT2H48M5.4775807S', lockDuration: 'PT1M',
                 maxSizeInMegabytes: 1024, requiresSession: false, requiresDuplicateDetection: false,
                 duplicateDetectionHistoryTimeWindow: 'PT10M', enablePartitioning: false,
                 enableBatchedOperations: true, status: 'Active', createdAt }
topic        = { name, maxSizeInMegabytes: 1024, defaultMessageTimeToLive, requiresDuplicateDetection: false,
                 duplicateDetectionHistoryTimeWindow: 'PT10M', enablePartitioning: false,
                 enableBatchedOperations: true, supportOrdering: true, status: 'Active', createdAt,
                 subscriptions: [subscription] }
subscription = { name, maxDeliveryCount: 10, lockDuration: 'PT1M', deadLetteringOnMessageExpiration: false,
                 deadLetteringOnFilterEvaluationExceptions: true, defaultMessageTimeToLive,
                 requiresSession: false, enableBatchedOperations: true, status: 'Active', createdAt,
                 rules: [rule] }                    // a new subscription always gets rule '$Default' (SqlFilter '1=1')
rule         = { name, filterType: 'SqlFilter'|'CorrelationFilter', sqlExpression: string|null,
                 correlationFilter: null|{ correlationId, label } , createdAt }
```

Constants: subscription id `7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37`, subscription name `Sandbox`.
Operations are pure: `op(sandbox, params) → { sandbox: next, resource }` on a deep clone, or throw
`AzError(code, message, { kind: 'arm' | 'cli' })`. Locations accept `westeurope`, `WestEurope` and
`"West Europe"` and are stored as the lowercase code.

## Cloud Shell command surface (`src/lib/az/`)

Input line → `tokenize` (bash quoting: `'…'`, `"…"`, `\`, `$IDENT` expands to empty outside single
quotes) → command resolution → `--help` → argument parsing (argparse semantics: `--flag value`,
`--flag=value`, aliases, `true|false` for booleans, ints validated) → execute against the Sandbox →
JSON output with **alphabetically sorted keys, 2-space indent** (az default) or nothing for deletes.

Supported (`--help` on every group and command):

| Command | Notes |
|---|---|
| `az` | banner + base command list |
| `az --version`, `az version` | fake azure-cli 2.78.0 |
| `az login` | prints the Sandbox account list |
| `az account show` / `list` | Sandbox subscription JSON |
| `az configure --defaults group=<rg> location=<loc>` / `--list-defaults` | sets/prints Sandbox defaults |
| `az group create/show/list/delete/exists` | `create` needs `--name/-n` (alias `--resource-group/-g`) and `--location/-l`; `delete` needs `--yes/-y` |
| `az servicebus namespace create/show/list/update/delete/exists` | `--sku {Basic,Standard,Premium}` default Standard; `--location` defaults to the group's |
| `az servicebus queue create/show/list/update/delete` | `--max-delivery-count`, `--enable-dead-lettering-on-message-expiration {false,true}`, `--default-message-time-to-live`, `--lock-duration`, `--max-size`, `--enable-session`, `--enable-partitioning`, `--enable-duplicate-detection`, `--status` |
| `az servicebus topic create/show/list/delete` | Basic tier → `(BadRequest) SubCode=40000. Cannot operate on type Topic because the namespace '<ns>' is using 'Basic' tier.` |
| `az servicebus topic subscription create/show/list/delete` | creates `$Default` rule |
| `az servicebus topic subscription rule create/show/list/delete` | `--filter-sql-expression`, `--filter-type {SqlFilter,CorrelationFilter}`, `--correlation-id`, `--label` |
| `clear` | clears the scrollback (shell level) |
| anything else | `bash: <word>: command not found` |

`--resource-group` falls back to `sandbox.defaults.group` when omitted. Error wording follows az:

```
ERROR: the following arguments are required: --namespace-name
ERROR: unrecognized arguments: --foo bar
ERROR: argument --max-delivery-count: invalid int value: 'five'
ERROR: 'quene' is misspelled or not recognized by the system.
The most similar choice to 'quene' is:
        queue
ERROR: (ResourceGroupNotFound) Resource group 'rg-x' could not be found.
Code: ResourceGroupNotFound
Message: Resource group 'rg-x' could not be found.
```

Each command declares `latencyMs` (namespace create 2500, group create 800, other mutations 900,
reads 250); the shell shows az's spinner line (`- Running ..`, cycling `- \ | /`) for that long.
Mutations return `events` (`{ type: 'created'|'updated'|'deleted', resourceType, name, resourceGroup,
namespace, topic, subscription }`) that drive notifications and Blade focus.

## Labs (`src/data/`)

`skillAreas.js`: the four official AI-200 areas with weights (`containers` 20–25%, `data` 25–30%,
`connect` 20–25%, `secure` 20–25%). `services.js`: service key → label + Azure icon name.
`labs/index.js`: catalog; one `available` Lab plus five `coming-soon` entries (Container Apps with
KEDA → containers; Cosmos DB vector search → data; Key Vault secrets → secure; Functions serverless
API → connect; Event Grid filtered subscription → connect).

Lab shape: `{ id, title, skillAreaId, service, minutes, status, brief, seed(sandbox) → sandbox,
tasks: [{ id, text (backticks → code), check(sandbox) → boolean, hints: [h1, h2], solution (one
command per line), examNote }] }`. The demo Lab's Tasks, Hints, Solutions and Exam Notes are in the
design brief and are copied verbatim into `labs/servicebus-order-backend.lab.js`. Task 5 passes only
when the subscription has exactly one rule, a SqlFilter whose expression equals `region = 'EU'`
ignoring whitespace.

## State & persistence

- `useLabRunStore` (one active Lab run at a time): `{ labId, sandbox, scrollback: [{ text, kind:
  'cmd'|'out'|'err' }], history: [], hintsRevealed: { [taskId]: n }, solutionsRevealed: { [taskId]: true },
  elapsedMs, lastTickAt, completedAt, resultId }`, persisted at `at_run_<labId>` after every change.
  `execute(line)` is async (spinner latency), re-evaluates Tasks, emits Portal notifications, and on
  the transition to all-done writes a Lab Result and fires the completion notification + toast.
  `restart()` reseeds the Sandbox and clears everything but keeps past Lab Results.
- `useProgressStore`: `at_results: [{ id, labId, tasksDone, total, hintsUsed, solutionsUsed,
  durationMs, finishedAt }]`; Lab status = `in-progress` if a run exists without `completedAt`,
  else `completed` if any result, else `not-started`; Skill Area counts derive from that.
- `usePortalStore` (not persisted): notifications + unread count + pane open; toast; shell
  `{ visible, minimized, maximized }`; Lab Panel collapsed; current Blade
  `{ kind: 'resource-groups' } | { kind: 'resource-group', name } | { kind: 'servicebus-namespace',
  resourceGroup, name, tab: 'queues'|'topics' }`. Blade focus follows events: created group → its Blade;
  created namespace/queue → namespace Overview (Queues tab); topic/subscription/rule → Topics tab;
  deleting the focused resource → parent Blade. Breadcrumb and resource-menu clicks navigate Blades
  (read-only navigation).

## Screens (from the design)

- **Home**: 48px header (hamburger, Azure logo + "Azure-Trainer", 560px search, Cloud Shell / bell /
  settings / help / feedback icons, account chip "Sam Learner / Sandbox directory / SL"); content
  padding 22px 40px; "Azure services" row of 96px tiles; "Labs by Skill Area" 4-up cards with
  progress ring; "Labs" 3-up cards (available: status pill + "n of m tasks" + progress bar + button;
  coming soon: 55% opacity + "Coming soon" pill).
- **Lab running**: header; main column = Blade (240px resource menu + content) over a 280px Cloud
  Shell dock (34px header strip with drag handle, Bash ▾, control glyphs; terminal `#0D1117`, 12px
  JetBrains Mono, prompt `user@sandbox:~$` in green/blue); 360px Lab Panel on the right (title, chips,
  "n of m tasks" + elapsed, progress bar, collapsible BRIEF, Task rows: done/current/pending, Hint
  box, "Show hint 2" / "Show solution", "Restart Lab" footer).
- **Lab complete**: same layout; Lab Panel header turns green with "Lab complete", "5 of 5 tasks",
  duration, Lab Result line, EXAM NOTES recap 1–5, buttons "Back to Home", "Restart Lab",
  disabled "Next Lab: … Coming soon"; toast "Lab completed" top-right of the main area; bell badge 2.

Colours, sizes and copy are taken from the design file verbatim; tokens are listed in the plan.

## Verification

- `npm test` green (tokenizer, args, format, help, sandbox ops, every az command's happy path and
  main errors, Lab checks via solutions, stores with fake localStorage and fake timers).
- `npm run dev`, then in the browser at 1440×900: Home → Start Lab → type the five solutions (with
  one deliberate mistake to see an az error and a Hint) → Tasks tick, Blades update, notifications
  appear → completion toast + Lab Result → reload resumes → Restart Lab resets → Back to Home shows
  Completed. Screenshots compared with the three artboards.

# Azure-Trainer — UI design brief for Claude Design

Current implementation status (2026-09-24): all 16 Container Apps journey Labs, including the seven-stage Capstone, are implemented in the worktree; Lab 16 awaits scoped review and guarded delivery. The Capstone Lab Panel displays stage seals, checkpoint and ownership, and saved source/published artifact/active deployment. The deployment review separates bootstrap and main roots and exposes simulated live drift. The three artboards below remain the original demo design reference. No live Azure resources are created.

## What you are designing

Azure-Trainer is a private, single-user web app for hands-on preparation for Microsoft exam
**AI-200: Developing AI Cloud Solutions on Azure**. It is a faithful recreation of the Microsoft
Azure portal in which the learner completes realistic developer tasks by typing `az` commands into
a Cloud Shell docked at the bottom of the portal. Commands change a simulated subscription (the
Sandbox); the portal pages (Blades) are read-only mirrors of that Sandbox, so the effect of a command
appears in the portal exactly as it would for real. A Lab Panel docked on the right holds the brief
and a task list that ticks live after every command. Nothing connects to Azure. The app is never
published; it is a personal demo.

Design **three desktop screens as three artboards on one canvas**, static, light theme, 1440×900.
The goal is not a new visual identity: it is the real Azure portal, so that the learner's muscle
memory transfers to the real thing.

## Vocabulary (use exactly these words in labels and annotations)

- **Portal** — the whole Azure-portal frame: header, portal menu, Blades. Displays state, never changes it.
- **Blade** — one Portal page (a resource, a list, a settings section). Read-only mirror of the Sandbox.
- **Cloud Shell** — the terminal docked at the bottom that accepts `az` commands. The only way to change state.
- **Sandbox** — the simulated subscription a Lab runs in. Shown as the subscription named "Sandbox".
- **Skill Area** — one of the four official AI-200 skill groups, named verbatim with its exam weight.
- **Lab** — one hands-on exercise: a short brief plus Tasks.
- **Task** — one checkable step, a condition over the Sandbox. Ticks as soon as the Sandbox satisfies it.
- **Hint** — one of up to two on-demand nudges per Task (concept first, then command group and key flag).
- **Solution** — the full command for a Task, revealed as a last resort after the Hints.
- **Exam Note** — the one- or two-sentence exam insight shown when a Task ticks.
- **Lab Panel** — the collapsible right-docked pane: brief, Task list, Hints, Solution, Exam Notes.
- **Lab Result** — the record of a completed Lab: tasks, hints and solutions used, duration, finished at.

Do not use: Exercise, Test, Quiz, Category, Module, Topic (as a group name), Terminal, Console,
Sidebar, Dashboard (as the name of the frame), Score, Grade.

## Visual system: clone the current Azure portal (light theme, 2026)

Match the real Azure portal as closely as you can. Where you know the portal's exact treatment, use
it; do not restyle.

- **Header bar**: the portal's current header. Hamburger menu at far left, then the **Microsoft
  Azure** wordmark; global search box centred with placeholder "Search resources, services, and docs
  (G+/)"; right icon cluster: Cloud Shell, Notifications (with count badge), Settings, Help + support,
  Feedback; account chip at far right (display name on top, directory below, avatar circle).
- **Type**: Segoe UI (fallback Segoe UI Variable, system-ui). 13px body, 14px semibold section
  titles, 20px semibold Blade titles, 12px secondary metadata.
- **Fluent neutrals**: page background `#F3F2F1`, surfaces `#FFFFFF`, borders `#EDEBE9`, primary text
  `#323130`, secondary text `#605E5C`, disabled `#A19F9D`. Accent Azure blue `#0078D4` (links,
  primary buttons, selected states), hover `#106EBE`. Success `#107C10`, error `#A4262C`,
  warning `#FFB900`, as the portal uses them.
- **Blade anatomy**: breadcrumb (`Home > Resource groups > rg-orders > sb-contoso-orders`) above a
  title row with the resource icon, resource name, resource type in secondary text, and a star
  (favourite) and pin; a **command bar** row of icon+label buttons (`+ Queue`, `+ Topic`, `Delete`,
  `Refresh`, `Move`, `Feedback`); an **Essentials** block (two-column key/value grid with a
  "JSON View" link at the top right, collapsible); then content.
- **Resource menu** (left, 240px, own search filter): Overview, Activity log, Access control (IAM),
  Tags, Diagnose and solve problems; collapsible groups **Settings** (Shared access policies,
  Networking, Geo-recovery, Scale, Properties, Locks), **Entities** (Queues, Topics), **Monitoring**
  (Alerts, Metrics, Diagnostic settings, Logs), **Automation**, **Help**.
- **Icons**: Fluent UI System Icons for controls. Official Azure service icons (Service Bus, Resource
  group, Subscription, Queue, Topic, Container Apps, Cosmos DB, Key Vault, Functions, PostgreSQL,
  Managed Redis, Container Registry) and the Microsoft Azure wordmark exactly as in the real portal.
  If you cannot render a logo or icon, leave a clearly labelled placeholder slot at the exact size;
  I will drop the real assets in locally.
- Design for 1280px desktop and 768px narrow layouts. Keep the Lab Panel, tool controls, deployment review, and long resource IDs usable at both widths; stack the workspace below the narrow breakpoint when space requires it. Light theme only. The three original artboards remain desktop reference material.

## Cloud Shell (bottom dock)

Match the real Cloud Shell drawer, about 280px tall with a drag handle on its top edge.

- Header strip: `Bash` dropdown selector at left; icons at right: Restart, Upload/Download files,
  Open new session, Open editor, Web preview, Settings, Help, Minimize, Maximize, Close.
- Terminal: `#000000` background, `#FFFFFF` text, Cascadia Mono / Consolas 14px, prompt
  `user@Azure:~$`. az output is JSON in the real formatting; errors in the portal's red.
- Show a realistic transcript in each screen (specified below). A command in flight shows az's
  `Running ..` line with the spinner glyph.

## Lab Panel (right dock, 360px, collapsible to a slim tab)

- **Header**: Lab title, Skill Area chip, service chip ("Service Bus"), progress text "3 of 5 tasks",
  thin progress bar, elapsed timer, overflow menu (Restart Lab, Collapse panel).
- **Brief** (collapsible, 2–3 sentences): "Contoso's order API must hand each order to a background
  processor without losing messages, and fan out order events to regional fulfilment systems. Build
  the messaging backbone on Azure Service Bus."
- **Task list**: one row per Task with a state: ticked (green check, Task text in secondary colour,
  expandable Exam Note callout), current (blue left rail, full-weight text, Hint and Solution controls
  visible), pending (empty circle). Hint controls for the current Task: "Hint 1 of 2" revealed inline
  as a light callout, "Show hint 2" link button, "Show solution" tertiary button below.
- **Footer**: "Restart Lab" secondary button.

The demo Lab, "Order-processing backend on Service Bus", Skill Area **Connect to and consume Azure
services (20–25%)**:

1. Create a resource group named `rg-orders` in West Europe.
   Exam Note: "Every az command that creates an entity needs `--resource-group`; set a default with
   `az configure --defaults group=rg-orders` to stop repeating it."
2. Create a Service Bus namespace `sb-contoso-orders` in `rg-orders` on the Standard tier.
   Exam Note: "Topics and subscriptions require Standard or Premium. Basic has queues only."
3. Create a queue named `orders` with max delivery count 5 and dead-lettering on message expiration
   enabled.
   Exam Note: "Max delivery count and dead-lettering on expiry are the two queue settings that route
   messages to the dead-letter sub-queue at `orders/$DeadLetterQueue`."
4. Create a topic named `order-events`.
   Hint 1: "Entity commands always need `--namespace-name` and `--resource-group`; the topic itself
   needs only `--name`."
   Hint 2: "`az servicebus topic create --resource-group rg-orders --namespace-name sb-contoso-orders --name ...`"
   Exam Note: "A topic has no consumers of its own; nothing is delivered until a subscription exists."
5. Create a subscription `eu-orders` on `order-events` whose only rule is the SQL filter `region = 'EU'`.
   Exam Note: "A new subscription gets a `$Default` rule that matches everything. A SQL filter only
   takes effect once `$Default` is removed."

## Screen 1 — Home

The real portal Home anatomy, repurposed. Header as above, portal menu collapsed, breadcrumb "Home".

1. **Azure services** icon row: Create a resource, Service Bus, Container Apps, Cosmos DB, Key Vault,
   Functions, Azure Database for PostgreSQL, Managed Redis, Container Registry, More services.
2. **Labs by Skill Area**: four equal cards in one row, each with the official name verbatim, the exam
   weight, a progress ring and "n of m labs":
   - Develop containerized solutions on Azure (20–25%) — 0 of 1
   - Develop AI solutions by using Azure data management services (25–30%) — 0 of 1
   - Connect to and consume Azure services (20–25%) — 0 of 2, one in progress
   - Secure, monitor, and troubleshoot Azure solutions (20–25%) — 0 of 1
3. **Labs**: card grid. Each card: service icon, title, Skill Area, estimated minutes, status badge.
   Only one is live: "Order-processing backend on Service Bus" — In progress, 3 of 5 tasks — primary
   button "Resume". The others are greyed "Coming soon": "Deploy a Container App with KEDA scaling",
   "Cosmos DB container with vector search", "Store and rotate secrets in Key Vault", "Serverless
   API with Azure Functions", "Event Grid custom topic with filters".
4. **Recent resources** table (Name, Type, Last viewed) listing `sb-contoso-orders` (Service Bus
   Namespace), `orders` (Queue), `rg-orders` (Resource group): it mirrors the Sandbox.

## Screen 2 — Lab running

The core layout, all three regions visible: header; Blade in the centre with resource menu; Cloud
Shell docked at the bottom; Lab Panel docked at the right.

- **Blade**: Service Bus namespace `sb-contoso-orders`, Overview. Essentials: Resource group
  `rg-orders`, Location `West Europe`, Subscription `Sandbox`, Subscription ID (a plausible GUID),
  Status `Active`, Pricing tier `Standard`, Host name `sb-contoso-orders.servicebus.windows.net`,
  Tags `Add tags`. Below: two metric cards with flat sparklines (Requests, Messages, "last hour"),
  then entity tabs **Queues (1) | Topics (0)**: the Queues tab shows a table with the row `orders`,
  Status Active, Max size 1 GB, Active message count 0, Dead-letter message count 0, Scheduled 0.
- **Cloud Shell transcript**: the successful `az servicebus queue create ... --max-delivery-count 5
  --enable-dead-lettering-on-message-expiration true` with its JSON output scrolled so the last lines
  show; then a failed `az servicebus topic create --name order-events` with az's real red error
  (`the following arguments are required: --namespace-name`, phrased as az phrases it); then an
  empty prompt with the cursor.
- **Lab Panel**: Tasks 1–3 ticked, Task 2's Exam Note expanded as the example; Task 4 current with
  Hint 1 revealed inline and "Show hint 2" / "Show solution" controls; Task 5 pending. Progress
  "3 of 5 tasks", timer 08:12.
- Notification bell shows a badge "1" (the queue creation).

## Screen 3 — Lab complete

Same layout as Screen 2, in the finished state.

- **Blade**: same namespace Overview with **Queues (1) | Topics (1)**, Topics tab active showing
  `order-events`, Status Active, Subscription count 1.
- **Cloud Shell transcript**: the successful `az servicebus topic subscription rule create ...
  --filter-sql-expression "region = 'EU'"` JSON, then `az servicebus topic subscription rule delete
  ... --name '$Default'` and an empty prompt.
- **Lab Panel** in its completed state: green header "Lab complete", "5 of 5 tasks", duration
  14:37, Lab Result line "1 hint · 0 solutions", a recap list of all five Exam Notes, then buttons:
  "Back to Home" (primary), "Restart Lab" (secondary), "Next Lab: Deploy a Container App with KEDA
  scaling" (disabled, "coming soon").
- A portal notification toast at the top right: "Lab completed — Order-processing backend on
  Service Bus".

## Deliverable

Three named artboards (Home, Lab running, Lab complete) on one canvas at 1440×900, light theme,
static. Annotate regions with the vocabulary above (Blade, Cloud Shell, Lab Panel, Task, Hint,
Exam Note). Real Azure portal look throughout; leave labelled slots for any logo or icon you cannot
render. All text in English.

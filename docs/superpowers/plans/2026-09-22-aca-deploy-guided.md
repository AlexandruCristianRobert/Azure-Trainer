# Guided Application Factory deployment implementation plan

> Use superpowers:subagent-driven-development, Sol/Terra implementers, task review and fresh controller verification. User authorizes three sequential Labs; this plan delivers only the first. Do not begin Lab 2 until this Lab passes its complete gate.

**Goal:** Deliver `aca-deploy-guided`: edit a bounded C# starter, publish an immutable image, deploy with private image access, and verify the actual deployed response.

**Architecture:** Extend the verified F0 run/session/evidence engine with bounded project interpretation, pure resource operations, explicit CLI effects, deployment snapshots and request experiments. Then adapt the current Pinia/UI without migrating legacy Labs.

**Tech stack:** Existing JavaScript/Vue/Pinia/Vitest and native IndexedDB. No new dependencies or actual C#/Docker/Azure execution.

**Spec:** `docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-technical-design.md`, curriculum design beside it, ADR-0002 and CONTEXT.md.

## Global constraints

- Work only in `E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/aca-f0`. It matches the dirty main workspace at baseline. No commits, staging, broad copying, or other git metadata changes. Controller delivers only changed files after original-file hash guards.
- Preserve six legacy Labs, localStorage progress, two-argument CLI APIs and existing public store methods. New runs use engineVersion 2, contentVersion 1 and native F0 persistence.
- Tests first for new behavioral logic; observe failure then focused green. Every task is reviewed. Full suite/build at F1 and playable-Lab gates; no repeated suite without changes or specific concern.
- Scope is .NET 10 Minimal API GET `/api/info`, returning `{service: 'contoso-api', environment: 'training'}`, listener/ingress 8080. Source service comes from supported C#; environment from deployed APP_ENV. No CPU/probes/Foundry/Bicep platform.
- Unknown constructs produce explicit unsupported diagnostics. Never execute arbitrary source, outbound requests or commands. Paths limited to manifest; 32 KiB/file, 256 KiB total, 32 files, 5,000 lexer tokens per editable region.
- Draft, saved source, published image and running deployment are distinct. Failed builds publish nothing; failed updates retain active runtime; semantic no-op retains evidence. Every successful request uses captured deployment data.
- Read-only resource Blades. File editor and Experiment Controls mutate through serialized run actions. Completed behavioral attempts are read-only; Restart creates a new attempt and preserves results.
- Keep detailed reports and baseline snapshots because there are no commits. Do not delete another plan's workspace. No nested agents.

## Review focus

1. Unrecognized executable source or malformed Docker instructions must not pass a build. Task 1 tests fixed scaffold, comments/strings and unsupported constructs.
2. Reusing a tag cannot rewrite a running deployment; deleting authorization blocks a future pull but does not stop an already pulled image. Task 3 tests both.
3. A failed desired update cannot pass grading using the previous active version. Task 3 tests desired/active identity and task evidence.
4. Navigation/restart during async persistence cannot apply old run effects to a new attempt; incompatible records remain exportable. Task 4 tests real session integration and recovery.
5. Learners must actually execute the file/build/deploy/request workflow; content checks and UI must not inject evidence. Task 5 runs authored Solutions through the same reducer as UI.

## Verified source contract

Checked Microsoft Learn on 2026-09-22: [ACR build](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest#az-acr-build), [managed-identity image pull](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull), [.NET container tutorial](https://learn.microsoft.com/en-us/dotnet/core/docker/build-container).

Use `az acr build --registry NAME --image api:v1 --file Dockerfile .`; successful build includes publication. Use `mcr.microsoft.com/dotnet/sdk:10.0` and `mcr.microsoft.com/dotnet/aspnet:10.0`, target `net10.0`, no NuGet packages. These are explicitly family tags, not patch-pinned SDK downloads. Resources use synthetic ARM identifiers, not actual ARM API calls/version claims.

Teach explicit AcrPull assignment at a non-ABAC registry scope before create. State that this is the simulator's explicit permission path; real Azure CLI can automatically make the role assignment. Support user-assigned identity resource IDs for attachment/registry identity, principal IDs for role assignments. No shell variables, substitution or query support is implied.

## Task 1: Bounded project and immutable build artifacts

**Files:** create `src/data/templates/containerapps-dotnet/starter.js`; `src/lib/project/{files,csharp,dockerfile,build}.js` (small lexer module allowed); `tests/project-build.test.js`.

**Interfaces:** export `PROJECT_MANIFEST`, `STARTER_FILES`, `SOLUTION_FILES` from starter. File names are `src/Trainer.Api/Trainer.Api.csproj`, `Program.cs` and `AppSettings.cs` and `appsettings.json` in that same directory, `Dockerfile`, `.dockerignore`. `saveProjectFile(project,path,text,manifest=PROJECT_MANIFEST) -> {project,diagnostics}`; `parseProject(savedFiles,manifest=PROJECT_MANIFEST) -> {appSpec,diagnostics}`; `parseDockerfile(text) -> {dockerSpec,diagnostics}`; `buildImage(run,{registryId,loginServer,image,file:'Dockerfile',context:'.'}) -> {artifacts,artifact,diagnostics}`. Build IDs consume run.nextSequence, so return `nextSequence`; no run/resource mutation. Published tags keyed by full lower-case registry/repository reference with case-sensitive tag; document exact shape in report.

- [x] Write expected failing tests for equivalent whitespace/comments, literals/member access/config lookup and anonymous response object; scaffold modification and unknown executable statement rejection; diagnostic path/line/column; invalid JSON and Dockerfile; path/size/token limits; drafts excluded from builds; immutable snapshots and failed build atomicity.
- [x] Implement recognizer/token parser (no substring acceptance). Starter is intentionally incomplete in service name and Docker ENTRYPOINT, with clear editable regions and a valid worked answer. Allow supported equivalent expressions, not arbitrary C#. Parse recognized multi-stage Docker instructions including SDK publish, runtime COPY, ENV ASPNETCORE_HTTP_PORTS, ENTRYPOINT.
- [x] Build AppSpec includes route and response expression semantics, selected service/config values and listening port. Snapshot/hash/digest identify immutable saved source. Store finite JSON only. Preserve old artifacts when rebuilding a tag.
- [x] Run focused test, self-review and write task-1-report.md with RED/GREEN evidence and export contracts. Do not implement CLI or registry resources yet.

## Task 2: Registry, identity and role resource commands

**Files:** create `src/lib/sandbox/{registry,identity,roleAssignments}.js`, `src/lib/az/commands/{acr,identity}.js`, `src/lib/az/registry-arm.js`; modify `sandbox/model.js`, `sandbox/ops.js`, `az/args.js`, `az/run.js`, `az/shell.js`, `az/commands/{index,role}.js`; tests `tests/az-registry-identity.test.js`.

**Interfaces:** additive `containerRegistries`, `managedIdentities`, `roleAssignments`; registry `{id,name,resourceGroup,location,loginServer,sku,tags}` and identity with distinct ARM id/clientId/principalId. Operations follow existing pure `{sandbox,resource}` convention. `runLine(sandbox,line,context?)` and `runAz(sandbox,tokens,context?)` propagate optional `effects` without mutating context. A successful ACR build emits `{type:'publish-build',artifacts,nextSequence}` using Task 1; context supplies a read-only run and Lab capabilities. Unsupported legacy-context builds return an honest error.

- [x] Test first: resource lifecycle/normalization, case-insensitive ARM scopes, distinct IDs, exact-scope AcrPull validation, invalid principal/role atomicity, Key Vault regression, group cleanup/cross-group references, ACR command build effects and unsupported remote context.
- [x] Implement create/show/list/delete registry and identity; registry repository list/show-tags using artifact context. ACR create requires Basic sku for bounded initial path. Registry/identity names validated, duplicate creates idempotent only for consistent identity. Deletes require --yes as established simulator convention.
- [x] Route `role assignment create/list/delete` by resource scope, preserving Key Vault behavior; accept `--assignee-object-id`, `--assignee-principal-type ServicePrincipal`, `--role AcrPull`, `--scope ARM_ID`. Expose stable assignment records and no automatic permission grant.
- [x] Extend positional parsing narrowly for documented ACR build context; all legacy unsupported positionals remain rejected. New commands help explains simulation limits. Source errors retain diagnostics and do not publish.
- [x] Run focused plus affected CLI tests and write task-2 report. Inspect JSON shapes against model validators.

## Task 3: Deployment snapshots, requests and action dispatcher (F1 gate)

**Files:** create `src/lib/simulation/{runtime,requests}.js`, `src/lib/labEngine/actions.js`, optional focused `az/commands/containerapp-behavioral.js`; modify containerapp CLI, Sandbox operations/model and presenter narrowly. Tests `tests/behavioral-actions.test.js`.

**Interfaces:** `applyRunAction(run,action,lab) -> {run,lines,portalEvents,diagnostics}`. Actions `{type:'command',line}`, `{type:'draft',path,text}`, `{type:'save-file',path,text}`, `{type:'request',appId,method:'GET',path:'/api/info'}`, `{type:'hint',taskId}`, `{type:'solution',taskId}`, `{type:'elapsed',milliseconds}`. Request scenario requirements come from immutable lab definition, not caller-supplied success flags. Session adapter uses envelope.run. Add helper exports for deployment predicates/content.

- [x] Test first complete headless file/resource/build/deploy/request journey with a private registry; missing tag, denied access, target port mismatch diagnostics; edits/builds alone leave old runtime; failed update preserves active but not desired success; no-op preserves generation; permission revocation affects next pull only; group/app deletion drops matching runtime; cross-attempt evidence rejection.
- [x] Add real CLI-shaped subset `containerapp create` flags --user-assigned, --registry-identity, --registry-server, --env-vars APP_ENV=training; update --image and --set-env-vars; ingress enable/update uses supported Azure-shaped subcommand if needed for target-port repair. Consult official CLI for exact syntax before adding commands. Preserve existing HTTP Lab configuration behavior.
- [x] Deployment captures immutable artifact, effective env/ingress/port and monotonically identified active generation. Desired activation failure stays inspectable; append bounded simulated logs. Validate effects before committing. ACR/identity deletion never terminates existing captured runtime.
- [x] Request sends to active snapshot, uses source-derived route/body and effective deployed environment, produces explicit simulated ingress failures or response. Record F0 verification only for Lab-declared task matching named immutable scenario and actual expected result. Failed attempts recorded; no fabricated success from configuration. Support at most 500 logs and 600 scrollback lines.
- [x] Dispatcher keeps caller run immutable, checks action/path/task validity, updates draft/saved distinctions and relevant dependency generations. Reject mutations after completion. Keep historical image preparation/publishing milestones separate from current request verification.
- [x] Focused tests then controller full regression/build F1 gate; report interfaces and test evidence. No public Lab yet.

## Task 4: Behavioral session/store/progress adapters

**Files:** `src/stores/labRun.js`, `src/stores/progress.js`, new `src/stores/behavioralRun.js` helper if needed; narrow `labEngine/session.js` recovery extension if required; `tests/behavioral-store.test.js`, extend real browser harness.

- [x] Test first async load/resume, dispatch serialization, late load/command cancellation, help recording, elapsed time, atomic completion/immutable Result, restart, storage conflict/failed save retry and incompatible export/reset with explicit action. Preserve existing store tests.
- [x] Connect F0 createBehavioralSession to reducer envelope.run. Store exposes `behavioralRun`, loading/busy/readOnly/storage error, diagnostics and full Task evaluation while projecting sandbox/history for existing components. Each active store owns its session; guard navigation with generation+attempt. All mutable v2 state flows through session.
- [x] Implement draft debounce/flush or immediate serialized persistence with truthful unsaved indicator; navigation flushes pending drafts. Provide retry/export and explicit selected-lab restart recovery. No animation until a pending marker protocol exists; synchronous modeled actions need no fabricated animated operation.
- [x] Hydrate new summaries/results from native repository before status presentation; legacy localStorage records stay unchanged. Merge stable result IDs, surface loading/error and preserve historical results.
- [x] Focused store/session tests and native browser harness, self-review report. Public Lab definition is Task 5; use an internal fixture or injectable store seams for test integration.

**Preflight clarification:** add narrow `session.retrySave()` for retained failed ordinary saves (original expected revision; never overwrite conflicts). Completion retry preserves existing exact-metadata idempotency. Add explicit `repository.replaceRunForRecovery(labId,{expectedRaw,replacement})` and `session.recoverRestart()` for corrupt/incompatible records: compare observed raw atomically, replace only selected run, preserve results. Export raw remains available from snapshot error details. Export/Retry precede Reload; require explicit discard before losing unsaved state. Task completion UI and portal events wait for persistence success and matching attempt.

## Task 5: Guided Lab content, learner tools and read-only inspection

**Files:** `src/data/labs/containerapps-journey/deploy-guided.lab.js`, new bounded content helpers as needed, `labs/index.js`; `components/lab/{ProjectEditor,ExperimentPanel,EvidenceDetails}.vue`, `TaskRow.vue`, `LabPanel.vue`, `LabCompletePanel.vue`; `pages/{LabPage,HomePage}.vue`, Home cards, Cloud Shell disabled state; registry/identity Blades, existing ContainerAppBlade, BladeHost/resource lists/resolver/portal; targeted CSS; README/SPEC/ADR status updates. Tests `tests/aca-deploy-guided.test.js`, catalog expectations only where needed.

- [x] Author only Lab1 with 3 stages Prepare, Publish, Deploy and verify. Use group rg-aca-guided, registry acrguided, environment env-guided, identity id-guided, app api-guided, image api:v1, eastus. Engine v2/content1/journey containerapps-end-to-end/order1/mode guided, current Skill Area ID from catalog.
- [x] Tasks require saved service/route, valid Dockerfile/listening port, private registry, published source artifact, environment/identity/exact AcrPull, desired active deployment with APP_ENV training, then actual GET 200 expected body. At least final request requires F0 scenario evidence and current deployment provenance. Two Hints, structured worked Solution and Exam Note each. Use fixed ARM IDs derived from existing subscription constant in Solutions; no shell substitution.
- [x] Source editor uses existing Portal typography/color tokens, accessible labeled textarea/file list/Save/diagnostics; show saved versus draft and image/deployment versions. Explicit simulation notice. Experiment Controls show app selector, method/path, response, logs and evidence details, with keyboard access and correct disabled states.
- [x] Task UI renders structured command/file/experiment Solutions and needs-verification. Help reveals instructions only. Guided stages/checkpoints visible. Completed attempts allow read-only inspection; restart starts fresh.
- [x] Resource Blades expose registry images, identity IDs/access and desired/active Container App status. Breadcrumbs, group counts/rows, event focus and stale-deletion fallback handle new families. No resource edits in Blades.

**UI preflight:** preserve white/blue Portal tokens, Public Sans and existing code monospace. Tabs Resources / Files / Experiments sit above main content, Lab Panel beside and Cloud Shell below. Override baseline 1280px root minimum narrowly for behavioral Labs/Home so keyboard access and all tools remain reachable on narrow screens. Completion panel requires committed completedAt/resultId; error recovery must expose retained data before discard.
- [x] Home keeps legacy six and adds journey section with only Lab1. Journey Next Lab follows journeyOrder; legacy Next Lab ordering remains six-lab ordering. Loading state prevents false not-started statuses.
- [x] Execute authored Solution via same reducer/store actions; negative/recovery, draft versus saved, evidence staleness, reload/restart/result assistance tests. Full unit suite/build. Controller browser walkthrough: actual visible controls, success, meaningful failure/recovery, resume, keyboard/narrow layout and console checks.

## Delivery gate

- [x] Independent task and whole-Lab review findings resolved.
- [x] F1 tests/build and public Lab tests/build/browser evidence recorded.
- [x] Guarded copy of changed task files to main; verify delivered tests/build and hashes.
- [x] Mark this plan complete before writing or implementing Lab 2 plan.

Completed 2026-09-23: all task reviews and controller whole-Lab review resolved. Worktree and delivered main both pass 330/330 tests and production build. Native browser persistence checks pass 21/21; visible guided workflow, failure/recovery, reload, completion/restart, app-scoped results, keyboard and 768px layout verified. Delivered 71 guarded, hash-verified files; all changes remain uncommitted.

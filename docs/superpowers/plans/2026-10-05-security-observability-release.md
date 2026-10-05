# Security and Observability release record

Status: reviewed, merged and published. Implementation fix HEAD 8beca30.
All twelve Labs are deployed through GitHub Pages. Deployment ad94b6c and live
verification are recorded below; subsequent record updates do not change app code.

The user chose to finish the existing monitoring portion, not add App Service or
duplicate the already planned OpenTelemetry/KQL Labs. The existing merge and
publication request remains in force subject to review and verification.

## Current verification

- Fresh nine-file journey aggregate: 122/122 passed, 6.6452682 seconds.
- Fresh four-file Data/Messaging compatibility: 101/101 passed, 6.8874970 seconds.
- Fresh Pages-base production build: exit 0, 8.9083586 seconds.
- No AKS, Container Apps, full-suite, cloud or broad browser tests.
- Original Task 2 reviewer completed the permitted static fix review on
  2026-10-05: both findings addressed, spec and quality approved. No denied
  command or probe was retried and no alternate review route was used.
- Earlier captured verification totaled about six minutes; one initial Task 7
  RED invocation lost its final timing/output and remains an unknown-duration
  attempt (initial wait approximately ten seconds). This is not an exact
  all-attempt total. Existing build chunk-size advisory and CRLF notices remain.

## Rulings I made

These decisions are recorded in original chronological order. Each includes the
cost of being wrong; no decision is silently discarded with local scratch.

1. Reuse available agent threads when fresh dispatch hit the thread limit, with
   bounded briefs and obsolete context explicitly excluded. Cost: context
   contamination could require re-review/rework. Later fresh dispatch became
   available and isolated agents were used normally.
2. Use the disclosed advance_security_fixture within one script session for
   same-provider refresh rather than add a callback scheduler. Cost: a later
   curriculum may need a more realistic callback fixture.
3. Execute saved KQL strings through query_telemetry instead of a new .kql shell
   runner. Cost: a future query-file/editor refinement may be needed.
4. Supply the simulated Application Insights destination and teach exporter
   setup, without another resource CLI family. Cost: destination provisioning
   may need a future exercise.
5. Leave the existing Key Vault ARM presenter unchanged because it already
   preserves ServicePrincipal metadata. Cost: incorrect presentation would
   need a small follow-up; actual CLI output was covered.
6. Use resource-group deletion for the required App Configuration lifecycle,
   omitting unused standalone store/key deletion commands. Cost: individual
   deletion may require a future narrow command.
7. Give security and observability their own curriculum aggregate modules,
   avoiding helper/import cycles. Cost: two module paths may need renaming.
8. Implement independent pure KQL before telemetry integration while the
   security fix review was blocked. Cost: adapter shape could need rework and
   re-review; blocked review was not treated as approval.
9. Continue ordinary telemetry implementation provisionally against committed,
   focused-tested security interfaces, holding release at the unresolved gate.
   Cost: downstream interface rework if the permitted review found a defect.
10. On failed callback rollback, preserve only sanitized category-level privacy
    audit, not business/telemetry success. Cost: a later audit schema may need
    more explicit failed-attempt provenance.
11. Add standard --output none success-data suppression and opt rotation into
    it; preserve errors, default output, effects and events. Cost: shared CLI
    formatting regressions, covered by focused checks. Demo-only authored
    commands/history are explicitly not claimed to be redacted.
12. Record actual value-free watch/interval metadata on config-load evidence.
    Cost: closed new-profile schema changes reject pre-fix unpublished snapshots;
    typed persistence tests cover it. Grading does not match Solution text.
13. Admit publisher route traces only when linked to the same operation's actual
    publication and retained delivery. Cost: unrelated-route acceptance; forged
    link rejection and real pipeline persistence are covered.
14. Preserve private direct numeric query-cell provenance for metric consumption,
    with optional metricInput on the existing export journal. Cost: numeric
    compatibility regressions; focused arithmetic/JSON/logging checks cover the
    seams. Public numbers remain plain JSON; arithmetic/serialization loses
    direct-cell credit as documented. Literal metrics remain supported.
15. Correct only the handmade old Functions fixture's missing Python manifest
    ID, keeping production preflight and assertions intact. Cost: concealing a
    real manifest compatibility regression; the focused real-manifest Functions
    checks and unchanged Data/Messaging compatibility checks remain passing.
16. Treat the deployment-discovered Event Grid fixture mismatch as a narrow
    post-merge compatibility repair, not a reopened whole-branch fix wave. Supply
    or preserve the Python manifest in five existing fixture shapes; assertions
    and production validation remain unchanged. Cost: hiding a real manifest
    contract regression; named RED and owning-file 18/18 GREEN plus independent
    static review verify the legitimate fixture correction.

## Deferred review items

- Persisted App Configuration location:null admission: fixed and independently
  approved in the final fix wave.
- First RED timing capture gap: retain disclosure, do not fabricate timing.
- Existing bundle-size advisory/CRLF notices: no unrelated warning cleanup.

## Integration

Whole-branch review covered all 77 changed files. The final fix wave addressed
Service Bus payload/metadata/receipt privacy, Lab1's overprivileged-role grading,
and the malformed location save. Three covering files passed 63/63; fix-wave
all-attempt execution was 16.145 seconds. Scoped independent re-review approved
all findings with no new breakage. The original security review and the final
release review are separate gates, both now approved.

The approved journey-width change is committed separately as 3693c77, with its
fresh Pages-base build passing. Discussion history is preserved as d4fb1a0.
No additional journey or duplicate monitoring Labs were introduced.

Pending when this candidate record was prepared: merge into main, merged
verification, push, Pages deployment and live catalog verification. Preserve
local scratch/worktree until records are durable and integration is recoverable.

### Merged verification

Merge commit 16bc2e5 combines the reviewed feature, separate width fix and history
documentation. Fresh merged checks all passed:

- Nine-file journey aggregate: 140/140, 8.4202532 seconds.
- Four-file compatibility: 101/101, 8.7176261 seconds.
- Pages-base build: exit 0, 8.8133898 seconds; existing chunk-size advisory.

The scoped final fix review approved all three findings with no new breakage.
No AKS/Container Apps/full/cloud/browser suite was run. The subsequent change
recording these results modifies only this release document, not tested code.
Publication is through the existing main-branch Pages workflow; consult its
commit-linked result and the live site for deployment evidence.

### First deployment attempt and fixture correction

Pages run 37271610116 stopped at one of 217 focused Messaging checks (216 passed);
the Data checks passed. A handmade Event Grid test project omitted its manifest,
selecting the default .NET protected scaffold before execution. Commit c7ae39b
corrects only five fixture substitutions within that existing test. All assertions
and source programs are unchanged; production and workflow code are untouched.
Named RED reproduced the failure; owning-file GREEN passed 18/18, with all
captured repair attempts totaling 11.719 seconds. Independent static review
approved it. The first CI job ran 22 seconds and did not reach deployment.
The corrected candidate will be retried through the unchanged Pages workflow.

### Successful deployment and live verification

[Pages run 37272354536](https://github.com/AlexandruCristianRobert/Azure-Trainer/actions/runs/37272354536)
succeeded for ad94b6cc6aae74ecd1b763bf41aadf0907a53043. Its complete job ran
33 seconds, including focused Data, Messaging, Security/Observability, build and
deployment steps. No AKS or Container Apps suite ran.

The [published site](https://alexandrucristianrobert.github.io/Azure-Trainer/)
returned HTTP 200. Its index-Cyhq8TpX.js, vendor-BmSn0oGt.js and
index-6aPh-jT6.css assets returned 200. All twelve journey titles and the journey
heading were present; the removed 440-pixel journey constraint was absent.
Local registry verification also established 84 total Labs and twelve unique,
ordered Security/Observability Labs.

The first live marker check incorrectly required complete literal lab IDs, which
the bundle generates from stage names. This was a verification-method error,
not a deployment defect. A local-bundle check confirmed the generated-ID shape;
the corrected live check verified all twelve distinct authored titles, heading,
assets and width rule. The failed first check's final timer was not emitted;
its reported tool wait was about ten seconds. Subsequent live checks were timed
(38.4215619 and 7.5732527 seconds). Together with the earlier first-RED capture
gap, this prevents an exact all-attempt elapsed-time claim; disclosures remain.

Both Important final-review issues, the malformed-location minor and the
deployment fixture compatibility issue are addressed and independently reviewed.
Only the disclosed capture limitations, ordinary CRLF notices and existing
bundle-size advisory remain; no functional blocker is deferred.

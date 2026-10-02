# Security and Observability Journey design

Status: approved direction. The user approved the recommended structure and explicitly delegated remaining design choices, planning, Superpowers implementation, merge and publication on 2026-10-02. No additional approval gate is required.

## Outcome

Add twelve independently startable, progressive Labs to the existing Order Processing Application. Learners create resources and write Python application code rather than repeat experiments. Python follows the current AI-200 skills outline; concise C# comparisons explain familiar equivalents without maintaining a second execution track.

The application processes orders through a Service Bus Function, publishes OrderProcessed events through Event Grid and notifies orders through an Event Grid Function. A clearly simulated notification provider now consumes a **demo-only** API key retrieved from Key Vault. No network notification or actual credential is required. The provider accepts the current version, making stale credentials fail and rotation observable.

## Global Constraints

- Exactly 12 Labs, journeyId `security-observability`, skillAreaId `secure`; Labs 1–11 guided and Lab 12 capstone.
- Continue the existing Order Processing Application; browser-only bounded simulation, no live Azure, network SDK calls, installed Python or real credentials.
- Use saved Python source, meaningful simulated SDK operations and actual resource authorization; never exact-match Solution text or grade an unused secret lookup.
- Keep Solutions hidden on demand, Task Rationale separately collapsed and Explanation Prompts locally copyable; prompts contain authored concepts only, no workspace data or credentials.
- Independently supplied earlier-stage baselines contain no completion proof; every newly assigned Task starts unfinished.
- One compact behavior exercise per Lab; no Guided/Troubleshooting/Independent triples, repeated experiment padding or additional Functions/App Service track.
- Preserve existing Messaging and Data behavior and the unrelated approved journey-width CSS change.
- No AKS, Container Apps, full legacy replay, cloud or broad browser test suites. Time every executable test, diagnostic and build attempt including failures, reruns and CI; reduce/refactor checks if cumulative verification exceeds 30 minutes per Lab publication.
- Unsupported source, SDK, CLI or KQL input must produce an explicit diagnostic before unrelated side effects; arbitrary host code, eval, subprocess and network execution remain unavailable.
- Resource authorization uses the application's attached principal at exact supported scopes; learner provisioning authority is not application read authority.
- Public execution traces, telemetry, diagnostics and evidence must not expose demo secret values or sensitive payload values; secrets remain confined to explicitly modeled Key Vault/configuration and opaque consumer handles.
- Evidence comes only from the current execution and actual consumed values, spans or query rows; relevant saved-file/resource changes and change/revert invalidate proof. Unrelated notes do not.
- Persisted runtime and evidence are finite typed bounded data with causal journal linkage; reset clears proof and restores the supplied baseline.

## Curriculum

| Lab | New construction | Compact evidence |
| --- | --- | --- |
| 1 | Attach application identity and grant exact-scope least-privilege secret read | Actual application read succeeds only through the attached authorized principal |
| 2 | Write SecretClient retrieval and feed the notification provider | Provider accepts the actually retrieved demo credential |
| 3 | Create a new secret version and refresh the consumer | Latest credential succeeds; pinned/stale version is rejected |
| 4 | Create App Configuration settings and environment labels; load from Python | Consumer uses the selected label's actual setting |
| 5 | Configure refresh and Key Vault references | Refreshed provider resolves the actual reference and changed setting |
| 6 | Configure OpenTelemetry and the simulated Application Insights destination | Explicit SDK setup exports application telemetry to the configured destination |
| 7 | Instrument business spans, attributes and errors | Actual operations occur inside the learner-created span; error records reflect failures |
| 8 | Propagate trace context between order processing and notification | Producer and consumer spans share the propagated trace and correct parent context |
| 9 | Write structured logs and redact sensitive fields | Public log records retain useful metadata but no credential or sensitive payload values |
| 10 | Write KQL for failed operations | Actual saved query filters and returns the measured failure rows |
| 11 | Record metrics and query latency/retries/failure rate | Aggregation computes results from actual bounded telemetry rows |
| 12 | Secure and instrument the full Order Processing flow | One combined source-driven run and saved query prove secure notification and correlated safe telemetry |

## Runtime boundaries

Extend the existing bounded Python parser/VM through explicit imported exports, typed handles and call signatures. Keep new security/telemetry logic in focused modules rather than copying or replacing the messaging interpreter. Enable the new behavior only for this journey's declared capability and preserve prior DefaultAzureCredential semantics in old Labs.

Support only the documented synchronous teaching subset necessary for these twelve Labs. README, task copy, module manifest and diagnostics must disclose supported calls and deviations from Azure. Managed identity selection, RBAC and demo secret consumption are real simulator boundaries, not real authentication.

App Configuration is its own resource/provider with labeled settings, refresh registration and secret references; generic Function app settings are not a substitute. OpenTelemetry instrumentation creates explicit spans, log records and metrics; broker traces are not relabeled as application instrumentation. KQL evaluation parses and evaluates saved queries against actual exported rows, never selects canned answers from strings.

Use deterministic logical duration and retry metadata clearly labeled as simulation, with bounded rows and executions. Trace propagation is explicit carrier injection/extraction supported by the subset, not an unexplained automatic shared identifier. Query table names and columns follow the chosen official Application Insights schema consistently.

## Verification and release

Each owning task uses short RED/GREEN checks and one independent review. Curriculum tests execute each Lab's Solution once and check unfinished baseline, meaningful result, and persistence. Targeted negative checks pin wrong principal/scope, stale secret, missing span/context, privacy leaks, unsupported queries and tampered evidence. Reuse those assertions rather than replay every Lab for every negative.

Before publication run the narrow new-journey aggregate, focused Messaging/Data compatibility tests, and a Pages-path production build. Merge to main and publish via the existing GitHub Pages workflow as explicitly requested; watch the deployment and check the published site. Keep the approved journey layout fix in a separate commit and do not lose it.

## Sources

- [AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200)
- [Python Key Vault secrets quickstart](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-python)
- [Python App Configuration provider quickstart](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-python-provider)
- [Application Insights overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [Azure Monitor log queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-query-overview)

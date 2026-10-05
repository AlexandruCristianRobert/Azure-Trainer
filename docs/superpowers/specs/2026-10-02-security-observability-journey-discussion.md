# Security and Observability Learning Journey — discussion

Status: discovery completed. The user approved the recommended direction and then explicitly requested autonomous planning, Superpowers implementation, merge and publication. The binding design and implementation plan are the adjacent security-observability-journey-design specification and the security-observability-journey plan.

## Agreed requirements

- Continue the existing Order Processing Application rather than introduce an unrelated application.
- One Security and Observability Learning Journey, with at most 15 Labs; do not pad the count.
- Follow the Messaging journey style: progressive resource creation and Python code-writing Labs, independently startable stages, one final Capstone, and one compact behavior exercise per Lab.
- Preserve hidden on-demand Solutions, separately collapsed Task Rationale, useful C# comparisons, and locally copied Explanation Prompts without workspace/credential disclosure or automatic external requests.
- Keep developer verification small and measured. No AKS, Container Apps, full legacy replay or broad browser suites; reduce/refactor expensive checks if cumulative verification exceeds 30 minutes per Lab publication, including reruns and CI.
- Retain the browser-based bounded Sandbox; do not require live Azure, real credentials, installed Python or an external execution service.

## Existing implementation boundaries

- The Messaging journey has real simulated Service Bus and Event Grid handlers plus Python Functions registration and source-driven invocation.
- Its DefaultAzureCredential currently produces a trainer credential handle, not a principal with enforced service permissions. New security checks must implement the relevant authorization boundary rather than mistake handle creation for authentication/authorization proof.
- The existing notification operation records an in-memory business effect. It does not contact a provider or need a secret. A meaningful credential-consumer exercise needs an explicitly agreed application extension.
- Existing Key Vault practice configures a vault, learner RBAC, demo secret versions and manual rotation; it does not execute Python application-side secret retrieval.
- No dedicated App Configuration, OpenTelemetry or KQL learning flow was found. Generic app settings, existing broker traces and platform diagnostics are not substitutes for those topics.
- The unrelated approved journey-width CSS fix remains uncommitted in src/styles/pages.css and must be preserved, not silently bundled into this journey.

## Approved curriculum direction

Recommend 12 Labs: identity and least privilege; Python secret retrieval; consumer-aware secret rotation; labeled App Configuration; configuration refresh and Key Vault references; telemetry setup; business spans; cross-component trace context; structured logs and secret redaction; failure-analysis KQL; metrics/latency aggregation; combined Capstone.

Proposed business addition: a clearly labeled simulated notification provider consumes a dummy API credential retrieved from Key Vault. It performs no network call or real notification. This gives retrieval and rotation a consumer-visible consequence instead of grading an unused secret lookup.

## Execution decision

The simulated notification-provider credential was accepted with the recommended structure. The written design defines actual application authorization, consumer-aware rotation, same-provider refresh and bounded instrumentation/query evidence. HTTP Functions and App Service remain separate gap-fillers, not automatic scope additions.

## Monitoring scope discussion reopened — 2026-10-05

The user explicitly requested returning to the previously discussed monitoring
subject rather than following the assistant's subsequent App Service suggestion.
That suggestion is not an approved change to the learning sequence.

The earlier AKS discussion deferred dedicated OpenTelemetry instrumentation and
KQL authoring to later monitoring Labs. The approved combined Security and
Observability specification then assigned those topics to Labs 6–11: exporter
setup, business spans, distributed context, structured logs, failure queries and
metrics. Those Labs and the integrated Capstone are implemented locally on
codex/security-observability, but are not merged or published.

The current Grill with Docs discussion must distinguish finishing that existing
monitoring portion from authoring an additional monitoring-focused journey.
No additional curriculum, split/restructure, or monitoring expansion is approved
by this clarification. Preserve the existing code-first, bounded-simulation,
on-demand explanation and small-verification requirements.

Decision: the user accepted the recommendation to finish the existing monitoring
portion first, then identify any genuinely missing topics. Resume the existing
journey's review/integration/publication work; do not create another journey or
duplicate Labs 6–11. The earlier merge/publication request remains subject to
the existing review and verification gates.

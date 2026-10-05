# HTTP Functions Learning Journey — discussion

Status: architectural discovery with Grill with Docs and Superpowers
brainstorming. Topic selected; written design/implementation plan not approved.
No implementation or verification runs have started.

## Decision agreed

The user selected HTTP APIs with Azure Functions as the next journey, rather
than App Service container hosting or an expansion of the completed monitoring
journey. It adds an HTTP entry point to the existing Order Processing Application.

## Requirements carried forward

- Code-first progressive Labs, maximum 15; do not pad the count.
- Python application code with useful C# comparisons for the learner.
- Hidden on-demand Solutions, independently collapsed Task Rationale, and
  locally copyable authored Explanation Prompts.
- Browser-only bounded simulation: no live Azure, real credentials, installed
  Python or external execution service.
- Independently startable earlier-stage baselines without completion proof.
- Compact learner behavior checks and short, measured developer verification.
  Exclude AKS/Container Apps/full/broad browser suites; reduce or refactor checks
  if testing exceeds 30 minutes per Lab publication, including retries and CI.

These are established preferences, not approval of a new detailed design.

## Verified existing boundaries

The legacy Serverless API Lab explicitly covers hosting configuration only;
it does not deploy HTTP function code or serve requests. The newer Python
Functions runtime currently registers Service Bus and Event Grid handlers,
not HttpRequest/HttpResponse/HTTP route handlers. Resource configuration and
the earlier event-processing flow can inform the new design, but HTTP execution
must be explicitly designed and implemented before it is claimed.

## Complete flow agreed

The user approved the complete submit-and-check flow rather than isolated HTTP
examples:

- POST /api/orders validates the submitted body, actually queues the accepted
  order, and returns 202 Accepted. Invalid input returns 400 without queueing.
- GET /api/orders/{id} reports actual processing status, or 404 for an unknown
  order.
- The earlier worker is supplied so the new learning focus is the HTTP layer,
  not repeating the Messaging journey.

Acceptance is not completed processing. A returned status alone cannot prove
that queueing or processing occurred; evidence must bind to actual operations.

## Status repository agreed

Existing runtime state retains actual queue messages and processed-order effects,
but it has no exposed complete Order Status read model (was_processed only
answers whether an order was processed). Do not assume an HTTP status repository
already exists or use handler_status, which is authored delivery-outcome control.

The user selected a supplied, clearly simulated status repository backed by
actual queue/processing state, retained across simulated host restarts. This
keeps the new Labs focused on request handling without repeating Cosmos DB
provisioning. It is not a Python process-global dictionary and is not a claim of
real Azure storage. Lab reset still restores its independently supplied baseline
and clears completion proof. No Cosmos DB work is added to this journey.

## Repeat-submission contract agreed

The user approved retrying the same order ID with the same accepted
payload returns the existing acknowledgement/status without another enqueue.
Reusing the ID for a different payload returns 409 Conflict and does not mutate
the original order or queue extra work. This is an HTTP/API contract, not a
repeat of the Messaging duplicate-processing Lab.

Existing broker duplicate detection is configured and windowed; it does not
establish an indefinite HTTP idempotency/conflict contract by itself. The detailed
repository/queue coordination and supported request-concurrency boundary must
be designed explicitly, without claiming a production distributed transaction.

## Execution direction

The user then explicitly delegated remaining recommended choices and requested
the written plan followed by immediate Superpowers implementation. Preserve the
selected flow and preferences; resolve remaining design choices in the written
specification and plan rather than restarting the interview or adding approval
menus. Inspectable written artifacts and inline self-review precede product code.

Recommended scope: nine Labs (eight progressive build Labs and one Capstone).
Remaining technical choices must distinguish local host simulation from captured
publication, enforce function keys only where the deployed endpoint requires
them, retain actual status/idempotency evidence, and disclose simulation limits.
Do not add database, App Service, identity-provider or monitoring curricula just
to fill the Lab limit. This instruction authorizes implementation and local
commits, not a new remote merge/publication request.

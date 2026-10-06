# Connect bank editorial ledger

Author review date: 2026-10-06. All 30 items are original. Author checked every
expected answer and legal distractor against the primary pages below, including
the Python SDK/decorator API names. The original author ledger and independent
gate are preserved below. Current verdicts incorporate the controller-owned
review and keep the x019/x027 text clarifications pending re-review.

The envelope uses one primary objective and its canonical concept per question.
Each component is one point. Multipart reasons include a justification for every
legal candidate, including position-specific build-list distractors. Answer keys
below use root component order; braces denote an unordered set.

## Exact primary paths and sections

All links were opened and reviewed on 2026-10-06. The page codes in the item table
resolve to these exact primary paths, not to search results. Canonical references
are S, E, H and J; remaining sources are item-level supporting references.

| Code / exported reference ID | Primary page | Sections inspected |
| --- | --- | --- |
| S / ref-connect.servicebus | [Message transfers, locks, settlement](https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement) | Settling send operations; Settling receive operations; Renew locks |
| E / ref-connect.eventgrid | [Event filtering](https://learn.microsoft.com/en-us/azure/event-grid/event-filtering) | Event type filtering; Subject filtering; StringIn; OR and AND |
| H / ref-connect.functions-api | [HTTP trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger) | Python examples; Decorators; Customize the HTTP endpoint |
| J / ref-connect.functions-host | [host.json reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json) | Sample host.json; extensionBundle; logging; version; environment configuration; Override host.json values |
| A / connect-async | [Asynchronous request-reply](https://learn.microsoft.com/en-us/azure/architecture/patterns/asynchronous-request-reply) | Solution; input validation; status endpoint; Location header |
| Q / connect-sb-sql | [SQL filter syntax](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-messaging-sql-filter) | Arguments; user scope; string_constant; property names |
| F / connect-sb-filters | [Topic filters and actions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/topic-filters) | Default rule; SQL filters; Boolean filters; body-evaluation restriction |
| C / connect-sb-topology | [Queues, topics and subscriptions](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-queues-topics-subscriptions) | Receive modes; Topics and subscriptions; Subscription filters |
| R / connect-sb-python | [Python ServiceBusReceiver](https://learn.microsoft.com/en-us/python/api/azure-servicebus/azure.servicebus.servicebusreceiver?view=azure-python) | receive_messages; complete_message; abandon_message; dead_letter_message; peek_messages |
| D / connect-sb-dlq | [Service Bus dead-letter queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues) | Maximum delivery count; application-level dead-lettering; no automatic cleanup |
| U / connect-sb-duplicates | [Duplicate detection](https://learn.microsoft.com/en-us/azure/service-bus-messaging/duplicate-detection) | How it works; MessageId; nonpartitioned identity; history window |
| G / connect-eg-delivery | [Event Grid delivery/retry](https://learn.microsoft.com/en-us/azure/event-grid/delivery-and-retry) | At-least-once and ordering; webhook retry error table; Retry policy; Dead-letter events |
| P / connect-python | [Python Functions reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python) | Python v2 model and project structure; local-only settings; requirements.txt; Build and deployment |
| V / connect-app-settings | [Functions app settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings) | FUNCTIONS_WORKER_RUNTIME; FUNCTIONS_EXTENSION_VERSION; Flex deprecations |
| B / connect-sb-trigger | [Functions Service Bus trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger) | Python v2 topic-trigger example; Decorators; connection setting name |
| I / connect-http-request | [Python HttpRequest API](https://learn.microsoft.com/en-us/python/api/azure-functions/azure.functions.httprequest?view=azure-python) | Constructor; get_json; params; route_params; method |
| X / connect-http-host | [HTTP host settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook#hostjson-settings) | host.json settings; routePrefix default |
| L / connect-deploy | [Deployment technologies](https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-technologies#remote-build) | Remote build; Linux Core Tools behavior; plan-specific configuration |
| T / connect-sb-send | [Python ServiceBusSender](https://learn.microsoft.com/en-us/python/api/azure-servicebus/azure.servicebus.servicebussender?view=azure-python) | send_messages signature, acknowledgement behavior and ServiceBusMessage example |

Version/context boundaries: current azure-servicebus Python SDK, not retired
Service Bus legacy libraries or SBMP; ordinary durable entities; valid PeekLock
receiver/lock for settlement questions. Event Grid questions explicitly use BASIC
custom-topic push webhook subscriptions, not namespace pull subscriptions.
Retryable 500 and nonretryable 400 are webhook-specific; dead-letter destination
exists and is writable where relevant. No claim of immediate dead-letter writes,
exact retry timings, guaranteed event ordering, or exactly-once effects.
Functions uses Python v2 decorators. Worker/runtime app-setting questions exclude
Flex Consumption, whose runtime configuration differs. Host schema 2.0, runtime
4.x and bundle interval 4.x are separate. No trainer-only helper is presented as
a production SDK API. Displayed code holes are authored placeholders, not code
to execute. Schema constraints and atomic status commits are stated application
requirements, rather than claims that Azure automatically provides them.

## Per-item answer and distractor review

The Outcome column preserves the initial **author checked; independent pending**
gate at 5d9edd4. Current independent verdicts follow in their own table. The date
is the actual review date, not an inferred publication date. Sources include the
canonical page plus each necessary supporting page. The complete candidate-level
reasoning remains in each DTO; this ledger records the editorial cross-check.

| Item | Objective / concept | Primary pages / relevant sections | Date | Literal key | Answer and distractor check | Family | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ai200-x001 | connect.servicebus / connect.queue-acceptance | S send; A Solution | 2026-10-06 | no | Send success and 202 show acceptance; yes lacks the required stock commit. | ai200-x001 | author checked; independent pending |
| ai200-x002 | connect.servicebus / connect.queue-acceptance | S send/receive; A status endpoint | 2026-10-06 | yes | Given authoritative completed status follows atomic commit; no contradicts that explicit contract. | ai200-x001 | author checked; independent pending |
| ai200-x003 | connect.servicebus / connect.queue-acceptance | S receive | 2026-10-06 | no | Receipt before commit is insufficient; yes confuses locked receipt with completed work. | ai200-x001 | author checked; independent pending |
| ai200-x004 | connect.servicebus / connect.queue-acceptance | S receive; Q user scope/string; F SQL/body | 2026-10-06 | property | region equals quoted north; body path unsupported, true rule admits all. Default rule is explicitly removed. | ai200-x004 | author checked; independent pending |
| ai200-x005 | connect.functions-api / connect.http-validation | H Python; I get_json/attributes | 2026-10-06 | json | Parsed body API is get_json; params and route_params read other request locations. | ai200-x005 | author checked; independent pending |
| ai200-x006 | connect.functions-host / connect.host-configuration | J environment; V worker; P project files | 2026-10-06 | azure | Deployed environment needs the app setting; host root key and excluded local file do not provide it. | ai200-x006 | author checked; independent pending |
| ai200-x007 | connect.servicebus / connect.queue-acceptance | S receive; R complete/abandon; C receive modes | 2026-10-06 | {complete, abandon} | Post-commit complete removes work; temporary failure abandon enables redelivery. Early complete and receive-and-delete do not preserve the stated retry path. | ai200-x007 | author checked; independent pending |
| ai200-x008 | connect.eventgrid / connect.event-routing | E filtering; G delivery/retry/order | 2026-10-06 | {retry, idempotent} | 500 permits retries; repeated delivery needs safe effects. once/order invent unsupported guarantees. | ai200-x008 | author checked; independent pending |
| ai200-x009 | connect.eventgrid / connect.event-routing | E event type/subject/StringIn/AND | 2026-10-06 | {north, priority} | Both match all conditions; URGENT matches StringIn case-insensitively. south, created and normal each fail one configured condition. | ai200-x009 | author checked; independent pending |
| ai200-x010 | connect.functions-api / connect.http-validation | H Python ValueError; I JSON; A validation | 2026-10-06 | {parse, schema} | JSON parsing and explicit schema guard precede send; unconditional accept and send-first violate requirements. | ai200-x010 | author checked; independent pending |
| ai200-x011 | connect.functions-host / connect.host-configuration | J environment; P dependencies; B connection | 2026-10-06 | {requirements, settings} | Declare decorator dependency and deployed connection setting; raw decorator secret and automatic local-value publishing are incorrect. | ai200-x011 | author checked; independent pending |
| ai200-x012 | connect.servicebus / connect.queue-acceptance | S PeekLock/settlement; R receive/complete | 2026-10-06 | receive, commit, complete | Receive before payload work, commit before removal. All legal alternatives reviewed separately at each position; early deletion never meets the condition. | ai200-x007 | author checked; independent pending |
| ai200-x013 | connect.functions-api / connect.http-validation | H request; A validation/202/Location; S send | 2026-10-06 | validate, send, respond | Ordered prerequisites enforce validated durable acceptance before 202. Each displaced stage and optimistic response checked per position. | ai200-x010 | author checked; independent pending |
| ai200-x014 | connect.functions-host / connect.host-configuration | J host; P project/build; L remote build | 2026-10-06 | declare, publish, probe | Saved dependencies feed remote build; deployed revision verification follows publish. Prepublish verification and Windows .venv copy do not substitute for those stages. | ai200-x014 | author checked; independent pending |
| ai200-x015 | connect.eventgrid / connect.event-routing | E subscription filtering; G dead-letter events | 2026-10-06 | destination, subscribe, test | Container exists before subscription reference; route exists before test. Default dead-lettering assumption and out-of-position stages checked for each slot. | ai200-x015 | author checked; independent pending |
| ai200-x016 | connect.servicebus / connect.queue-acceptance | S settlement; R operation signatures; D application DLQ | 2026-10-06 | complete, abandon, deadletter | Successful, transient and permanently invalid outcomes need distinct settlement. All other operations checked per outcome; peek never settles. | ai200-x007 | author checked; independent pending |
| ai200-x017 | connect.eventgrid / connect.event-routing | E type filtering; G webhook error table | 2026-10-06 | retry, deadletter, exclude | Matching 500 retries; matching 400 schedules DLQ without retry; nonmatching type is excluded. Wrong treatments and unlimited retry checked per observation. | ai200-x017 | author checked; independent pending |
| ai200-x018 | connect.functions-api / connect.http-validation | H Python/route; I attributes/get_json | 2026-10-06 | query, route, body | Each request source maps to its API; every other source and req.method rejected per target. | ai200-x005 | author checked; independent pending |
| ai200-x019 | connect.functions-host / connect.host-configuration | J environment/logging/Override host.json values; P local files | 2026-10-06 | host, azure, local | Logging target now explicitly requests the checked-in authored project host file. AzureFunctionsJobHost__logging__ app settings can override runtime logging but do not replace the requested file. Deployed connections/local Values retain their roles. | ai200-x006 | author checked; independent pending |
| ai200-x020 | connect.eventgrid / connect.event-routing | E includedEventTypes/subjectBeginsWith | 2026-10-06 | type, subject | Harbor completed type and north prefix; created and south select different routes. Advanced condition retained. | ai200-x009 | author checked; independent pending |
| ai200-x021 | connect.servicebus / connect.queue-acceptance | S messaging; Q user scope/string; F body | 2026-10-06 | property, literal | region is custom property; quoted north is literal. body path unsupported; unquoted north means property, not string. | ai200-x004 | author checked; independent pending |
| ai200-x022 | connect.functions-api / connect.http-validation | H Decorators; X routePrefix | 2026-10-06 | route, post | Relative orders plus api prefix yields requested path; repeated api prefix and GET conflict with route/verb requirements. | ai200-x022 | author checked; independent pending |
| ai200-x023 | connect.functions-host / connect.host-configuration | J version; V worker/runtime/Flex | 2026-10-06 | python, v4 | Python worker and ~4 runtime setting for non-Flex; node is wrong language, 2.0 is host schema. | ai200-x006 | author checked; independent pending |
| ai200-x024 | connect.servicebus / connect.queue-acceptance | S redelivery; U MessageId/window; D maximum delivery count | 2026-10-06 | yes, no, yes | Duplicate send can succeed with copy dropped; consumer redelivery still possible; repeated abandonment can exceed delivery limit and DLQ. Opposite answers checked individually. | ai200-x007 | author checked; independent pending |
| ai200-x025 | connect.eventgrid / connect.event-routing | E subscription; G order/retry policy | 2026-10-06 | no, yes | No ordering guarantee; first exhausted attempt/TTL limit stops delivery. Opposite statements checked, without claiming exact expiry/write time. | ai200-x008 | author checked; independent pending |
| ai200-x026 | connect.functions-api / connect.http-validation | H Python error/HttpResponse; I JSON | 2026-10-06 | no, yes | Successful parse does not enforce schema; ValueError guarded 400 before send meets malformed-input rule. Each opposite answer checked. | ai200-x010 | author checked; independent pending |
| ai200-x027 | connect.servicebus / connect.queue-acceptance | S broker; C topic/subscription model; F SQL rules | 2026-10-06 | {billing, warehouse} | Inventory explicitly includes all three idle provisioned subscriptions and only their stated filters. North and urgent match; south-only fails and topic is the publisher. | ai200-x004 | author checked; independent pending |
| ai200-x028 | connect.functions-api / connect.http-validation | H Python guards/response; I JSON; T send_messages | 2026-10-06 | {invalid, missing} | JSON and schema guards are the two validation blocks; SDK enqueue and accepted response are later effects. | ai200-x010 | author checked; independent pending |
| ai200-x029 | connect.functions-host / connect.host-configuration | J environment; B Python v2 topic example/connection | 2026-10-06 | topic, subscription, connection | orders/fulfill/OrdersBus are declared scenario values and real decorator fields; queue parameter, audit route and raw secret are wrong per field. | ai200-x011 | author checked; independent pending |
| ai200-x030 | connect.functions-host / connect.host-configuration | J version/extensionBundle | 2026-10-06 | schema, bundle | Host schema 2.0; half-open interval excludes 5.0.0. 4.0 host schema and inclusive upper bound each contradict the field requirement. | ai200-x011 | author checked; independent pending |

## Current independent verdicts — 2026-10-06

Controller-owned reviewer `/root/exam_bank_connect_review` inspected the actual
range c5d24d6..5d9edd4 on 2026-10-06. The initial gate was Needs fixes: Important
x019 allowed a documented app-setting logging override to compete with host.json;
Minor x027 omitted the third subscription from the inventory. All other facts,
keys, distractors and families were approved. This attribution is the supplied
controller review result, not a new author-created independent approval.

Fix round 1 starts at 10ff853. x019 now explicitly requests the checked-in host
configuration file and acknowledges supported environment logging overrides;
x027 names all three subscriptions and applies rule removal/idle/provisioning
conditions to all three. Keys, family assignments, counts and source URLs are
unchanged. Only those two text deltas require the original reviewer's re-review.

| Item | Current verdict |
| --- | --- |
| ai200-x001 | Independently approved at initial gate; unchanged |
| ai200-x002 | Independently approved at initial gate; unchanged |
| ai200-x003 | Independently approved at initial gate; unchanged |
| ai200-x004 | Independently approved at initial gate; unchanged |
| ai200-x005 | Independently approved at initial gate; unchanged |
| ai200-x006 | Independently approved at initial gate; unchanged |
| ai200-x007 | Independently approved at initial gate; unchanged |
| ai200-x008 | Independently approved at initial gate; unchanged |
| ai200-x009 | Independently approved at initial gate; unchanged |
| ai200-x010 | Independently approved at initial gate; unchanged |
| ai200-x011 | Independently approved at initial gate; unchanged |
| ai200-x012 | Independently approved at initial gate; unchanged |
| ai200-x013 | Independently approved at initial gate; unchanged |
| ai200-x014 | Independently approved at initial gate; unchanged |
| ai200-x015 | Independently approved at initial gate; unchanged |
| ai200-x016 | Independently approved at initial gate; unchanged |
| ai200-x017 | Independently approved at initial gate; unchanged |
| ai200-x018 | Independently approved at initial gate; unchanged |
| ai200-x019 | Important ambiguity clarified by author; pending original-reviewer re-review |
| ai200-x020 | Independently approved at initial gate; unchanged |
| ai200-x021 | Independently approved at initial gate; unchanged |
| ai200-x022 | Independently approved at initial gate; unchanged |
| ai200-x023 | Independently approved at initial gate; unchanged |
| ai200-x024 | Independently approved at initial gate; unchanged |
| ai200-x025 | Independently approved at initial gate; unchanged |
| ai200-x026 | Independently approved at initial gate; unchanged |
| ai200-x027 | Facts/key approved; Minor inventory clarification pending original-reviewer re-review |
| ai200-x028 | Independently approved at initial gate; unchanged |
| ai200-x029 | Independently approved at initial gate; unchanged |
| ai200-x030 | Independently approved at initial gate; unchanged |

## Families and group continuity

There are 30 items but 13 fresh families. Revisions remain 1. Equivalent widget
facts and conservatively related pipeline/configuration facts share a family;
fresh evidence is intentionally not inferred from question count.

| Family | Items | Reason |
| --- | --- | --- |
| ai200-x001 | x001, x002, x003 | One series completion-evidence problem, three independent yes/no proposals. |
| ai200-x004 | x004, x021, x027 | Service Bus subscription property filtering/routing expressed in different widgets. |
| ai200-x005 | x005, x018 | Python request data-source APIs; matching reuses the body-API fact. |
| ai200-x006 | x006, x019, x023 | Deployed versus local versus host configuration; language/runtime settings. |
| ai200-x007 | x007, x012, x016, x024 | Settlement, redelivery, and conservative duplicate/exhaustion handling variants. |
| ai200-x008 | x008, x025 | Retry/ordering contract expressed as selection and statement rows. |
| ai200-x009 | x009, x020 | Same Harbor notification filter conditions. |
| ai200-x010 | x010, x013, x026, x028 | Validation-before-enqueue pipeline; build-list retains the broader acceptance stage conservatively in the same family. |
| ai200-x011 | x011, x029, x030 | Binding/dependency deployment configuration; bundle configuration grouped conservatively rather than inflating samples. |
| ai200-x014 | x014 | Remote-build release dependency order and deployed revision verification. |
| ai200-x015 | x015 | Event Grid recovery-destination deployment prerequisites. |
| ai200-x017 | x017 | Webhook 500/400/filter exclusion treatment distinctions. |
| ai200-x022 | x022 | Python route declaration, host prefix and method restriction. |

Series-x1 is ordered x001/x002/x003 and explicitly requires completed processing.
Its no/yes/no keys are not forced uniform. Case-x1 is ordered x009/x020/x029:
one validated order API feeds a Service Bus worker, which publishes filtered
completion notifications; the last item configures that same worker binding.
The Event Grid filter and worker binding retain separate primary objectives.

Structural validation and literal-key grading passed the focused Connect test.
Those tests do not establish primary-source factual correctness or confer
approval of the two text clarifications pending independent re-review.

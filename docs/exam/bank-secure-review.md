# Secure bank author fact ledger

Final gate (2026-10-06): `/root/exam_bank_secure_review` independently approved
all30 Secure editorial/source relationships and the complete120-item assembly,
spec and quality at `3d8afef`, with no findings. The author-era PENDING statements
and row outcomes below are historical and superseded by this final verdict.
Task11 records the actual gate without a second source-review fleet.

Review date: 2026-10-06. Author checked all 30 keys and every legal candidate.
Independent controller review: PENDING for all 30 items and full-bank assembly.
No unresolved author correctness/source findings. Structural tests do not certify facts.
All scenarios are original; no exam dumps or runtime-generated questions were used.

The table's source codes resolve to exact primary URLs and sections below. Each row
uses objective/concept V, A, O or K: V = secure.vault / secure.secret-lifecycle;
A = secure.appconfig / secure.configuration-refresh; O = secure.otel /
secure.trace-context; K = secure.kql / secure.failure-query. Each component stays
in its root objective. Keys are listed in canonical component order; sets use braces.
Each row is dated 2026-10-06 and has outcome AUTHOR CHECKED / INDEPENDENT PENDING.

## Primary pages inspected

| Code / authored reference ID | Exact primary URL | Inspected section |
| --- | --- | --- |
| R / ref-secure.vault | https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide | Access model overview; Azure built-in roles for Key Vault data plane operations |
| L / ref-secure.appconfig | https://learn.microsoft.com/en-us/azure/azure-app-configuration/concept-key-value | Label keys; Query key-values |
| P / secure-provider | https://learn.microsoft.com/en-us/azure/azure-app-configuration/reference-python-provider | Load specific key-values using selectors; Configuration refresh; Key Vault reference / With credentials / Secret resolver; Key Vault secret refresh |
| D / secure-dynamic | https://learn.microsoft.com/en-us/azure/azure-app-configuration/enable-dynamic-configuration-python | Console applications; Web applications (refresh on retained provider) |
| S / secure-secretclient | https://learn.microsoft.com/en-us/python/api/azure-keyvault-secrets/azure.keyvault.secrets.secretclient?view=azure-python | get_secret; set_secret; update_secret_properties; list_properties_of_secrets; list_properties_of_secret_versions |
| Q / secure-secrets-quickstart | https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-python | Authenticate and create a client; Save a secret; Retrieve a secret |
| SV / secure-secret-value | https://learn.microsoft.com/en-us/python/api/azure-keyvault-secrets/azure.keyvault.secrets.keyvaultsecret?view=azure-python | Attributes / name and value |
| T / secure-rotation | https://learn.microsoft.com/en-us/azure/key-vault/secrets/tutorial-rotation-dual | Rotation solution steps 3–4 and alternating primary/secondary credentials |
| G / ref-secure.otel | https://opentelemetry.io/docs/languages/python/propagation/ | Manual context propagation / sending and receiving services |
| I / secure-instrumentation | https://opentelemetry.io/docs/languages/python/instrumentation/ | Creating spans; Creating nested spans; Get the current span |
| API / secure-otel-api | https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-api/src/opentelemetry/trace/__init__.py | Tracer.start_span; Tracer.start_as_current_span context argument, root parent semantics, end_on_exit |
| PROP / secure-otel-propagator | https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-api/src/opentelemetry/trace/propagation/tracecontext.py | TraceContextTextMapPropagator.extract and inject, carrier/context parameters |
| H / secure-sensitive | https://opentelemetry.io/docs/security/handling-sensitive-data/ | Your responsibility; Sensitive data considerations; Data minimization; Protecting sensitive data |
| W / ref-secure.kql | https://learn.microsoft.com/en-us/kusto/query/where-operator?view=microsoft-fabric | Syntax; Parameters; Returns |
| AR / secure-apprequests | https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apprequests | Columns: TimeGenerated datetime, Success bool, AppRoleName string, OperationId string, DurationMs real, ItemCount int |
| U / secure-summarize | https://learn.microsoft.com/en-us/kusto/query/summarize-operator?view=microsoft-fabric | Syntax; Returns; grouping and no-group output |
| C / secure-count | https://learn.microsoft.com/en-us/kusto/query/count-aggregation-function?view=microsoft-fabric | Syntax; Returns |
| CF / secure-countif | https://learn.microsoft.com/en-us/kusto/query/countif-aggregation-function?view=microsoft-fabric | Syntax; Returns; grouped example |
| AVG / secure-avg | https://learn.microsoft.com/en-us/kusto/query/avg-aggregation-function?view=microsoft-fabric | Arithmetic mean; Returns |
| B / secure-bin | https://learn.microsoft.com/en-us/kusto/query/bin-function?view=microsoft-fabric | Syntax; Returns; datetime example |
| PJ / secure-project | https://learn.microsoft.com/en-us/kusto/query/project-operator?view=microsoft-fabric | Only named columns retained; Returns preserves row count |
| SO / secure-sort | https://learn.microsoft.com/en-us/kusto/query/sort-operator?view=microsoft-fabric | sort/order equivalence; desc; Syntax |
| AGO / secure-ago | https://learn.microsoft.com/en-us/kusto/query/ago-function?view=microsoft-fabric | Syntax; Returns; last-hour example |

API and PROP are approved open-telemetry/opentelemetry-python repository paths;
they were inspected on the stated date, not assumed from memory. The additional
Context class source was inspected at
https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-api/src/opentelemetry/context/context.py
(class Context). Combined with API's explicit no-parent rule, this verifies the
empty-context root distractor. No trainer-only query helper appears as a production API.

## All-item checks

| ID | Topic | Family | Key | Sources / answer reason / all distractor checks |
| --- | --- | --- | --- | --- |
| ai200-s001 | V | ai200-s001 | no | R: Contributor is control-plane only. yes falsely grants secret data access; no correctly rejects it under the given RBAC-only permissions. |
| ai200-s002 | V | ai200-s001 | yes | R: Secrets User grants contents reads. no rejects a sufficient assignment despite working identity and network prerequisites. |
| ai200-s003 | V | ai200-s001 | no | R: Reader excludes sensitive values. yes confuses metadata with contents; no preserves that distinction. |
| ai200-s004 | A | ai200-s004 | production | L/P selectors: production matches the required environment; development selects the wrong label; wildcard violates the stated only-production selection. |
| ai200-s005 | O | ai200-s005 | current | I/API: start_as_current_span makes the span current and ends it on exit. detached creates a noncurrent manually managed span; lookup creates nothing. |
| ai200-s006 | K | ai200-s006 | failures | W/AR/AGO: time and false Success filters satisfy both predicates. success selects the wrong flag; old reverses the required time window. |
| ai200-s007 | V | ai200-s007 | {get,value} | S/Q: get requests latest; value extracts contents. list returns properties; set writes replacement data. |
| ai200-s008 | V | ai200-s007 | {set,latest} | S: an existing-name set creates a version and an unversioned get requests latest. properties cannot change contents; pinned specifies old_version. |
| ai200-s009 | O | ai200-s009 | {operation,status} | H and explicit Cedar policy: operation/status are permitted. token exposes authentication data; body includes prohibited contact details. This is a scenario allowlist, not a universal guarantee that any operation name is safe. |
| ai200-s010 | A | ai200-s004 | {enabled,refresh} | P/D ordinary refresh: enable it and call the retained provider. idle claims nonexistent automatic polling; immediate ignores the configured interval. |
| ai200-s011 | K | ai200-s006 | {total,failed} | U/C/CF/AVG/AR: count totals rows and countif filters failures within each role group. always includes successful rows; average measures duration. Unsampled/present Success premises avoid population-weight/null ambiguity. |
| ai200-s012 | V | ai200-s007 | client,get,value | Q/S: constructor precedes use and get precedes value. For slot1 get/value lack their objects; for slot2 client is already ready/value lacks secret; for slot3 client/get do not extract contents. write is outside retrieval in every position. All positions have individual candidate explanations. |
| ai200-s013 | V | ai200-s013 | regenerate,store,consume | T/S: alternate storage credential generation precedes publication and consumer handoff. store/consume are premature in slot1; regenerate repeats prior work and consume precedes publication in slot2; regenerate/store do not complete consumer handoff in slot3. revoke invalidates still-active key1 in all positions. This is explicitly a shared-storage-key workload, not a cryptographic KeyClient rotation-policy claim. |
| ai200-s014 | K | ai200-s006 | filter,summarize,sort | W/AR/AGO/U/C/SO/PJ: filter supplies input, summarize creates Count, descending order sorts it. Slot1 aggregation counts wrong rows/sort lacks Count/project drops filter columns; slot2 filter repeats/sort lacks Count/project does not aggregate; slot3 filter columns are gone/summarize recounts groups/project removes required Count and does not sort. |
| ai200-s015 | V | ai200-s001 | user,reader,officer | R role matrix: User is narrow contents reading, Reader metadata-only, Officer secret management. For read target Reader lacks values/Officer is broader/Contributor lacks data access; for metadata target User/Officer exceed scope/Contributor is resource management; for manage target User/Reader cannot create/Contributor lacks secret data permissions. |
| ai200-s016 | A | ai200-s004 | unlabelled,production,development | L/P: exact null-label, production and development filters match their targets. Each other exact label selects another environment; wildcard violates every only-one-label target. |
| ai200-s017 | O | ai200-s017 | extract,inject,current | G/I/API/PROP: extract decodes received carrier; inject writes current context; current retrieves the active span. For receive, inject/current/new do not decode; for send, extract/current/new do not serialize; for lookup, extract returns context/inject writes headers/new creates another span. |
| ai200-s018 | K | ai200-s006 | where,summarize,project | W/U/PJ/SO/AR: predicate filtering, grouped counting and column projection are distinct. Every alternative in each target performs the other operation or sorting; sorting changes neither membership nor column selection nor count. |
| ai200-s019 | A | ai200-s004 | production,refresh | L/P/D: production selects deployment and refresh checks updates after the elapsed interval. development selects the wrong environment; lookup reads cache alone. |
| ai200-s020 | V | ai200-s007 | get,value | S/Q/SV: get returns the latest value-bearing object; value contains the token. list returns metadata; name identifies the secret instead of contents. |
| ai200-s021 | O | ai200-s017 | extract,context | G/I/API: incoming extraction and context=parent_context preserve the upstream child relation and current scope. empty skips decoding; root supplies an empty context, which API documents as parentless. |
| ai200-s022 | K | ai200-s006 | countif,bin | CF/C/B/U/AR: conditional counting and five-minute rounding implement the bucket query. count includes successes; raw TimeGenerated groups exact timestamps rather than five-minute buckets. |
| ai200-s023 | V | ai200-s007 | yes,no,no | S set/update/list-version methods: set versions, property updates cannot replace contents, version properties omit values. For each row, its opposite yes/no answer contradicts that documented behavior. |
| ai200-s024 | O | ai200-s009 | yes,no | H and Cedar policy: allowlisted record satisfies the policy, export-then-hide violates pre-export exclusion. no rejects the permitted record; yes wrongly treats dashboard hiding as preventing export. |
| ai200-s025 | A | ai200-s025 | yes,no | P Key Vault secret refresh: expired secret interval plus refresh can update an unchanged unversioned reference; interval alone supplies no background activity. Opposite answers deny independent refresh or invent idle polling. |
| ai200-s026 | K | ai200-s006 | yes,no | CF/U/C/AR: countif works within role groups; a no-by aggregate does not preserve source records or OperationId. Opposite answers deny correct aggregation or confuse summarize with record projection. |
| ai200-s027 | A | ai200-s004 | {label,refresh} | L/P/D: correct label and refresh implement Lighthouse. dev selects wrong values; read alone is cached lookup. The boxes are authored geometry, not remote UI screenshots. |
| ai200-s028 | K | ai200-s006 | {filter,aggregate} | W/U/C/SO/AR: B retains failures, C counts them. source merely names AppRequests; sort merely orders computed rows. All snippets use real workspace KQL. |
| ai200-s029 | O | ai200-s017 | extract,parent | G/I/API: decode carrier and pass that context to the current-span manager. blank/fresh discard the incoming parent. Valid lowercase headers and configured SDK are explicit premises, avoiding default-getter/case and no-op-tracer ambiguity. |
| ai200-s030 | A | ai200-s030 | store,vault | P load authentication, Key Vault credentials and secret resolver sections: credential authenticates store and keyvault_credential resolves real vault references. store-wrong uses a filter rather than authentication; resolver supplies a credential where a resolving callback is required. Both service permissions are stipulated. |

## Equivalence and groups

10 secure families: s001, s004, s005, s006, s007, s009, s013, s017, s025,
s030 (all with ai200- prefix). Role series and matching share s001. Label and
ordinary-refresh decisions overlap in the multipart s019/s027 questions, so
s004/s010 and their variants are conservatively united under s004. Latest
retrieval and metadata/version decisions overlap in s007/s008/s023, united
under s007. Filtering and grouped-count/operator decisions overlap across
s006/s011/s018 and their widgets, united under s006. Log-policy widgets share
s009; propagation widgets share s017. Distinct SDK span scope, backing-service
dual-key handoff, secret refresh interval and reference authentication decisions
remain s005/s013/s025/s030. Merely sharing a concept does not imply equivalence.

The earlier 14-family author checkpoint was corrected in self-review before
commit; final availability is 10 secure / 69 total. This deliberately avoids
fresh-evidence inflation from partially overlapping judgments at the shared
single-concept evidence level. No claim of 30 independent observations is made.

series-s1 = s001–s003; case-s1 = s004/s019/s027; case-s2 =
s009/s024/s029, in those exact authored orders. All backgrounds are module-local.

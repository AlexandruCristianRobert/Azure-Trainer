# Final PostgreSQL review findings at 9e30c03

Reviewer: /root/final_pg_review. No Critical findings; four Important findings. One fix wave, followed by one scoped re-review.

1. Lab6 current tuned/filtered/answer proofs omit connection/image dependencies (postgres-vector-guided.lab.js:98). Allseven tasks remain complete after learner deploys port1234, while fresh retrieval fails500. Add relevant image/connect/DSN/PgBouncer dependencies; preserve historical exact proof and refresh solutions.
2. Backend selection uses raw psycopg/ConnectionPool text regex (python-sdk.js:63). A harmless comment mentioning psycopg breaks unchanged Cosmos lowering. Select trusted manifest backend; standalone fallback must inspect real imports, not comments/strings, preserving explicit Cosmos manifests.
3. runtime.js:327 rejects parameter dictionaries before shared binder. SQL %(id)s with {id:1} works in engine but recognized psycopg returns500 DATA_UNSUPPORTED. Preserve named keys, adapt values individually and require Jsonb for dictionary-valued SQL parameters.
4. data-actions.js:220 and postgres-independent.lab.js:102 require an application module pool even for enabled6432 PgBouncer. Actual direct psycopg SQL returns bouncer rows but load rejects400. Model actual direct-client demand and accept threshold-compliant Lab9 designs; retain strict actual-used-modulepool evidence for guided application-pool tasks and never infer usage from unused globals.

Reviewer probes were read-only/in-memory (~2s); no suites were repeated. Fresh controller verification before fixes:29/29 named Data tests and build passed. Accepted scope omissions: real Azure/network/auth/firewall behavior, complete SQL/Python semantics/import aliases/async startup/rollback, browser walkthroughs and excluded legacy suites.

## Scoped fix review at22982f2

All four original findings are addressed. Final named verification:32/32 tests, build and disposable probes passed. One new Important issue remains: data-actions.js:213-217 conflates distinct actively used module pools sharing max_size. Two actual min/max5 pools at six replicas/max50 are reported as one pool (served30000, failed0, peak30), instead of combined reservation60 (served23500, failed6500, peak47). Reviewer reproduced this in-memory in0.12s.

Track distinct used pool identities and reject unsupported combinations or account for their combined reservations, preserving unused-global and direct-PgBouncer behavior. Per final single-wave cap this residual is disclosed and parked for follow-up; branch is not merge-ready, not pushed/merged, scratch retained.

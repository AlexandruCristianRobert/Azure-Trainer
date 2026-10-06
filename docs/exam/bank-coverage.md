# Complete bank coverage and editorial gates

Snapshot: version 1, revision 1. Review date: 2026-10-06.
120 original items, 69 declared knowledge families, 27 objectives and 27 authored concepts.
These are pool availability counts, not measured learner knowledge or 120 independent observations.

## Editorial history

| Domain | Items / families | Independently approved final content HEAD | Final reviewer gate |
| --- | --- | --- | --- |
| containers | 27 / 26 | d4dfe6b | root/exam_bank_containers_review: all 27 approved; final correctness/source fixes closed |
| data | 33 / 20 | c5d24d6 | root/exam_bank_data_review: all 33 approved; final correctness/source fixes closed |
| connect | 30 / 13 | 947c2e2 | root/exam_bank_connect_review: all 30 approved; final correctness/source fixes closed |
| secure | 30 / 10 | 3d8afef | root/exam_bank_secure_review: all 30 and full-bank assembly approved; spec/quality Approved |

Prior domain ledgers preserve historical pending/fix notes. Their final gates above
are the accepted controller-provided verdicts; unchanged facts were not re-reviewed
by this implementer. All four final gates were independently approved on
2026-10-06: containers `d4dfe6b`, data `c5d24d6`, connect `947c2e2` and secure
`3d8afef`. Secure/full-bank review
closed the historical pending notes. Structural validation alone is not editorial
approval. The controller's durable progress ledger records each original seat's
final verdict; Task11 performs no second source-review fleet.

Exact final content commits: containers `d4dfe6b453ce8cef0253b528f3ad5369018b4629`,
data `c5d24d68242bf2e114a5c7f850e43e25c3e73d4b`,
connect `947c2e2b167f83575696652f9962987e2bca8d9b`,
secure/full bank `3d8afefa7c9543289ddacc766bd940a4d4e9cc01`.

## Allocations

| Domain | single | multiple | build | matching | dropdown | grid | hot | screen | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| containers | 6 | 4 | 4 | 4 | 3 | 2 | 2 | 2 | 27 |
| data | 6 | 6 | 5 | 4 | 5 | 3 | 2 | 2 | 33 |
| connect | 6 | 5 | 4 | 4 | 4 | 3 | 2 | 2 | 30 |
| secure | 6 | 5 | 3 | 4 | 4 | 4 | 2 | 2 | 30 |
| total | 24 | 20 | 16 | 16 | 16 | 12 | 8 | 8 | 120 |

## Objective availability

All canonical ref-${objectiveId} IDs resolve in the complete bank. Question and
component concepts agree with their primary objective. byObjective and byConcept
count distinct questions, not component points. Current one-concept-per-objective
mapping makes the counts equal; multipart components do not inflate these counts.

| Objective | Questions |
| --- | ---: |
| containers.registry-images | 3 |
| containers.registry-tasks | 5 |
| containers.appservice-container | 4 |
| containers.containerapps-revisions | 4 |
| containers.containerapps-keda | 3 |
| containers.aks-manifests | 5 |
| containers.container-diagnostics | 3 |
| data.cosmos-query | 2 |
| data.cosmos-cost | 3 |
| data.cosmos-vector | 2 |
| data.cosmos-change-feed | 3 |
| data.postgres-query | 3 |
| data.postgres-schema | 1 |
| data.postgres-index | 1 |
| data.postgres-capacity | 2 |
| data.postgres-rag | 6 |
| data.postgres-connections | 3 |
| data.redis-cache | 5 |
| data.redis-vector | 2 |
| connect.servicebus | 10 |
| connect.eventgrid | 6 |
| connect.functions-api | 7 |
| connect.functions-host | 7 |
| secure.vault | 10 |
| secure.appconfig | 7 |
| secure.otel | 6 |
| secure.kql | 7 |

## Sparse authored availability

No missing objective, concept or family representative IDs. Family total is 69:
26 containers + 20 data + 13 connect + 10 secure. A family is available question
content; no attempts or learner outcomes were used. The following concepts have
fewer than three available distinct families and are reported with reason
assessment-needed. This is distinct from computeReview.assessmentNeeded, which
concerns eligible learner evidence. It must not be labelled a measured weakness,
diagnosis, mastery level or an observed knowledge outcome.

| Concept | Available families |
| --- | ---: |
| containers.scale-signals | 2 |
| data.cosmos-history | 2 |
| data.cosmos-vector-search | 1 |
| data.cosmos-feed-processing | 1 |
| data.postgres-parameters | 2 |
| data.postgres-model | 1 |
| data.postgres-index-choice | 1 |
| data.postgres-sizing | 1 |
| data.postgres-pooling | 2 |
| data.redis-cache | 2 |
| data.redis-vector-search | 1 |
| secure.failure-query | 1 |

## Complete groups and draw feasibility

| Group | Kind | Authored members |
| --- | --- | --- |
| case-c1 | case | ai200-c019, ai200-c022, ai200-c026 |
| case-d1 | case | ai200-d004, ai200-d022, ai200-d030 |
| case-d2 | case | ai200-d009, ai200-d019, ai200-d032 |
| series-x1 | series | ai200-x001, ai200-x002, ai200-x003 |
| case-x1 | case | ai200-x009, ai200-x020, ai200-x029 |
| series-s1 | series | ai200-s001, ai200-s002, ai200-s003 |
| case-s1 | case | ai200-s004, ai200-s019, ai200-s027 |
| case-s2 | case | ai200-s009, ai200-s024, ai200-s029 |

Pure tests use seeds 0, 23 and 4294967295 with all sizes 40/50/60. Each preserves
exact quotas [9,11,10,10], [12,14,12,12], [14,16,15,15], all eight kinds, two
complete distinct cases and one complete series. No duplicate questions, partial
groups or silent quota relaxation. validateExamBank additionally checks each
preset at seed 23 using the existing constrained selector. These are bounded
pure draws, not browser/cloud/Lab/session replays.

Current Lab and Task links are checked against the actual read-only LABS catalog.
The existing taxonomy, concepts, Lab data and previous domain facts/keys/families
were not edited. The bank is bundled lazily through loadExamBank and contains no
runtime source fetch or remote generation.

// Data journey Lab 4 (Task 11): "Independent: Cosmos feedback feature" - the
// last Cosmos Lab. Mirrors aks-journey/ai-independent.lab.js's `labMode:
// 'independent'` pattern: the Lab's own `brief` states REQUIREMENTS, never
// prescribed steps or container names, and each Task's `check` grades the
// outcome (RU cost, search floor, tally correctness) rather than any one
// specific design. The Solution below is one valid design satisfying those
// requirements, not the only one - task-11-brief.md's own `feedback-design`
// Task is explicit about this: "a container `feedback` exists whose
// partition key is /questionId, OR any key for which scenario
// `question-feedback` touches one partition. The check uses the scenario
// evidence, not the key name" (see `feedbackProbeQuery` below, which asks
// the real query evaluator - not the container's own partitionKeyPath -
// whether a /questionId-scoped read stays single-partition).
//
// Seed (seedCosmosIndependent, cosmos-seeds.js): the full Lab 2 end state -
// vector search enabled, qa_history created, remember_answer/
// find_similar_questions already served correctly - but WITHOUT the
// feedback/tally/leases containers, and with worker.py's three functions
// (the "feedback edit zones": save_lease/process_changes/apply_feedback)
// reset to starters. remember_answer/find_similar_questions are NOT reset -
// they belong to qa_history, not feedback/tally/leases, so Lab 2's existing
// implementation already satisfies this Lab's own similarity-search
// requirement once a stricter score floor is applied (see `similarFloorReady`).
// app.py's own NEW edit zone, question_feedback (review ruling, finding 3),
// IS reset to a starter here (LAB4_APP_PY below) - it is this Lab's own
// concern (feedback-read), not Lab 2's.
//
// Task order below (feedback-design, feedback-read, similar-floor,
// tally-correct) matches task-11-brief.md's own listing, which is also a
// safe completion order: feedback-design's Solution does the one-time
// buildout (containers, worker.py, build, deploy) that feedback-read and
// tally-correct both reuse, the same way Lab 1/2's own guided Tasks build on
// each other within one Lab (not Lab 3's troubleshooting idiom, where
// unordered Tasks on shared incidents each had to redo their own
// build/deploy - this Lab's four Tasks cooperate on ONE feedback feature,
// they are not independent incidents).
import { COSMOS_MANIFEST, COSMOS_SOLUTION_FILES, COSMOS_STARTER_FILES } from '../../templates/data-python/cosmos.js'
import { runCosmosQuery } from '../../../lib/data/cosmos-query.js'
import { DATA_FIXTURES } from '../../fixtures/data/knowledge.js'
import {
  ASSISTANT_ACCOUNT, ASSISTANT_CLUSTER_ID, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_NAMESPACE, ASSISTANT_REGISTRY,
  commands, cosmosEvidence, cosmosRequestScenario, cosmosWorkerScenario, cosmosTask, deployedFunctionsCurrent, file,
  LEASES_CREATE_COMMAND, scenario,
} from './cosmos-helpers.js'
import { seedCosmosIndependent } from './cosmos-seeds.js'

// Worker.py's three "feedback edit zones" reset to starters (see the module
// comment); app.py keeps Lab 2's solved remember_answer/find_similar_questions,
// but its OWN new edit zone (question_feedback, review ruling - finding 3)
// starts as a starter too, since this Lab's own feedback-read Task is what
// requires the learner to implement it.
const questionFeedbackCut = COSMOS_STARTER_FILES['app.py'].indexOf('def question_feedback')
const solutionQuestionFeedbackCut = COSMOS_SOLUTION_FILES['app.py'].indexOf('def question_feedback')
const LAB4_APP_PY = COSMOS_SOLUTION_FILES['app.py'].slice(0, solutionQuestionFeedbackCut) + COSMOS_STARTER_FILES['app.py'].slice(questionFeedbackCut)
const initialFiles = { ...COSMOS_SOLUTION_FILES, 'app.py': LAB4_APP_PY, 'worker.py': COSMOS_STARTER_FILES['worker.py'] }

const IMAGE_V8 = `${ASSISTANT_REGISTRY}.azurecr.io/assistant:v8`
const WORKER_V8 = COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v8')

const cosmosAccount = (context) => (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === ASSISTANT_ACCOUNT && item.resourceGroup === ASSISTANT_GROUP)
const cosmosDatabase = (context) => cosmosAccount(context)?.databases?.find((item) => item.name === ASSISTANT_DATABASE)
const containerNamed = (context, name) => cosmosDatabase(context)?.containers?.find((item) => item.name === name)

// --- feedback-design / feedback-read: task-11-brief.md names one scenario
// (`question-feedback`) for both, but each Task owns its OWN scenario id
// here rather than sharing one - fix round 1 review: a Task with no
// `verification` of its own (reading a sibling Task's evidence instead) is
// never checked against THAT sibling's `dependencyMatches`, so it can stay
// 'done' after the sibling's own evidence has gone stale. Giving
// `feedback-read` its own verification+dependencies (narrow `fields`,
// matching what it actually depends on) fixes that with no engine change.
// `question-feedback` (feedback-design) is 'post'-only (a raw container
// write, no Python route), so requirement (a)'s single-partition check is
// computed by direct evaluation against the live `feedback` container.
// `feedback-read-check` (feedback-read) instead calls the learner's own
// `question_feedback` app route (review ruling, finding 3), since reading
// "all feedback for one question" is now something the app itself exposes.
const QID_PROBE = 'qid-feedback-probe'
const QID_OTHER = 'qid-feedback-other'
const PROBE_ITEMS = [
  { id: 'fb-probe-1', questionId: QID_PROBE, positive: true },
  { id: 'fb-probe-2', questionId: QID_PROBE, positive: false },
]
const OTHER_ITEM = { id: 'fb-probe-3', questionId: QID_OTHER, positive: true }

const feedbackProbeQuery = (context) => {
  const container = containerNamed(context, 'feedback')
  if (!container) return null
  const result = runCosmosQuery(container, 'SELECT * FROM c WHERE c.questionId = @q', [{ name: '@q', value: QID_PROBE }])
  return result.error ? null : result
}

// Review ruling (finding 3): must also require that feedback-worker is
// running a build of the learner's OWN current feedback-worker functions,
// not a stale earlier deploy.
const feedbackWorkerFunctionsCurrent = (context) => deployedFunctionsCurrent(context, ASSISTANT_CLUSTER_ID, ASSISTANT_NAMESPACE, 'feedback-worker', ['save_lease', 'process_changes', 'apply_feedback'])

const feedbackDesignReady = (context) => {
  if (!feedbackWorkerFunctionsCurrent(context)) return false
  const record = cosmosEvidence(context, 'feedback-design', 'question-feedback')
  if (!record || record.measurements.status !== 200) return false
  const result = feedbackProbeQuery(context)
  return !!result && result.stats.partitionsTouched === 1 && result.rows.length === PROBE_ITEMS.length
}

// Review ruling (finding 3): reading all of one question's feedback is now
// an app route - question_feedback(question_id), an edit zone on app.py
// (assistant-api), implemented with feedback.query_items(..., partition_key
// =question_id) or an equivalent query - rather than a raw container probe.
// The check reads the RU the learner's OWN call actually recorded and
// requires every one of that question's feedback items came back; it adds
// no point-read-shaped design requirement of its own.
const feedbackReadReady = (context) => {
  if (!deployedFunctionsCurrent(context, ASSISTANT_CLUSTER_ID, ASSISTANT_NAMESPACE, 'assistant-api', ['question_feedback'])) return false
  const record = cosmosEvidence(context, 'feedback-read', 'feedback-read-check')
  if (!record || record.measurements.status !== 200) return false
  if (typeof record.measurements.totalCharge !== 'number' || record.measurements.totalCharge > 3) return false
  const rows = record.measurements.value
  if (!Array.isArray(rows)) return false
  const container = containerNamed(context, 'feedback')
  const expectedIds = (container?.items ?? []).filter((item) => item.questionId === QID_PROBE).map((item) => item.id)
  const returnedIds = new Set(rows.map((row) => row.id))
  return expectedIds.length > 0 && rows.length === expectedIds.length && expectedIds.every((id) => returnedIds.has(id))
}

// --- similar-floor: reuses Lab 2's own remember_answer/find_similar_questions
// (already served correctly by the seed - see the module comment) with a
// stricter application floor (0.9, vs. Lab 2's own 0.95/0.9 pair) than any
// Lab 2 Task required. Review ruling (finding 3): the floor and the product
// restriction must come from the learner's OWN query, not a post-check
// filter - cosmos-query.js's WHERE grammar now supports VectorDistance(...)
// as a condition, so the Solution's query filters with
// `WHERE c.product = @product AND VectorDistance(c.embedding, @embedding)
// >= 0.9`. The scenario seeds every qaHistory fixture (both products) and
// asks for k=5, so a design missing either the floor or the product filter
// has room to leak a near-miss or another-product row; the check reads the
// returned rows exactly as the app sent them, with no post-filtering.
const CANONICAL = DATA_FIXTURES.qaHistory.find((entry) => entry.id === 'qa-1')
const NEAR_MISS_VECTOR = DATA_FIXTURES.nearMisses['How do I permanently delete a Contoso Backup snapshot before its retention period ends?'].vector
const PARAPHRASE_VECTOR = DATA_FIXTURES.paraphrases['How long does Contoso Backup keep my snapshots?'].vector
const OTHER_PRODUCT_IDS = new Set(DATA_FIXTURES.qaHistory.filter((entry) => entry.product !== CANONICAL.product).map((entry) => entry.id))

const similarFloorReady = (context) => {
  if (!deployedFunctionsCurrent(context, ASSISTANT_CLUSTER_ID, ASSISTANT_NAMESPACE, 'assistant-api', ['remember_answer', 'find_similar_questions'])) return false
  const record = cosmosEvidence(context, 'similar-floor', 'similar-floor')
  if (!record || record.measurements.status !== 200) return false
  const arrays = (record.measurements.values ?? []).filter((value) => Array.isArray(value))
  const [nearMissRows, paraphraseRows] = arrays
  const hasOtherProduct = (rows) => (rows ?? []).some((row) => OTHER_PRODUCT_IDS.has(row.id))
  if (hasOtherProduct(nearMissRows) || hasOtherProduct(paraphraseRows)) return false
  if ((nearMissRows ?? []).length !== 0) return false
  return (paraphraseRows ?? []).length === 1 && paraphraseRows[0].id === CANONICAL.id
}

// --- tally-correct: reuses Lab 2's own save_lease/process_changes/
// apply_feedback design (one tally row per original feedback id, upserted
// idempotently) - task-11-brief.md's own query (`SELECT VALUE COUNT(1) FROM c
// WHERE c.questionId = @q AND c.positive = true`) only makes sense against
// that one-row-per-submission shape, not a pre-aggregated counter. No app
// route exposes this count, so - like feedback-read above - it is read by
// direct evaluation against the live `tally` container (the query evaluator
// already supports `VALUE COUNT(1)`, cosmos-query.js).
//
// The scenario alone (post 3, batch, restart, post 2 more, batch, redeliver)
// is not enough to PROVE checkpoint resumption: because apply_feedback
// upserts by id, a worker that ignores its saved lease and simply re-reads
// the WHOLE feed on every batch call still lands on the same final count of
// 4 (fix round 1 review) - the final COUNT alone can't tell a correctly-
// resumed worker from one that never checkpoints at all. `process_changes`
// already returns `len(changes)` (the number of items THAT call itself
// processed), surfaced per step in `measurements.values` (data-actions.js),
// so `tallyCorrectReady` also asserts the SECOND batch's own reported count
// - the one right after `restart` - is exactly 2: only the two items posted
// since the saved checkpoint, never the whole feed again. (The FIRST ever
// batch call can't distinguish a resuming worker from a non-resuming one -
// there is no earlier checkpoint for either to honor or ignore, and by the
// time this Task's own scenario runs, `feedback`'s change feed may already
// carry earlier Tasks' own unprocessed probe items too - so only the second
// batch's count is asserted.) A worker that re-reads from the beginning on
// every call would report far more than 2 there instead, and genuinely fail
// this Task.
const QID_TALLY = 'qid-tally-1'
const TALLY_ITEMS = [
  { id: 'fb-t-1', questionId: QID_TALLY, positive: true },
  { id: 'fb-t-2', questionId: QID_TALLY, positive: true },
  { id: 'fb-t-3', questionId: QID_TALLY, positive: false },
  { id: 'fb-t-4', questionId: QID_TALLY, positive: true },
  { id: 'fb-t-5', questionId: QID_TALLY, positive: true },
]

const tallyCorrectReady = (context) => {
  if (!feedbackWorkerFunctionsCurrent(context)) return false
  const record = cosmosEvidence(context, 'tally-correct', 'tally-duplicate')
  if (!record || record.measurements.status !== 200) return false
  const batchCounts = (record.measurements.values ?? []).filter((value) => typeof value === 'number')
  if (batchCounts.length !== 2 || batchCounts[1] !== 2) return false
  const tally = containerNamed(context, 'tally')
  if (!tally) return false
  const result = runCosmosQuery(tally, 'SELECT VALUE COUNT(1) FROM c WHERE c.questionId = @q AND c.positive = true', [{ name: '@q', value: QID_TALLY }])
  return !result.error && result.rows[0] === 4
}

export const cosmosIndependentLab = {
  id: 'data-cosmos-independent', title: 'Independent: Cosmos feedback feature',
  brief: 'Design the Knowledge Assistant\'s feedback store yourself. Reading all feedback stored for one question must cost at most 3 RU at this Lab\'s declared scale (4 physical partitions, a logical scale of 2). Similar-question search must stay restricted to one product and ignore any match scoring below 0.9. A feedback worker must keep a per-question count of positive feedback that stays correct across a worker restart and a duplicated delivery.',
  minutes: 50, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 4, labMode: 'independent',
  skillAreaId: 'data', service: 'cosmos-db', status: 'available',
  manifestId: COSMOS_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  dataTarget: { resourceGroup: ASSISTANT_GROUP, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE },
  // task-11-brief.md's own declared scale for requirement (a). Review ruling
  // (finding 3): feedback-read now reads through question_feedback(question_id)
  // - an app route with no known item ids to point-read by - so the only
  // design that can satisfy it is a query scoped to a single partition via
  // partition_key; a cross-partition query still costs far more than 3 RU
  // regardless of logicalScale (queryCharge's fixed fan-out penalty alone),
  // which is the scale this Lab now declares.
  dataScale: { physicalPartitions: 4, logicalScale: 2 },
  initialProjectFiles: initialFiles, solutionFiles: COSMOS_SOLUTION_FILES, initializeSimulation: seedCosmosIndependent,
  stages: [
    { id: 'feedback', title: 'Design and verify the feedback store', taskIds: ['feedback-design', 'feedback-read'] },
    { id: 'search', title: 'Verify the similarity floor', taskIds: ['similar-floor'] },
    { id: 'worker', title: 'Verify exactly-once tallying', taskIds: ['tally-correct'] },
  ],
  scenarios: {
    'question-feedback': cosmosWorkerScenario([
      { action: 'post', route: 'feedback', args: PROBE_ITEMS[0] },
      { action: 'post', route: 'feedback', args: PROBE_ITEMS[1] },
      { action: 'post', route: 'feedback', args: OTHER_ITEM },
    ]),
    // Calls the learner's OWN question_feedback route through assistant-api
    // (review ruling, finding 3) - a 'data-request', so it cannot also post
    // the probe items itself (a raw container write is a 'data-worker'
    // action; see cosmos-helpers.js's two scenario builders). 'feedback-read'
    // Task's own Solution below re-runs 'question-feedback' first (idempotent
    // - upsert by id) so this scenario's own replay never depends on
    // 'feedback-design' having already run. The Task's own evidence is this
    // scenario's `data-request`, with its own `verification` separate from
    // 'feedback-design''s `data-worker` one (see the module comment above
    // `feedback-design`).
    'feedback-read-check': cosmosRequestScenario([
      { route: 'GET /questions/{id}/feedback', args: [QID_PROBE] },
    ]),
    // Seeds every qaHistory fixture (both products), not just the canonical
    // row, so a design missing the floor or the product filter has rows to
    // leak - see the module comment above `similarFloorReady`.
    'similar-floor': cosmosRequestScenario([
      ...DATA_FIXTURES.qaHistory.map((entry) => ({ route: 'POST /answers', args: [{ ...entry }] })),
      { route: 'GET /similar', args: [CANONICAL.product, [...NEAR_MISS_VECTOR], 5] },
      { route: 'GET /similar', args: [CANONICAL.product, [...PARAPHRASE_VECTOR], 5] },
    ]),
    'tally-duplicate': cosmosWorkerScenario([
      { action: 'post', route: 'feedback', args: TALLY_ITEMS[0] },
      { action: 'post', route: 'feedback', args: TALLY_ITEMS[1] },
      { action: 'post', route: 'feedback', args: TALLY_ITEMS[2] },
      { action: 'batch' },
      { action: 'restart' },
      { action: 'post', route: 'feedback', args: TALLY_ITEMS[3] },
      { action: 'post', route: 'feedback', args: TALLY_ITEMS[4] },
      { action: 'batch' },
      { action: 'redeliver' },
    ]),
  },
  tasks: [
    cosmosTask({
      id: 'feedback-design', stageId: 'feedback',
      text: 'Design a feedback store: create a feedback container (and whatever else your design needs), implement the feedback worker\'s functions, deploy it, and confirm that reading all feedback for one question touches only one physical partition.',
      explanation: 'Every other requirement in this Lab is cheap or correct only if the feedback store itself is partitioned so that one question\'s feedback lives together - the question-feedback scenario probes exactly that before any cost or correctness question is asked.',
      hints: ['Partition the feedback container on the same property every per-question read will filter on.', 'Build and deploy the feedback worker before running the question-feedback scenario - it is routed to feedback-worker, not assistant-api.'],
      examNote: 'A good partition key is chosen from the application\'s own read/write patterns, not assigned after the fact.',
      check: feedbackDesignReady,
      solution: {
        steps: [
          ...commands(
            `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name feedback --partition-key-path /questionId --throughput 400`,
            `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name tally --partition-key-path /questionId --throughput 400`,
            LEASES_CREATE_COMMAND,
          ),
          file('worker.py'),
          ...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v8 .`),
          { kind: 'file', path: 'k8s/worker.yaml', content: WORKER_V8 },
          ...commands('kubectl apply -f k8s/worker.yaml'),
          scenario('question-feedback'),
        ],
      },
      verification: { scenarioId: 'question-feedback', scenarioVersion: 1 },
      fields: ['code:feedback-worker:save_lease', 'code:feedback-worker:process_changes', 'code:feedback-worker:apply_feedback'],
    }),
    cosmosTask({
      id: 'feedback-read', stageId: 'feedback',
      text: 'Confirm that reading all feedback stored for one question costs at most 3 RU at this Lab\'s declared scale.',
      explanation: 'A query scoped to a single partition via partition_key stays cheap; a query that cannot target one partition forces Cosmos to fan out across every physical partition, which costs far more regardless of how few rows actually match.',
      hints: ['Implement question_feedback(question_id) in app.py with feedback.query_items(..., partition_key=question_id) or an equivalent query, build and redeploy assistant-api, then run the feedback-read-check scenario.', 'A query scoped to a single partition via partition_key stays cheap; without it, Cosmos must fan out across every physical partition.'],
      examNote: 'A query scoped to a single partition via partition_key avoids the fan-out cost of a cross-partition scan.',
      check: feedbackReadReady,
      // Re-seeds the probe items (idempotent) so this Task's own Solution
      // stands alone, then implements+deploys question_feedback before
      // calling it - the seed-deployed assistant-api Pod still has this
      // Lab's own starter for it (review ruling, finding 3).
      solution: { steps: [scenario('question-feedback'), file('app.py'), ...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v2 .`, 'kubectl rollout restart deployment/assistant-api -n assistant'), scenario('feedback-read-check')] },
      verification: { scenarioId: 'feedback-read-check', scenarioVersion: 1 },
      fields: ['code:assistant-api:question_feedback'],
    }),
    cosmosTask({
      id: 'similar-floor', stageId: 'search',
      text: 'Confirm similar-question search stays restricted to one product and ignores any match scoring below 0.9: a near-miss question must clear no row above that floor, while a paraphrase must clear the canonical question above it.',
      explanation: 'Cosmos ranks by distance faithfully, but nearest is not the same as relevant - an application floor is what keeps a merely-related question from being presented as if it answered the one actually asked.',
      hints: ['Run the similar-floor scenario and look at the score each row carries.', 'A floor is judged on the returned score, not on which row Cosmos happened to rank first.'],
      examNote: 'Similarity search needs an application-level score floor; Cosmos never applies one for you.',
      check: similarFloorReady,
      solution: { steps: [scenario('similar-floor')] },
      verification: { scenarioId: 'similar-floor', scenarioVersion: 1 },
      fields: ['code:assistant-api:remember_answer', 'code:assistant-api:find_similar_questions', 'indexing:qa_history'],
    }),
    cosmosTask({
      id: 'tally-correct', stageId: 'worker',
      text: 'Confirm the feedback worker keeps a correct per-question count of positive feedback across a restart and a duplicated delivery: the batch right after a restart must process only the items posted since the saved checkpoint, and 4 positive submissions for one question must still count as 4 after a redelivered batch.',
      explanation: 'A restarted worker resumes from its saved checkpoint rather than re-reading the whole feed from the beginning - the batch right after restart reports how many items it actually processed, which only matches "just the new ones" if the checkpoint was honored - and an idempotent, upsert-by-id tally keeps a redelivered batch from inflating the count.',
      hints: ['Run the tally-duplicate scenario and compare each batch\'s reported processed count against how many items were posted since the last checkpoint, not since the start.', 'Keying each tally row by its own feedback item\'s id - never by questionId - is what makes a redelivered batch safe.'],
      examNote: 'Delivery is at-least-once: checkpoint after handling, and make the handler idempotent.',
      check: tallyCorrectReady,
      solution: { steps: [scenario('tally-duplicate')] },
      verification: { scenarioId: 'tally-duplicate', scenarioVersion: 1 },
      fields: ['code:feedback-worker:save_lease', 'code:feedback-worker:process_changes', 'code:feedback-worker:apply_feedback'],
    }),
  ],
}

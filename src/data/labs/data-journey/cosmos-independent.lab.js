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
import { pointReadCharge } from '../../../lib/data/cosmos-cost.js'
import { runCosmosQuery } from '../../../lib/data/cosmos-query.js'
import { DATA_FIXTURES } from '../../fixtures/data/knowledge.js'
import {
  ASSISTANT_ACCOUNT, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_REGISTRY,
  commands, cosmosEvidence, cosmosRequestScenario, cosmosWorkerScenario, cosmosTask, file,
  LEASES_CREATE_COMMAND, scenario,
} from './cosmos-helpers.js'
import { seedCosmosIndependent } from './cosmos-seeds.js'

// Only worker.py's three "feedback edit zones" reset to starters (see the
// module comment); app.py keeps Lab 2's solved remember_answer/
// find_similar_questions.
const initialFiles = { ...COSMOS_SOLUTION_FILES, 'worker.py': COSMOS_STARTER_FILES['worker.py'] }

const IMAGE_V8 = `${ASSISTANT_REGISTRY}.azurecr.io/assistant:v8`
const WORKER_V8 = COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v8')

const cosmosAccount = (context) => (context.sandbox.cosmosAccounts ?? []).find((item) => item.name === ASSISTANT_ACCOUNT && item.resourceGroup === ASSISTANT_GROUP)
const cosmosDatabase = (context) => cosmosAccount(context)?.databases?.find((item) => item.name === ASSISTANT_DATABASE)
const containerNamed = (context, name) => cosmosDatabase(context)?.containers?.find((item) => item.name === name)

// --- feedback-design / feedback-read: task-11-brief.md names one scenario
// (`question-feedback`) for both, but each Task owns its OWN scenario id
// here (`question-feedback` / `feedback-read-check`, same requests) rather
// than sharing one - fix round 1 review: a Task with no `verification` of
// its own (reading a sibling Task's evidence instead) is never checked
// against THAT sibling's `dependencyMatches`, so it can stay 'done' after
// the sibling's own evidence has gone stale. Giving `feedback-read` its own
// verification+dependencies (narrow `fields`, matching what it actually
// depends on) fixes that with no engine change. Both scenarios are
// 'post'-only (raw container writes, no Python route), so requirement (a)'s
// RU cost is computed by direct evaluation against the live `feedback`
// container, the same way requirement (c)'s tally count is (see
// `tallyCorrectReady`) - there is no app route that reads `feedback` by
// questionId to dispatch through.
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

const feedbackDesignReady = (context) => {
  const record = cosmosEvidence(context, 'feedback-design', 'question-feedback')
  if (!record || record.measurements.status !== 200) return false
  const result = feedbackProbeQuery(context)
  return !!result && result.stats.partitionsTouched === 1 && result.rows.length === PROBE_ITEMS.length
}

// Models "reading all feedback for one question" as what it would cost to
// retrieve each already-known item by id and partition key (a point read
// per item) rather than a `query_items` scan - at this Lab's declared scale
// (logicalScale 50), ANY single-partition `query_items` scan costs well over
// 3 RU even for one matched row (queryCharge's `0.1 * scanned * logicalScale`
// term alone), so the cheap, correct design is a point-read-shaped access
// path, not a query - exactly the lesson a dense, production-scale container
// teaches over this Lab's earlier, cheap-by-default containers.
const feedbackReadReady = (context) => {
  const record = cosmosEvidence(context, 'feedback-read', 'feedback-read-check')
  if (!record || record.measurements.status !== 200) return false
  const result = feedbackProbeQuery(context)
  if (!result || result.stats.partitionsTouched !== 1 || result.rows.length !== PROBE_ITEMS.length) return false
  const consistency = cosmosAccount(context)?.defaultConsistencyLevel
  const charge = result.rows.reduce((sum, row) => sum + pointReadCharge(row, consistency), 0)
  return charge <= 3
}

// --- similar-floor: reuses Lab 2's own remember_answer/find_similar_questions
// (already served correctly by the seed - see the module comment) with a
// stricter application floor (0.9, vs. Lab 2's own 0.95/0.9 pair) than any
// Lab 2 Task required. The query itself cannot filter on a computed
// VectorDistance score (cosmos-query.js's WHERE grammar only compares stored
// paths), so the floor is an application-level judgment, read from the
// scenario's own returned rows - exactly how Lab 2's 'similar' Task already
// judges its own near-miss/paraphrase scores.
const FLOOR = 0.9
const CANONICAL = DATA_FIXTURES.qaHistory.find((entry) => entry.id === 'qa-1')
const NEAR_MISS_VECTOR = DATA_FIXTURES.nearMisses['How do I permanently delete a Contoso Backup snapshot before its retention period ends?'].vector
const PARAPHRASE_VECTOR = DATA_FIXTURES.paraphrases['How long does Contoso Backup keep my snapshots?'].vector

const aboveFloor = (rows) => (rows ?? []).filter((row) => typeof row.score === 'number' && row.score >= FLOOR)

const similarFloorReady = (context) => {
  const record = cosmosEvidence(context, 'similar-floor', 'similar-floor')
  if (!record || record.measurements.status !== 200) return false
  const arrays = (record.measurements.values ?? []).filter((value) => Array.isArray(value))
  const [nearMissRows, paraphraseRows] = arrays
  const nearMissAbove = aboveFloor(nearMissRows)
  const paraphraseAbove = aboveFloor(paraphraseRows)
  return nearMissAbove.length === 0 && paraphraseAbove.length === 1 && paraphraseAbove[0].id === CANONICAL.id
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
  brief: 'Design the Knowledge Assistant\'s feedback store yourself. Reading all feedback stored for one question must cost at most 3 RU at this Lab\'s declared scale (4 physical partitions, a logical scale of 50). Similar-question search must stay restricted to one product and ignore any match scoring below 0.9. A feedback worker must keep a per-question count of positive feedback that stays correct across a worker restart and a duplicated delivery.',
  minutes: 50, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 4, labMode: 'independent',
  skillAreaId: 'data', service: 'cosmos-db', status: 'available',
  manifestId: COSMOS_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  dataTarget: { resourceGroup: ASSISTANT_GROUP, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE },
  // task-11-brief.md's own declared scale for requirement (a): dense enough
  // that a `query_items` scan of even one matched row costs well over 3 RU
  // (cosmos-cost.js's queryCharge), so only a point-read-shaped access path
  // can satisfy feedback-read.
  dataScale: { physicalPartitions: 4, logicalScale: 50 },
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
    // Same requests as `question-feedback`, under its own scenario id so
    // `feedback-read` can own its own verification dispatch (see the module
    // comment above `feedback-design`).
    'feedback-read-check': cosmosWorkerScenario([
      { action: 'post', route: 'feedback', args: PROBE_ITEMS[0] },
      { action: 'post', route: 'feedback', args: PROBE_ITEMS[1] },
      { action: 'post', route: 'feedback', args: OTHER_ITEM },
    ]),
    'similar-floor': cosmosRequestScenario([
      { route: 'POST /answers', args: [{ ...CANONICAL }] },
      { route: 'GET /similar', args: [CANONICAL.product, [...NEAR_MISS_VECTOR], 1] },
      { route: 'GET /similar', args: [CANONICAL.product, [...PARAPHRASE_VECTOR], 1] },
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
      fields: ['images:feedback-worker'],
    }),
    cosmosTask({
      id: 'feedback-read', stageId: 'feedback',
      text: 'Confirm that reading all feedback stored for one question costs at most 3 RU at this Lab\'s declared scale.',
      explanation: 'At a logical scale of 50, even a single-partition query that scans the matched rows costs well over 3 RU - retrieving each already-known item by id and partition key instead keeps the read cheap regardless of how dense the partition really is.',
      hints: ['Re-run the question-feedback scenario and look at how few, how small the items for one question are.', 'A point read\'s cost depends on item size, never on logical scale; a query\'s cost does.'],
      examNote: 'Point reads are the cheapest, most scale-independent operation in Cosmos DB; prefer them for hot, narrow reads.',
      check: feedbackReadReady,
      solution: { steps: [scenario('feedback-read-check')] },
      verification: { scenarioId: 'feedback-read-check', scenarioVersion: 1 },
      fields: ['images:feedback-worker'],
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
      fields: ['images:assistant-api', 'indexing:qa_history'],
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
      fields: ['images:feedback-worker'],
    }),
  ],
}

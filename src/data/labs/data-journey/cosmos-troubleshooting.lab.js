// Data journey Lab 3 (Task 10): "Troubleshooting: Conversation History
// incidents". Mirrors the structure of Labs 1/2 (cosmosTask(...), Tasks
// grouped into display Stages, Solutions as `{ steps }` the behavioral
// replay helper and the real UI both drive through `applyRunAction`) but
// follows aks-journey/ai-troubleshooting.lab.js's labMode: 'troubleshooting'
// pattern instead - the Lab's own `brief` states symptoms (a cost alert, a
// sort failure, a write-cost regression, a stale-read report, missing
// feedback), never causes, and each Task is a diagnosis-free outcome check
// (no code-shape assertion like Labs 1/2's codeCrudReady) against live
// evidence from a scenario run.
//
// The seed (seedCosmosTroubleshooting, cosmos-seeds.js) bakes four incidents
// into the full Lab 2 end state: (1) app.py's get_session uses a
// cross-partition query_items instead of a point read; (2) sessions loses
// its composite index and qa_history's embedding is no longer excluded from
// ordinary indexing; (3) clients.py requests Eventual consistency instead of
// Session; (4) worker.py's process_changes reads from "Now" and never saves
// its lease. `initialProjectFiles` below is exactly that faulty source -
// see the seed's own comment for why the seed can never change it.
//
// CONTEXT.md: a Solution is the complete worked answer to a Task, and the
// Lab is order-free, so every Task below has its OWN complete, standalone
// Solution - its own file edit (when it has a code incident), its own
// `az acr build` at its own distinct tag, its own k8s yaml edit and
// `kubectl apply`, then its own scenario run - never relying on an earlier
// Task's Solution having already run (Task 10 review fix round 1: an
// earlier draft had `fresh-read` only re-run its scenario, relying on
// `session-budget` to have already fixed app.py/clients.py and rebuilt).
// `session-budget` and `fresh-read` both rebuild/redeploy assistant-api
// (incidents 1 and 3 are both baked into that one image) - safe because
// each Task's dependency fields (below) snapshot only its OWN function's
// (or the deployed client's own) build-captured behavior, via
// cosmos-helpers.js's `code:<deployment>:<function>` /
// `deployedConsistency:<deployment>` fields - never the whole image's
// hash - so rebuilding assistant-api again for one incident never stales
// another incident's already-passing evidence, regardless of which Task
// runs first or how many times the shared Deployment gets rebuilt.
import { COSMOS_MANIFEST, COSMOS_SOLUTION_FILES } from '../../templates/data-python/cosmos.js'
import { writeCharge } from '../../../lib/data/cosmos-cost.js'
import { DATA_FIXTURES } from '../../fixtures/data/knowledge.js'
import {
  ASSISTANT_ACCOUNT, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_REGISTRY,
  commands, cosmosEvidence, cosmosRequestScenario, cosmosWorkerScenario, cosmosTask, file, scenario,
} from './cosmos-helpers.js'
import { FAULTY_QA_IDX_JSON, seedCosmosTroubleshooting } from './cosmos-seeds.js'

// --- Faulty starting source (incidents 1/3/4): the full Lab 1/2 solution,
// with only get_session (app.py), the client's consistency level
// (clients.py) and process_changes (worker.py) replaced. Every other
// function - save_message, recent_sessions_for_user, remember_answer,
// find_similar_questions, save_lease, apply_feedback - starts correct.
const SOLUTION_GET_SESSION = `def get_session(message_id, session_id):
    # GET /sessions/{id}: point read one stored message by id and session id.
    return sessions.read_item(item=message_id, partition_key=session_id)`
const FAULTY_GET_SESSION = `def get_session(message_id, session_id):
    # GET /sessions/{id}: point read one stored message by id and session id.
    return sessions.query_items(
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": message_id}],
        enable_cross_partition_query=True,
    )`
const TROUBLESHOOTING_APP_PY = COSMOS_SOLUTION_FILES['app.py'].replace(SOLUTION_GET_SESSION, FAULTY_GET_SESSION)
if (TROUBLESHOOTING_APP_PY === COSMOS_SOLUTION_FILES['app.py']) throw new Error('cosmos-troubleshooting.lab.js: get_session fault text did not match the solution app.py.')

const TROUBLESHOOTING_CLIENTS_PY = COSMOS_SOLUTION_FILES['clients.py'].replace('consistency_level="Session"', 'consistency_level="Eventual"')
if (TROUBLESHOOTING_CLIENTS_PY === COSMOS_SOLUTION_FILES['clients.py']) throw new Error('cosmos-troubleshooting.lab.js: consistency fault text did not match the solution clients.py.')

const SOLUTION_PROCESS_CHANGES = `def process_changes():
    lease = read_lease()
    continuation = None
    start_time = "Beginning"
    if lease is not None:
        continuation = lease.get("continuation")
        start_time = None
    # The change feed result is an iterator against the real SDK, so collect
    # it before counting - len() on the iterator itself would fail.
    changes = list(feedback.query_items_change_feed(start_time=start_time, continuation=continuation))
    for change in changes:
        apply_feedback(change)
    new_continuation = feedback.client_connection.last_response_headers["etag"]
    save_lease(new_continuation)
    return len(changes)`
const FAULTY_PROCESS_CHANGES = `def process_changes():
    changes = feedback.query_items_change_feed(start_time="Now")
    for change in changes:
        apply_feedback(change)
    return len(changes)`
const TROUBLESHOOTING_WORKER_PY = COSMOS_SOLUTION_FILES['worker.py'].replace(SOLUTION_PROCESS_CHANGES, FAULTY_PROCESS_CHANGES)
if (TROUBLESHOOTING_WORKER_PY === COSMOS_SOLUTION_FILES['worker.py']) throw new Error('cosmos-troubleshooting.lab.js: process_changes fault text did not match the solution worker.py.')

const initialFiles = { ...COSMOS_SOLUTION_FILES, 'app.py': TROUBLESHOOTING_APP_PY, 'clients.py': TROUBLESHOOTING_CLIENTS_PY, 'worker.py': TROUBLESHOOTING_WORKER_PY }

// --- Fix targets (indexing fixes take effect immediately - no rebuild/
// redeploy needed). Every code-fixing Task below rebuilds/redeploys at its
// own distinct tag, even though `session-budget` and `fresh-read` share the
// assistant-api Deployment - see the module comment for why that no longer
// stales either Task's evidence.
const DEPLOYMENT_V5 = COSMOS_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:v5')
const DEPLOYMENT_V6 = COSMOS_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:v6')
const WORKER_V7 = COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v7')

const FIXED_SESSIONS_IDX_JSON = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"},{"path":"/text/?"}],"compositeIndexes":[[{"path":"/userId","order":"ascending"},{"path":"/createdAt","order":"descending"}]]}'
// task-10-brief.md: recreating qa_history with the exclusion is the "main"
// fix (a vector container's embedding policy is fixed at creation, so a
// learner may reasonably reach for recreation first), but an ordinary
// indexing policy *can* be updated online - `container update --idx` with
// the same exclusion is equally accepted; this Lab's own Solution replay
// uses the update route since it never needs to touch qa_history's already-
// seeded items.
const FIXED_QA_IDX_JSON = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"},{"path":"/embedding/*"}],"vectorIndexes":[{"path":"/embedding","type":"quantizedFlat"}]}'

// --- Scenario fixtures (fresh ids - distinct from Lab 2's own seeded
// `sessions`/`qa_history` fixtures, so none of these writes collide with
// seeded history).
const SEED_ORDERED = { id: 'ts-msg-ordered', sessionId: 'ts-session-ordered', userId: 'ts-user-2', role: 'user', text: 'List my recent sessions.', createdAt: '2026-02-01T09:05:00Z' }
const SEED_FRESH = { id: 'ts-msg-fresh', sessionId: 'ts-session-fresh', userId: 'ts-user-3', role: 'user', text: 'Confirm read after write.', createdAt: '2026-02-01T09:10:00Z' }
const REMEMBER_ITEM = DATA_FIXTURES.qaHistory.find((entry) => entry.id === 'qa-3')

const FEEDBACK_ITEMS = [
  { id: 'ts-fb-1', questionId: 'ts-qa-1', positive: true },
  { id: 'ts-fb-2', questionId: 'ts-qa-2', positive: false },
  { id: 'ts-fb-3', questionId: 'ts-qa-1', positive: true },
  { id: 'ts-fb-4', questionId: 'ts-qa-3', positive: true },
  { id: 'ts-fb-5', questionId: 'ts-qa-2', positive: false },
]

// task-10-brief.md: the write-cost baseline is the write charge the seeded
// (faulty) qa_history policy already gives the scenario's own item, computed
// directly with writeCharge() rather than read back from a prior run's
// evidence.
export const BASELINE_WRITE_CHARGE = writeCharge(REMEMBER_ITEM, JSON.parse(FAULTY_QA_IDX_JSON))

// --- Diagnosis-free outcome checks: each reads only the evidence a scenario
// run actually produced (RU charge, status, staleness, applied counts) -
// never the source code - so fixing the wrong file simply fails to produce
// passing evidence instead of being caught by inspection.
const sessionBudgetReady = (context) => {
  const record = cosmosEvidence(context, 'session-budget', 'get-session')
  if (!record || record.measurements.status !== 200) return false
  const readCall = record.measurements.calls?.find((call) => call.call === 'cosmos.container.read_item')
  return !!readCall && readCall.charge <= 2
}

const orderedRestoredReady = (context) => {
  const record = cosmosEvidence(context, 'ordered-restored', 'user-sessions-ordered')
  return !!record && record.measurements.status === 200
}

const writeCostReady = (context) => {
  const record = cosmosEvidence(context, 'write-cost', 'remember-answer')
  if (!record || record.measurements.status !== 200) return false
  const writeCall = record.measurements.calls?.find((call) => call.call === 'cosmos.container.upsert_item' && call.receiver === 'qa_history')
  return !!writeCall && writeCall.charge <= BASELINE_WRITE_CHARGE * 0.6
}

// Requires an actual point read made at Session consistency (not just an
// absent stale flag): query_items (incident 1's buggy get_session) never
// reports staleness at all, and a weaker-than-Session read of a just-created
// item now 404s rather than silently succeeding stale (runtime.js's
// execReadItem), so without the consistency assertion, a 404 would look
// indistinguishable from "not run yet" while the client is still Eventual.
const freshReadReady = (context) => {
  const record = cosmosEvidence(context, 'fresh-read', 'write-then-read')
  if (!record || record.measurements.status !== 200) return false
  const readCall = record.measurements.calls?.find((call) => call.call === 'cosmos.container.read_item')
  return !!readCall && readCall.consistency === 'Session' && record.measurements.stale === false
}

const feedCompleteReady = (context) => {
  const record = cosmosEvidence(context, 'feed-complete', 'feed-restart')
  if (!record || record.measurements.status !== 200 || record.measurements.value !== 2) return false
  const tally = context.sandbox.cosmosAccounts?.find((item) => item.name === ASSISTANT_ACCOUNT)
    ?.databases?.find((item) => item.name === ASSISTANT_DATABASE)
    ?.containers?.find((item) => item.name === 'tally')
  const ids = new Set((tally?.items ?? []).map((item) => item.id))
  return (tally?.items ?? []).length === 5 && FEEDBACK_ITEMS.every((item) => ids.has(item.id))
}

export const cosmosTroubleshootingLab = {
  id: 'data-cosmos-troubleshooting', title: 'Troubleshooting: Conversation History incidents',
  brief: 'The Knowledge Assistant\'s conversation history is misbehaving: a cost alert flags an oversized read, a sort query is failing outright, a write\'s RU charge has climbed, a stale-read report has come in, and the feedback processor is missing submitted items after a restart. Diagnose and repair each, verifying every fix against live evidence rather than by inspecting the source alone.',
  minutes: 50, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 3, labMode: 'troubleshooting',
  skillAreaId: 'data', service: 'cosmos-db', status: 'available',
  manifestId: COSMOS_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  dataTarget: { resourceGroup: ASSISTANT_GROUP, account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE },
  initialProjectFiles: initialFiles, solutionFiles: COSMOS_SOLUTION_FILES, initializeSimulation: seedCosmosTroubleshooting,
  meta: { baselineWriteCharge: BASELINE_WRITE_CHARGE },
  stages: [
    { id: 'diagnose', title: 'Diagnose and repair the conversation history incidents', taskIds: ['session-budget', 'ordered-restored', 'write-cost', 'fresh-read', 'feed-complete'] },
  ],
  scenarios: {
    // Reads a message already in the seeded conversation history (never
    // written by this scenario itself) - review fix: a fresh write-then-read
    // in the SAME request now 404s under Eventual/ConsistentPrefix (the
    // item hasn't "replicated" yet; see runtime.js's execReadItem), and this
    // Task's own incident (an oversized read) is independent of the
    // separate consistency incident 'fresh-read' repairs, so its own
    // standalone Solution must not accidentally depend on that other fix.
    'get-session': cosmosRequestScenario([
      { route: 'GET /sessions/{id}', args: ['msg-1', 'session-1'] },
    ]),
    'user-sessions-ordered': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_ORDERED] },
      { route: 'GET /users/{id}/sessions', args: [SEED_ORDERED.userId] },
    ]),
    'remember-answer': cosmosRequestScenario([
      { route: 'POST /answers', args: [{ ...REMEMBER_ITEM }] },
    ]),
    'write-then-read': cosmosRequestScenario([
      { route: 'POST /messages', args: [SEED_FRESH] },
      { route: 'GET /sessions/{id}', args: [SEED_FRESH.id, SEED_FRESH.sessionId] },
    ]),
    'feed-restart': cosmosWorkerScenario([
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[0] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[1] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[2] },
      { action: 'batch' },
      { action: 'restart' },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[3] },
      { action: 'post', route: 'feedback', args: FEEDBACK_ITEMS[4] },
      { action: 'batch' },
    ]),
  },
  tasks: [
    cosmosTask({
      id: 'session-budget', stageId: 'diagnose',
      text: 'A cost alert fired on the per-session lookup: confirm reading one saved message back by id now costs at most 2 RU.',
      explanation: 'get-session is the Knowledge Assistant\'s most frequent call; an oversized charge on it is the first thing a cost alert would flag.',
      hints: ['Run the get-session scenario and look at the RU charge shown for the read call in the result card, not the total.', 'A charge far above a few RU on a single small item is the signature of a scan, not a point read; a point read\'s own call type is reported alongside its charge.'],
      examNote: 'A point read (id + partition key) is the cheapest operation: ~1 RU per 1 KB; a query that cannot target one partition scans instead.',
      check: sessionBudgetReady,
      solution: { steps: [file('app.py'), ...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v5 .`), { kind: 'file', path: 'k8s/deployment.yaml', content: DEPLOYMENT_V5 }, ...commands('kubectl apply -f k8s/deployment.yaml'), scenario('get-session')] },
      verification: { scenarioId: 'get-session', scenarioVersion: 1 },
      fields: ['code:assistant-api:get_session'],
    }),
    cosmosTask({
      id: 'ordered-restored', stageId: 'diagnose',
      text: 'A sort query is failing outright: confirm the ordered conversation-history lookup (user-sessions-ordered) returns 200 again.',
      explanation: 'The ordered lookup sorts by two properties at once - a shape Cosmos can only serve from a matching composite index.',
      hints: ['Run the user-sessions-ordered scenario and read the error message in the result card.', 'A query failing with an error about a missing corresponding index, rather than returning empty or wrong rows, points at the container\'s indexing policy, not the query text.'],
      examNote: 'A multi-property ORDER BY needs a composite index; indexing policy is mutable and applied online.',
      check: orderedRestoredReady,
      solution: { steps: [...commands(`az cosmosdb sql container update --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name sessions --idx '${FIXED_SESSIONS_IDX_JSON}'`), scenario('user-sessions-ordered')] },
      verification: { scenarioId: 'user-sessions-ordered', scenarioVersion: 1 },
      fields: ['indexing:sessions', 'code:assistant-api:recent_sessions_for_user'],
    }),
    cosmosTask({
      id: 'write-cost', stageId: 'diagnose',
      text: 'A write\'s RU charge has climbed: confirm saving a Q&A entry (remember-answer) now costs at most 60% of its current baseline charge.',
      explanation: 'remember_answer writes the embedding alongside the question and answer; if nothing excludes it from ordinary indexing, every one of its numbers gets indexed on every write.',
      hints: ['Run the remember-answer scenario and compare the write call\'s RU charge in the result card against the baseline shown for this Task.', 'A property that is never filtered or sorted on directly but still costs RU on every write is a sign it is still being indexed.'],
      examNote: 'Excluding unqueried (and especially large, like a vector embedding) paths from ordinary indexing lowers write RU without touching the vector policy itself.',
      check: writeCostReady,
      solution: { steps: [...commands(`az cosmosdb sql container update --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name qa_history --idx '${FIXED_QA_IDX_JSON}'`), scenario('remember-answer')] },
      verification: { scenarioId: 'remember-answer', scenarioVersion: 1 },
      fields: ['indexing:qa_history', 'code:assistant-api:remember_answer'],
    }),
    cosmosTask({
      id: 'fresh-read', stageId: 'diagnose',
      text: 'A stale-read report came in: confirm reading a message back right after saving it is never reported stale.',
      explanation: 'clients.py\'s own consistency level is what determines whether a session\'s own very next read is guaranteed to see its own very last write.',
      hints: ['Run the write-then-read scenario and check the stale flag in the result card.', 'Session consistency guarantees read-your-writes for the client holding the session token; a weaker level does not.'],
      examNote: 'Session consistency guarantees read-your-writes for the client holding the session token; Eventual does not.',
      check: freshReadReady,
      // Also fixes app.py (so this Task's own build serves a point read
      // again, not just a corrected consistency level): this Task must
      // stand alone, and freshReadReady - like Lab 1's own pointReadReady -
      // requires an actual read_item call, since query_items never reports
      // staleness at all (see that check's own comment).
      solution: { steps: [file('app.py'), file('clients.py'), ...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v6 .`), { kind: 'file', path: 'k8s/deployment.yaml', content: DEPLOYMENT_V6 }, ...commands('kubectl apply -f k8s/deployment.yaml'), scenario('write-then-read')] },
      verification: { scenarioId: 'write-then-read', scenarioVersion: 1 },
      fields: ['deployedConsistency:assistant-api', 'accountConsistency'],
    }),
    cosmosTask({
      id: 'feed-complete', stageId: 'diagnose',
      text: 'Submitted feedback is going missing: confirm the change feed processor applies all 5 submitted items exactly once, even across a restart.',
      explanation: 'A restarted worker must resume from its own saved checkpoint rather than ignoring history or re-reading everything from the start.',
      hints: ['Run the feed-restart scenario and check the applied counts: the result card\'s value for the last batch, and the tally container\'s own item count.', 'A worker that never reads anything "from the beginning" and never saves where it left off will not see items that arrived before it started looking.'],
      examNote: 'Delivery is at-least-once: checkpoint after handling, and make the handler idempotent.',
      check: feedCompleteReady,
      solution: { steps: [file('worker.py'), ...commands(`az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v7 .`), { kind: 'file', path: 'k8s/worker.yaml', content: WORKER_V7 }, ...commands('kubectl apply -f k8s/worker.yaml'), scenario('feed-restart')] },
      verification: { scenarioId: 'feed-restart', scenarioVersion: 1 },
      fields: ['code:feedback-worker:process_changes', 'code:feedback-worker:save_lease'],
    }),
  ],
}


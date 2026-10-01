// Data journey Lab seeds (Task 8+). Mirrors aks-journey/integration-seeds.js's
// seedIntegrationGuided: replays only the AKS prerequisites a guided Lab
// needs before the learner's own Tasks begin, via the same applyRunAction
// path a learner's commands take (no shortcuts into the Sandbox for AKS
// resources). Unlike that AKS seed, this one does not create any Cosmos
// resource (account/database/container are Lab 1 Tasks) and does not apply
// the assistant-api Deployment (the learner builds and deploys it after
// completing Lab 1's code Task) - see task-8-brief.md.
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { upsertItem } from '../../../lib/data/cosmos-store.js'
import { cloneSandbox } from '../../../lib/sandbox/model.js'
import { DATA_FIXTURES } from '../../fixtures/data/knowledge.js'
import { ASSISTANT_ACCOUNT, ASSISTANT_CLUSTER, ASSISTANT_DATABASE, ASSISTANT_GROUP, ASSISTANT_NAMESPACE, ASSISTANT_REGISTRY } from './cosmos-helpers.js'
import { cosmosSdkGuidedLab } from './cosmos-sdk-guided.lab.js'
import { COSMOS_SOLUTION_FILES } from '../../templates/data-python/cosmos.js'

export function seedCosmosSdkGuided(run) {
  const lab = {
    id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  }
  let seeded = run
  const act = (action) => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some((line) => line.kind === 'err')) {
      throw new Error(`Cosmos SDK guided seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    }
    seeded = result.run
  }
  for (const line of [
    `az group create -n ${ASSISTANT_GROUP} -l eastus`,
    `az acr create -g ${ASSISTANT_GROUP} -n ${ASSISTANT_REGISTRY} --sku Basic`,
    `az aks create -g ${ASSISTANT_GROUP} -n ${ASSISTANT_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${ASSISTANT_REGISTRY}`,
    `az aks get-credentials -g ${ASSISTANT_GROUP} -n ${ASSISTANT_CLUSTER}`,
  ]) act({ type: 'command', line })

  // COSMOS_FILES has no k8s/namespace.yaml (ADR-0003's template is shared
  // across every Data journey Lab and never applies one), so the namespace
  // is injected directly, exactly as aks-journey/integration-seeds.js does
  // for its own fixture-only `diagnostics` Namespace.
  const clusterId = seeded.sandbox.aksClusters[0].id
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources[`Namespace//${ASSISTANT_NAMESPACE}`] = {
    apiVersion: 'v1', kind: 'Namespace',
    metadata: { name: ASSISTANT_NAMESPACE, uid: `fixture-${clusterId}-${ASSISTANT_NAMESPACE}-namespace`, resourceVersion: '1' },
  }
  act({ type: 'command', line: 'kubectl apply -f k8s/service.yaml' })

  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

// Data journey Lab 2 (Task 9): "Guided: Similar questions and a change feed
// processor". Its seed is the Lab 1 end state - account, database, `sessions`
// with conversation history, assistant-api deployed and working - plus the
// brief's extra containers. It reaches that state by replaying Lab 1's own
// provision/tune/code/deploy Tasks (not its verify/consistency Tasks, whose
// `scenario` steps need Lab 1's own Task list to resolve against, and whose
// evidence belongs to Lab 1, not this seed), the same way `seedCosmosSdkGuided`
// above replays raw AKS/ACR commands.
//
// Lab 2's own initialProjectFiles (cosmos-vector-guided.lab.js) leave
// remember_answer/find_similar_questions (app.py) and
// save_lease/process_changes/apply_feedback (worker.py) as starters - but
// parseDataApp (python-sdk.js) lowers every manifest.editZone together, so
// *any* unimplemented one fails the whole parse, and a build from those
// files would fail outright (project/build.js). So this seed's own internal
// `az acr build` (replayed from Lab 1's 'deployed' Task) is run against a
// scratch copy of the run with every edit zone pre-filled from
// COSMOS_SOLUTION_FILES - never against the real run returned to the
// learner, since only `sandbox`/`artifacts`/`runtime`/`nextSequence` survive
// past this function (see `createBehavioralRun`, labEngine/run.js). The
// result is a real build artifact whose own captured appSpec is frozen at
// build time (data-actions.js's `podAppSpec`): the seed-deployed assistant-api
// Pod keeps serving correct remember_answer/find_similar_questions from this
// build regardless of what the learner's own editor currently holds, exactly
// as the brief directs ("deploy the Lab 1 solution image; Lab 2's edit zones
// ... start as starters").
export function seedCosmosVectorGuided(run) {
  const lab = {
    id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  }
  let seeded = { ...run, ...seedCosmosSdkGuided(run) }
  const act = (action) => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some((line) => line.kind === 'err')) {
      throw new Error(`Cosmos vector guided seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    }
    seeded = result.run
  }

  // Pre-fill every edit zone so the replayed 'deployed' build below (and
  // every other build this seed runs) parses; see the function comment.
  act({ type: 'save-file', path: 'app.py', text: COSMOS_SOLUTION_FILES['app.py'] })
  act({ type: 'save-file', path: 'worker.py', text: COSMOS_SOLUTION_FILES['worker.py'] })

  for (const task of cosmosSdkGuidedLab.tasks) {
    if (task.stageId === 'verify' || task.stageId === 'consistency') continue
    for (const step of task.solution.steps) {
      if (step.kind === 'command') act({ type: 'command', line: step.line })
      else if (step.kind === 'file') act({ type: 'save-file', path: step.path, text: step.content })
      else throw new Error(`Unsupported Lab 1 replay step in the Lab 2 seed: ${step.kind}`)
    }
  }

  // Seed `sessions` with conversation history (task-9-brief.md: "sessions
  // with items"), written directly into the Sandbox exactly as a fixture -
  // mirroring `seedCosmosSdkGuided`'s own fixture-only Namespace injection
  // above - rather than through the request pipeline, since no Lab 2 Task
  // needs this history to have been produced by a learner action.
  const sessionsRef = { account: ASSISTANT_ACCOUNT, database: ASSISTANT_DATABASE, container: 'sessions' }
  let sandbox = seeded.sandbox
  for (const message of DATA_FIXTURES.sessions) {
    sandbox = upsertItem(sandbox, sessionsRef, message, { nowMs: seeded.runtime.simTimeMs }).sandbox
  }
  seeded = { ...seeded, sandbox }

  // The brief's extra containers beyond Lab 1's own: `feedback` (seeded with
  // 0 items) and `tally` ("the container `tally` is supplied by the seed" -
  // task-9-brief.md's no-miss Task). `qa_history` and `leases` are the
  // learner's own Tasks (qa-container, leases), so they are not created here.
  act({ type: 'command', line: `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name feedback --partition-key-path /questionId --throughput 400` })
  act({ type: 'command', line: `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name tally --partition-key-path /questionId --throughput 400` })

  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

// Data journey Lab 3 (Task 10): "Troubleshooting: Conversation History
// incidents". task-10-brief.md: the seed reaches the full Lab 2 end state,
// then deploys an image built from faulty source files (incidents 1/3/4 -
// app.py's get_session, clients.py's consistency, worker.py's process_changes)
// and sets faulty indexing policies (incident 2). It reaches "full Lab 2 end
// state" the same way seedCosmosVectorGuided reaches "Lab 1 end state" above
// - by replaying Lab 2's own Tasks on top of seedCosmosVectorGuided's own
// output, rather than a from-scratch replay. The replayed commands below are
// copied from cosmos-vector-guided.lab.js's own `capability`/`leases`/
// `worker-deployed` Tasks (not imported from that module - cosmos-seeds.js
// is already imported BY it for seedCosmosVectorGuided, and Lab 1 already
// forms the same kind of cycle with this file; adding a second Lab on the
// other side of it broke both Labs' bundling under this project's ESM
// tooling, so this seed only ever imports Lab 1's Lab object, never Lab 2's);
// `qa-container` (that Task's own command) is replaced below by the faulty
// variant (incident 2), and `code-vectors`/`code-feed` (those Tasks' own
// `file` steps, to app.py/worker.py) are never replayed at all - this Lab's
// `initialProjectFiles` (cosmos-troubleshooting.lab.js) are already the
// faulty source for those two files, a full implementation rather than
// NotImplementedError starters, so it parses and builds as-is, and nothing
// here may overwrite it back to correct. `createBehavioralRun` (labEngine/
// run.js) builds `run.project` from `initialProjectFiles` *before* calling
// this function, and only this function's `sandbox`/`artifacts`/`runtime`/
// `nextSequence` survive past it - so the learner's own project files are
// exactly that faulty source throughout, regardless of what this seed's own
// scratch `seeded.project` does along the way.
export const VECTOR_EMBEDDINGS_JSON = '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"}]}'
export const FAULTY_QA_IDX_JSON = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"}],"vectorIndexes":[{"path":"/embedding","type":"quantizedFlat"}]}'
const FAULTY_SESSIONS_IDX_JSON = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/_etag/?"},{"path":"/text/?"}],"compositeIndexes":[]}'

export function seedCosmosTroubleshooting(run) {
  const lab = {
    id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  }
  // Lab 1's end state + feedback/tally containers + sessions history fixture
  // (seedCosmosVectorGuided's own prerequisite for Lab 2) - built internally
  // from THAT seed's own pre-filled, correct scratch copy. `run.project` here
  // (this Lab's own faulty initialProjectFiles) is untouched either way,
  // since that seed only ever returns {sandbox, artifacts, runtime, nextSequence}.
  let seeded = { ...run, ...seedCosmosVectorGuided(run) }
  const act = (action) => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some((line) => line.kind === 'err')) {
      throw new Error(`Cosmos troubleshooting seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    }
    seeded = result.run
  }

  // Lab 2's own deliverables on top of that prerequisite (see the function
  // comment for why these are copied rather than replayed from
  // cosmosVectorGuidedLab.tasks): enable vector search, create qa_history
  // with the faulty indexing policy (incident 2), create leases, then build
  // and deploy feedback-worker - that build captures this Lab's still-faulty
  // worker.py as-is (never touched above), so incident 4 needs no further
  // rebuild here.
  act({ type: 'command', line: `az cosmosdb update --name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --capabilities EnableNoSQLVectorSearch` })
  act({ type: 'command', line: `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name qa_history --partition-key-path /product --throughput 400 --vector-embeddings '${VECTOR_EMBEDDINGS_JSON}' --idx '${FAULTY_QA_IDX_JSON}'` })
  act({ type: 'command', line: `az cosmosdb sql container create --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name leases --partition-key-path /id --throughput 400` })
  act({ type: 'command', line: `az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v3 .` })
  act({ type: 'save-file', path: 'k8s/worker.yaml', text: COSMOS_SOLUTION_FILES['k8s/worker.yaml'].replace('assistant:v1', 'assistant:v3') })
  act({ type: 'command', line: 'kubectl apply -f k8s/worker.yaml' })

  // Incidents 1/3 (app.py's get_session, clients.py's consistency): rebuild
  // and redeploy assistant-api now - its Lab 1/2-prerequisite deployment
  // above was built from seedCosmosVectorGuided's own corrected scratch copy,
  // so it is still serving correct code until this rebuild captures
  // `seeded.project.savedFiles` (this Lab's own faulty source, never touched
  // above).
  act({ type: 'command', line: `az acr build --registry ${ASSISTANT_REGISTRY} --image assistant:v4 .` })
  act({ type: 'save-file', path: 'k8s/deployment.yaml', text: COSMOS_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:v4') })
  act({ type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' })

  // Incident 2 (sessions): no composite index. Indexing policy is live
  // Sandbox state, read fresh on every query, so no rebuild/redeploy is
  // needed for this half of incident 2.
  act({ type: 'command', line: `az cosmosdb sql container update --account-name ${ASSISTANT_ACCOUNT} --resource-group ${ASSISTANT_GROUP} --database-name ${ASSISTANT_DATABASE} --name sessions --idx '${FAULTY_SESSIONS_IDX_JSON}'` })

  // task-10-brief.md: sessions' teaching-approximation scale. No CLI command
  // changes physicalPartitions/logicalScale after a container is created
  // (createCosmosContainer, sandbox/cosmosdb.js), so this is set directly,
  // the same way the Lab 1 seed above injects its own fixture Namespace.
  const sandbox = cloneSandbox(seeded.sandbox)
  const sessionsContainer = sandbox.cosmosAccounts.find((item) => item.name === ASSISTANT_ACCOUNT)
    ?.databases.find((item) => item.name === ASSISTANT_DATABASE)
    ?.containers.find((item) => item.name === 'sessions')
  if (sessionsContainer) { sessionsContainer.physicalPartitions = 4; sessionsContainer.logicalScale = 50 }
  seeded = { ...seeded, sandbox }

  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

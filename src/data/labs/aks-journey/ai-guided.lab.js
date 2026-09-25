import { INTEGRATION_FILES, INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../../templates/aks-python/integration.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { AI_GUIDED_CLUSTER, AI_GUIDED_GROUP, AI_GUIDED_IMAGE, AI_GUIDED_REGISTRY, integrationScenario, integrationTask } from './integration-helpers.js'
import { seedIntegrationGuided } from './integration-seeds.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${AI_GUIDED_GROUP}/providers/Microsoft.ContainerService/managedClusters/${AI_GUIDED_CLUSTER}`
const target = { clusterId, namespace: 'assistant', serviceName: 'assistant-public', deploymentName: 'assistant' }
const solutionDeployment = INTEGRATION_SOLUTION_FILES['k8s/deployment.yaml']
  .replace('acraksintegration.azurecr.io/assistant:integration-v1', AI_GUIDED_IMAGE)
  .replace('          ports:', '          imagePullPolicy: Always\n          ports:')
const solutionFiles = {
  ...INTEGRATION_SOLUTION_FILES,
  'k8s/deployment.yaml': solutionDeployment,
  'k8s/service-internal.yaml': INTEGRATION_SOLUTION_FILES['k8s/service-internal.yaml'].replace('    - port: 80', '    - port: 80\n      protocol: TCP'),
  'k8s/service-external.yaml': INTEGRATION_SOLUTION_FILES['k8s/service-external.yaml'].replace('    - port: 80', '    - port: 80\n      protocol: TCP'),
}
const starterApp = solutionFiles['app.py']
  .replace('    question = question.strip()\n    if not question:\n        return {"status": 400, "body": {"error": "Question is required."}}\n', '')
  .replace('deployment=cfg["embedding_deployment"]', 'deployment=cfg["answer_deployment"]')
  .replace('"audience": cfg["audience"]', '"audience": "visitor"')
  .replace('context = [{"id": row["id"], "content": row["content"]} for row in rows]', 'context = []')
  .replace('"sources": [row["id"] for row in rows]', '"sources": []')
const starterSql = solutionFiles['retrieval.sql'].replace('  AND audience = %(audience)s\n  AND published = %(published)s\n', '')
const initialFiles = { ...solutionFiles, 'app.py': starterApp, 'retrieval.sql': starterSql,
  'k8s/deployment.yaml': solutionDeployment.replace('assistant:integration-v1', 'assistant:baseline') }
const file = path => ({ kind: 'file', path, content: solutionFiles[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const parsed = context => parsePythonProject(context.project.savedFiles, INTEGRATION_MANIFEST).appSpec
const graphHas = (context, predicate) => parsed(context)?.integration?.graph?.nodes?.some(predicate) === true
const graph = context => parsed(context)?.integration?.graph
const node = (context, id) => graph(context)?.nodes?.find(item => item.id === id)
const origin = (context, id) => {
  const item = node(context, id)
  return item?.op === 'binding' ? origin(context, item.value) : item
}
const invoke = (context, method) => graph(context)?.nodes?.find(item => item.op === 'invoke' && item.method === method && Object.keys(item.args?.keywords ?? {}).length > 0)
const literal = (context, id, value) => {
  const item = origin(context, id)
  return item?.op === 'literal' && item.value === value
}
const sourceReady = context => !!parsed(context)
  && graphHas(context, node => node.op === 'strip')
  && graphHas(context, node => node.op === 'context-rows' && node.fields?.id === 'id' && node.fields?.content === 'content')
  && graphHas(context, node => node.op === 'source-ids' && node.field === 'id')
const embeddingReady = context => {
  const call = invoke(context, 'embed')
  const query = parsed(context)?.integration?.querySpec
  const params = origin(context, invoke(context, 'execute')?.args?.keywords?.params)
  const vector = origin(context, params?.entries?.[query?.order?.vectorParameter])
  const question = origin(context, call?.args?.keywords?.question)
  return sourceReady(context) && question?.op === 'strip' && origin(context, question.input)?.op === 'input'
    && origin(context, call?.args?.keywords?.deployment)?.op === 'config'
    && origin(context, call?.args?.keywords?.deployment)?.key === 'embedding_deployment'
    && vector?.op === 'vector-format' && origin(context, vector.input)?.id === call?.id
}
const retrievalReady = context => {
  const query = parsed(context)?.integration?.querySpec
  const filters = Object.fromEntries((query?.filters ?? []).map(item => [item.column, item.parameter]))
  const embedding = invoke(context, 'embed')
  const params = origin(context, invoke(context, 'execute')?.args?.keywords?.params)
  const collection = origin(context, params?.entries?.[filters.collection])
  const audience = origin(context, params?.entries?.[filters.audience])
  const vector = origin(context, params?.entries?.[query?.order?.vectorParameter])
  const vectorInput = origin(context, vector?.input)
  return sourceReady(context) && filters.collection && filters.audience && filters.published && query?.distance?.parameter === query.order?.vectorParameter
    && query?.distance?.cutoffParameter && query?.limitParameter
    && query.order?.direction === 'ASC' && query.order.idDirection === 'ASC'
    && collection?.op === 'config' && collection.key === 'collection' && audience?.op === 'config' && audience.key === 'audience'
    && literal(context, params?.entries?.[filters.published], true) && vector?.op === 'vector-format' && vectorInput?.id === embedding?.id
    && literal(context, params?.entries?.[query.distance.cutoffParameter], 0.2) && literal(context, params?.entries?.[query.limitParameter], 1)
}
const contextReady = context => {
  const execute = invoke(context, 'execute')
  const generate = invoke(context, 'generate')
  const contextRows = origin(context, generate?.args?.keywords?.context)
  const source = graph(context)?.nodes?.find(item => item.op === 'source-ids')
  const rows = graph(context)?.nodes?.find(item => item.op === 'binding' && origin(context, item.value)?.id === execute?.id)
  const answer = graph(context)?.nodes?.find(item => item.op === 'config' && item.key === 'answer' && origin(context, item.object)?.id === generate?.id)
  const responseBody = graph(context)?.nodes?.find(item => item.op === 'dictionary' && item.entries?.answer === answer?.id && item.entries?.sources === source?.id)
  return sourceReady(context) && origin(context, rows?.value)?.id === execute?.id
    && contextRows?.op === 'context-rows' && contextRows.rows === rows?.id
    && source?.op === 'source-ids' && source.rows === rows?.id && answer?.op === 'config' && !!responseBody
}
const deployed = context => {
  const state = context.runtime.kubernetes?.clusters?.[clusterId]
  const artifactId = context.artifacts.publishedTags?.[AI_GUIDED_IMAGE]
  const artifact = artifactId && context.artifacts.buildsById?.[artifactId]
  const deployment = state?.resources['Deployment/assistant/assistant']
  const pods = getDeploymentPods(context.run ?? context, clusterId, 'assistant', 'assistant')
  return sourceReady(context) && deployment?.spec?.template?.spec?.containers?.[0]?.image === AI_GUIDED_IMAGE
    && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, INTEGRATION_MANIFEST))
    && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}
const task = (id, stageId, text, explanation, hints, examNote, check, solution, verification) => integrationTask({ id, stageId, text, explanation, hints, examNote, check, solution, verification, target })

export const aksAiGuidedLab = {
  id: 'aks-ai-guided', title: 'Build an AKS knowledge assistant',
  brief: 'Implement the supplied question-to-answer flow with deterministic training fixtures. The PostgreSQL fixture has vector(3) embeddings: [1,0,0] finds backups, [0,1,0] finds support, and [0,0,1] has no match. Retrieve only published training documents for employees; metadata filters make retrieval correct, they are not authorization controls.',
  minutes: 50, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 10, labMode: 'guided', skillAreaId: 'containers', service: 'aks', status: 'available',
  manifestId: INTEGRATION_MANIFEST.id, capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true },
  initialProjectFiles: initialFiles, solutionFiles, initializeSimulation: seedIntegrationGuided,
  stages: [
    { id: 'source', title: 'Implement the source flow', taskIds: ['validate-input', 'embed-question', 'retrieve-documents', 'construct-context'] },
    { id: 'deploy', title: 'Capture and deploy the source', taskIds: ['deploy-source'] },
    { id: 'verify', title: 'Verify real retrieval behavior', taskIds: ['answer-backups', 'answer-support', 'no-match'] },
  ],
  scenarios: {
    'guided-ai-empty': integrationScenario({ id: 'guided-ai-empty', clusterId, question: '   ', expected: { status: 400, body: { error: 'Question is required.' } } }),
    'guided-ai-backups': integrationScenario({ id: 'guided-ai-backups', clusterId, question: 'How long are backups kept?', expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } } }),
    'guided-ai-support': integrationScenario({ id: 'guided-ai-support', clusterId, question: 'Who provides support?', expected: { status: 200, body: { answer: 'Contact the training desk for support.', sources: ['training-support'], environment: 'training' } } }),
    'guided-ai-no-match': integrationScenario({ id: 'guided-ai-no-match', clusterId, question: 'What is the travel allowance?', expected: { status: 200, body: { answer: 'No matching documents.', sources: [], environment: 'training' } } }),
  },
  tasks: [
    task('validate-input', 'source', 'Strip the question and reject empty input before dependencies run. Behavioral evidence becomes available after deployment.', 'server.py validates the JSON shape. app.py owns the distinct rule that a supplied string cannot be empty after stripping.', ['Bind the stripped string before the guard.', 'Return a 400 body before settings or a client call.'], 'A 400 for a blank question should have zero dependency operations.', sourceReady, { steps: [file('app.py')] }),
    task('embed-question', 'source', 'Embed the learner question with cfg["embedding_deployment"], then carry that returned vector into retrieval.', 'The adapter supplies a fixed vector for each supported question. A literal vector cannot prove which question was embedded.', ['Use RequestBudget.invoke around EmbeddingClient.embed.', 'Pass question and the embedding deployment as named arguments.'], 'Embedding is a dependency stage; capture its returned vector before formatting it for the SQL binding.', embeddingReady, { steps: [file('app.py')] }),
    task('retrieve-documents', 'source', 'Bind collection, audience, published, vector, cutoff, and limit as named query parameters; restore the audience and published SQL predicates.', 'Cosine distance is smaller for a closer vector. The fixture ranks by distance then ID, with a cutoff of 0.2 and one result.', ['Use cfg for collection and audience, then True for published.', 'Keep values in params; do not interpolate them into SQL.'], 'Psycopg-style named parameters keep data separate from the SQL text.', retrievalReady, { steps: [file('app.py'), file('retrieval.sql')] }),
    task('construct-context', 'source', 'Build answer context from retrieved row IDs and content, then derive sources from those same rows.', 'The answer adapter accepts one supplied document row. It will reject fabricated context and cannot be satisfied by a canned response.', ['Use a row comprehension for id and content.', 'Use a second row comprehension for response source IDs.'], 'Retrieved rows provide both answer context and response provenance.', contextReady, { steps: [file('app.py')] }),
    task('deploy-source', 'deploy', 'Build assistant:integration-v1, apply the saved Deployment, and verify blank input through the deployed Service.', 'A build captures saved build files. Applying YAML alone cannot update the image that running Pods use.', ['Use the acraksaiguided registry and the integration-v1 tag.', 'The Deployment image must use the same fully qualified tag.'], 'A deployed proof needs the current artifact, Deployment, and captured Pods.', deployed, { steps: [file('k8s/deployment.yaml'), ...commands(`az acr build -r ${AI_GUIDED_REGISTRY} -t assistant:integration-v1 .`, 'kubectl apply -f k8s/deployment.yaml', 'kubectl rollout status deployment/assistant -n assistant', 'kubectl get pods -n assistant', `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant:80/api/ask`), { kind: 'scenario', scenarioId: 'guided-ai-empty' }] }, { scenarioId: 'guided-ai-empty', scenarioVersion: 1 }),
    task('answer-backups', 'verify', 'Verify the backups question and inspect the embedding, retrieval, answer, selected-row, and source trace.', 'A healthy response calls all three supplied stages and selects training-backups.', ['Run the named backups verification.', 'Inspect the trace before moving to a different question.'], 'A source list is evidence only when it comes from the rows selected by the captured query.', deployed, { steps: [{ kind: 'scenario', scenarioId: 'guided-ai-backups' }, { kind: 'inspect' }] }, { scenarioId: 'guided-ai-backups', scenarioVersion: 1 }),
    task('answer-support', 'verify', 'Verify support with the same deployed flow.', 'A support question has a different fixed vector and must select training-support.', ['Use the supplied support scenario.', 'A hardcoded backups answer cannot satisfy this proof.'], 'Each request captures its own immutable fixture profile and dependency trace.', deployed, { steps: [{ kind: 'scenario', scenarioId: 'guided-ai-support' }, { kind: 'inspect' }] }, { scenarioId: 'guided-ai-support', scenarioVersion: 1 }),
    task('no-match', 'verify', 'Verify travel returns the declared no-match body after embedding and retrieval, without an answer call.', 'The travel vector has no row within the cutoff, so the answer stage must remain unreached.', ['Run the no-match scenario.', 'Inspect the operation list for an unreached answer stage.'], 'No-match is a successful retrieval outcome, not an answer-service error.', deployed, { steps: [{ kind: 'scenario', scenarioId: 'guided-ai-no-match' }, { kind: 'inspect' }] }, { scenarioId: 'guided-ai-no-match', scenarioVersion: 1 }),
  ],
}

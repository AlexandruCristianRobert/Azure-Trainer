import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../../templates/aks-python/integration.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { AI_INDEPENDENT_CLUSTER, AI_INDEPENDENT_GROUP, AI_INDEPENDENT_IMAGE, AI_INDEPENDENT_REGISTRY, integrationTask } from './integration-helpers.js'
import { seedIntegrationIndependent } from './integration-seeds.js'

const clusterId = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${AI_INDEPENDENT_GROUP}/providers/Microsoft.ContainerService/managedClusters/${AI_INDEPENDENT_CLUSTER}`
const target = { clusterId, namespace: 'review', serviceName: 'assistant-public', deploymentName: 'assistant' }
const solutionFiles = {
  ...INTEGRATION_SOLUTION_FILES,
  'k8s/namespace.yaml': INTEGRATION_SOLUTION_FILES['k8s/namespace.yaml'].replace('name: assistant', 'name: review'),
  'k8s/configmap.yaml': INTEGRATION_SOLUTION_FILES['k8s/configmap.yaml'].replace('namespace: assistant', 'namespace: review').replace('APP_ENV: training', 'APP_ENV: review').replace('ai-training', 'ai-review').replace('pg-training', 'pg-review').replace('assistant_training', 'assistant_review').replace('COLLECTION: training', 'COLLECTION: review').replace('AUDIENCE: employee', 'AUDIENCE: partner'),
  'k8s/secret.yaml': INTEGRATION_SOLUTION_FILES['k8s/secret.yaml'].replace('namespace: assistant', 'namespace: review').replace('training-only-password', 'review-only-password'),
  'k8s/deployment.yaml': INTEGRATION_SOLUTION_FILES['k8s/deployment.yaml'].replace('namespace: assistant', 'namespace: review').replace('acraksintegration.azurecr.io/assistant:integration-v1', AI_INDEPENDENT_IMAGE).replace('          ports:', '          imagePullPolicy: Always\n          ports:'),
  'k8s/service-internal.yaml': INTEGRATION_SOLUTION_FILES['k8s/service-internal.yaml'].replace('namespace: assistant', 'namespace: review').replace('    - port: 80', '    - port: 80\n      protocol: TCP'),
  'k8s/service-external.yaml': INTEGRATION_SOLUTION_FILES['k8s/service-external.yaml'].replace('namespace: assistant', 'namespace: review').replace('    - port: 80', '    - port: 80\n      protocol: TCP'),
}
const starterApp = solutionFiles['app.py']
  .replace('    question = question.strip()\n    if not question:\n        return {"status": 400, "body": {"error": "Question is required."}}\n', '')
  .replace('"collection": cfg["collection"]', '"collection": "training"')
  .replace('"audience": cfg["audience"]', '"audience": "employee"')
  .replace('context = [{"id": row["id"], "content": row["content"]} for row in rows]', 'context = []')
  .replace('"sources": [row["id"] for row in rows]', '"sources": []')
const starterSql = solutionFiles['retrieval.sql'].replace('  AND audience = %(audience)s\n  AND published = %(published)s\n', '')
const initialFiles = { ...solutionFiles, 'app.py': starterApp, 'retrieval.sql': starterSql, 'k8s/deployment.yaml': solutionFiles['k8s/deployment.yaml'].replace('assistant:partner-v1', 'assistant:baseline') }
const file = path => ({ kind: 'file', path, content: solutionFiles[path] })
const commands = (...lines) => lines.map(line => ({ kind: 'command', line }))
const app = context => parsePythonProject(context.project.savedFiles, INTEGRATION_MANIFEST).appSpec
const graph = context => app(context)?.integration?.graph
const nodes = context => new Map((graph(context)?.nodes ?? []).map(item => [item.id, item]))
const unwrap = (context, id) => { const item = nodes(context).get(id); return item?.op === 'binding' ? unwrap(context, item.value) : item }
const invoke = (context, method) => graph(context)?.nodes?.find(item => item.op === 'invoke' && item.method === method && Object.keys(item.args?.keywords ?? {}).length)
const literal = (context, id, value) => { const item = unwrap(context, id); return item?.op === 'literal' && item.value === value }
const sourceReady = context => !!app(context) && graph(context)?.nodes?.some(item => item.op === 'strip')
  && graph(context)?.nodes?.some(item => item.op === 'context-rows' && item.fields?.id === 'id' && item.fields?.content === 'content')
  && graph(context)?.nodes?.some(item => item.op === 'source-ids' && item.field === 'id')
const bindingsReady = context => {
  const query = app(context)?.integration?.querySpec; const filters = Object.fromEntries((query?.filters ?? []).map(item => [item.column, item.parameter])); const params = unwrap(context, invoke(context, 'execute')?.args?.keywords?.params)
  const collection = unwrap(context, params?.entries?.[filters.collection]); const audience = unwrap(context, params?.entries?.[filters.audience])
  return sourceReady(context) && collection?.op === 'config' && collection.key === 'collection' && audience?.op === 'config' && audience.key === 'audience'
}
const queryReady = context => {
  const query = app(context)?.integration?.querySpec; const filters = Object.fromEntries((query?.filters ?? []).map(item => [item.column, item.parameter])); const execute = invoke(context, 'execute'); const params = unwrap(context, execute?.args?.keywords?.params); const embedding = invoke(context, 'embed'); const vector = unwrap(context, params?.entries?.[query?.order?.vectorParameter])
  return bindingsReady(context) && ['collection', 'audience', 'published'].every(key => filters[key])
    && query?.distance?.cutoffParameter && query?.limitParameter && query?.order?.direction === 'ASC' && query?.order?.idDirection === 'ASC'
    && query?.distance?.parameter === query?.order?.vectorParameter && literal(context, params?.entries?.[filters.published], true) && literal(context, params?.entries?.[query.distance.cutoffParameter], 0.2) && literal(context, params?.entries?.[query.limitParameter], 1)
    && vector?.op === 'vector-format' && unwrap(context, vector.input)?.id === embedding?.id
}
const contextReady = context => {
  const execute = invoke(context, 'execute'); const generate = invoke(context, 'generate'); const contextRows = unwrap(context, generate?.args?.keywords?.context); const source = graph(context)?.nodes?.find(item => item.op === 'source-ids'); const rows = graph(context)?.nodes?.find(item => item.op === 'binding' && unwrap(context, item.value)?.id === execute?.id); const answer = graph(context)?.nodes?.find(item => item.op === 'config' && item.key === 'answer' && unwrap(context, item.object)?.id === generate?.id); const body = graph(context)?.nodes?.find(item => item.op === 'dictionary' && item.entries?.answer === answer?.id && item.entries?.sources === source?.id)
  return queryReady(context) && contextRows?.op === 'context-rows' && contextRows.rows === rows?.id && source?.op === 'source-ids' && source.rows === rows?.id && !!body
}
const deployed = context => {
  const state = context.runtime.kubernetes?.clusters?.[clusterId]; const artifactId = context.artifacts.publishedTags?.[AI_INDEPENDENT_IMAGE]; const artifact = artifactId && context.artifacts.buildsById?.[artifactId]; const deployment = state?.resources['Deployment/review/assistant']; const pods = getDeploymentPods(context.run ?? context, clusterId, 'review', 'assistant')
  return contextReady(context) && deployment?.spec?.template?.spec?.containers?.[0]?.image === AI_INDEPENDENT_IMAGE && artifact?.sourceHash === projectSourceHash(selectBuildFiles(context.project.savedFiles, INTEGRATION_MANIFEST)) && pods.length === 2 && pods.every(pod => state.podSnapshots[pod.metadata.uid]?.artifactId === artifactId)
}
const scenario = (id, question, expected, internal = false) => ({ kind: 'aks-request', version: 1, target: internal ? { ...target, serviceName: 'assistant-internal' } : target, connectivity: internal ? { origin: { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }, hostname: 'assistant-internal.review', port: 80 } : { origin: { kind: 'external' }, service: { namespace: 'review', name: 'assistant-public' }, port: 80 }, request: { method: 'POST', path: '/api/ask', body: { question } }, expected, integrationProfile: 'healthy' })
const success = (answer, sources) => ({ status: 200, body: { answer, sources, environment: 'review' } })
const task = (id, stageId, text, explanation, hints, examNote, check, steps, verification) => integrationTask({ id, stageId, text, explanation, hints, examNote, check, solution: { steps }, verification, target })

export const aksAiIndependentLab = {
  id: 'aks-ai-independent', title: 'Adapt AKS retrieval to a partner corpus', brief: 'Adapt the supplied Python question-to-answer flow to the review partner corpus. The immutable fixture has vector(3) values: backups is [1,0,0], support is [0,1,0], and travel has no nearby row. Retrieve only published review documents for partner readers with a cosine cutoff of 0.2, one result, and distance then ID tie-breaking. These metadata filters demonstrate retrieval correctness, not tenant authorization.', minutes: 50, engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 12, labMode: 'independent', skillAreaId: 'containers', service: 'aks', status: 'draft', manifestId: INTEGRATION_MANIFEST.id,
  capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true, kubernetesAiIntegration: true }, initialProjectFiles: initialFiles, solutionFiles, initializeSimulation: seedIntegrationIndependent,
  stages: [{ id: 'adapt', title: 'Bind and query the partner corpus', taskIds: ['partner-bindings', 'partner-query', 'partner-context'] }, { id: 'deploy', title: 'Build the partner image', taskIds: ['deploy-partner'] }, { id: 'verify', title: 'Prove partner retrieval', taskIds: ['partner-backups', 'partner-support', 'partner-no-match', 'partner-empty', 'partner-internal'] }],
  scenarios: {
    'independent-ai-backups': scenario('independent-ai-backups', 'How long are backups kept?', success('Review backups are kept for 7 days.', ['review-backups'])),
    'independent-ai-support': scenario('independent-ai-support', 'Who provides support?', success('Contact the partner desk for support.', ['review-support'])),
    'independent-ai-no-match': scenario('independent-ai-no-match', 'What is the travel allowance?', success('No matching documents.', [])),
    'independent-ai-empty': scenario('independent-ai-empty', '   ', { status: 400, body: { error: 'Question is required.' } }),
    'independent-ai-internal': scenario('independent-ai-internal', 'How long are backups kept?', success('Review backups are kept for 7 days.', ['review-backups']), true),
  },
  tasks: [
    task('partner-bindings', 'adapt', 'Bind retrieval collection and audience to the supplied review configuration, then reject empty input before dependencies run.', 'The ConfigMap supplies review and partner, but Python must read those settings rather than retaining training literals.', ['Use cfg for both metadata values.', 'Strip before the empty-input guard.'], 'A blank question has no dependency operations.', bindingsReady, [file('app.py')]),
    task('partner-query', 'adapt', 'Add audience and published SQL predicates and bind all metadata, vector, cutoff, and limit parameters.', 'The corpus also includes employee and draft decoys. Rank by cosine distance then ID.', ['Keep values as named parameters.', 'Use True, 0.2, and 1 for the fixed values.'], 'Filters establish retrieval correctness, not authorization.', queryReady, [file('app.py'), file('retrieval.sql')]),
    task('partner-context', 'adapt', 'Generate answer context and response source IDs from retrieved rows.', 'The adapter validates both row ID and content, so a canned answer or invented source list cannot pass.', ['Create id/content dictionaries from rows.', 'Build sources from the same rows.'], 'No match must skip the answer call.', contextReady, [file('app.py')]),
    task('deploy-partner', 'deploy', 'Build assistant:partner-v1 and apply the review-namespace Deployment.', 'The build captures app.py and retrieval.sql; applying an older tag keeps old source running.', ['Use acraksaiindependent.', 'The Deployment image must match the built tag.'], 'Two Pods must capture the current artifact.', deployed, [file('k8s/deployment.yaml'), ...commands(`az acr build -r ${AI_INDEPENDENT_REGISTRY} -t assistant:partner-v1 .`, 'kubectl apply -f k8s/deployment.yaml', 'kubectl rollout status deployment/assistant -n review')]),
    task('partner-backups', 'verify', 'Verify backups through the review external Service and inspect the retrieved source.', 'The partner answer differs from the training corpus.', ['Run the backups scenario.', 'Inspect its request trace.'], 'Decoy sources are never proof.', deployed, [{ kind: 'scenario', scenarioId: 'independent-ai-backups' }, { kind: 'inspect' }], { scenarioId: 'independent-ai-backups', scenarioVersion: 1 }),
    task('partner-support', 'verify', 'Verify partner support through the external Service.', 'Support uses a distinct vector and document.', ['Use the named support scenario.', 'Check the returned source ID.'], 'One scenario supplies one immutable receipt.', deployed, [{ kind: 'scenario', scenarioId: 'independent-ai-support' }, { kind: 'inspect' }], { scenarioId: 'independent-ai-support', scenarioVersion: 1 }),
    task('partner-no-match', 'verify', 'Verify travel returns the declared no-match body after embedding and retrieval only.', 'No selected row means AnswerClient is unreached.', ['Run travel.', 'Inspect operation count.'], 'No match is a successful retrieval outcome.', deployed, [{ kind: 'scenario', scenarioId: 'independent-ai-no-match' }, { kind: 'inspect' }], { scenarioId: 'independent-ai-no-match', scenarioVersion: 1 }),
    task('partner-empty', 'verify', 'Verify blank input is rejected before any dependency.', 'JSON shape checking belongs to server.py; whitespace semantics belong to app.py.', ['Use the empty scenario.', 'Inspect the zero-operation trace.'], 'Do not send blank questions to embedding.', deployed, [{ kind: 'scenario', scenarioId: 'independent-ai-empty' }, { kind: 'inspect' }], { scenarioId: 'independent-ai-empty', scenarioVersion: 1 }),
    task('partner-internal', 'verify', 'Verify the same backups flow through internal DNS from diagnostics.', 'Internal and external Services route to the same captured Pods.', ['Use the internal scenario.', 'Confirm review namespace routing.'], 'Network origin is part of the request evidence.', deployed, [{ kind: 'scenario', scenarioId: 'independent-ai-internal' }, { kind: 'inspect' }], { scenarioId: 'independent-ai-internal', scenarioVersion: 1 }),
  ],
}

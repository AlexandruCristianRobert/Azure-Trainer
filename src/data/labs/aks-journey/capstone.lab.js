import { CAPSTONE_FILES, CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../../templates/aks-python/capstone.js'
import { CAPSTONE_CLUSTER_ID, CAPSTONE_TARGET, CAPSTONE_EXTERNAL, CAPSTONE_IMAGE,
  capstoneLive, capstoneCommand as command, capstoneFile as file, capstoneVerify as verify,
  capstoneSolution as solution } from './capstone-helpers.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'

const stages = [
  ['source', 'Complete the application contract', ['source-contract']],
  ['provision', 'Provision the registry and AKS', ['registry-created', 'image-v1', 'cluster-connected']],
  ['deploy', 'Deploy the saved application', ['config-applied', 'deployment-ready', 'routing-ready']],
  ['behavior', 'Prove assistant behavior', ['answer-backups', 'answer-support', 'invalid-input', 'no-match']],
  ['resilience', 'Measure health and capacity', ['startup-proof', 'readiness-proof', 'liveness-proof', 'manual-capacity', 'hpa-cycle', 'ai-wait', 'release-baseline']],
  ['release', 'Release and recover', ['published-v2', 'release-v2', 'rollback-recovered']],
  ['incident', 'Diagnose and repair an incident', ['fault-route', 'fault-dependency', 'incident-recovered']],
  ['final-cleanup', 'Prove the final service and clean up', ['final-internal', 'final-external', 'final-invalid', 'final-no-match', 'final-timeout', 'cleanup-app', 'cleanup-cloud']],
].map(([id, title, taskIds]) => ({ id, title, taskIds }))

export function capstoneTask(id, content) {
  return { id, stageId: stages.find(stage => stage.taskIds.includes(id))?.id,
    text: content.text, check: content.check, dependencies: content.dependencies ?? {},
    verification: { scenarioId: `capstone-${id}`, scenarioVersion: 1 },
    hints: content.hints, solution: content.solution, examNote: content.examNote,
    ...(content.aksSourceIndependent ? { aksSourceIndependent: true } : {}),
    ...(content.aksHistorical ? { aksHistorical: true } : {}) }
}

const sourceHash = run => projectSourceHash(selectBuildFiles(run.project.savedFiles, CAPSTONE_MANIFEST))
const live = run => capstoneLive(run)
const group = run => !!live(run).group && !!live(run).registry
const image = run => !!live(run).build && live(run).build.sourceHash === sourceHash(run)
  && live(run).build.image?.loginServer === CAPSTONE_IMAGE.split('/')[0]
  && live(run).build.image?.repository === 'assistant' && live(run).build.image?.tag === 'capstone-v1'
  && live(run).build.appSpec?.version === '1.0'
const connected = run => live(run).clusterReady && !!live(run).grant && live(run).context?.clusterId === CAPSTONE_CLUSTER_ID
const configured = run => !!live(run).namespace && !!live(run).config && !!live(run).secret
  && live(run).config.data?.APP_ENV === 'training' && !!live(run).secret.data?.PGPASSWORD
const deployed = run => configured(run) && connected(run) && live(run).sourceBuilt && live(run).currentPods
const routed = run => deployed(run) && live(run).routed
const sourceVersions = { 'capstone-source': run => Object.fromEntries(CAPSTONE_MANIFEST.buildFiles.map(path => [path, run.project.fileVersions[path] ?? 0])) }
const published = { 'capstone-published': run => ({ image: CAPSTONE_IMAGE,
  buildId: run.artifacts.publishedTags[CAPSTONE_IMAGE] ?? null,
  sourceHash: run.artifacts.buildsById[run.artifacts.publishedTags[CAPSTONE_IMAGE]]?.sourceHash ?? null }) }
const infrastructure = { 'capstone-infra': run => ({ groupId: live(run).group?.id ?? null,
  registryId: live(run).registry?.id ?? null, clusterId: live(run).cluster?.id ?? null,
  grant: !!live(run).grant, context: run.runtime.kubernetes.currentContext }) }
const deployment = { 'capstone-deployment': run => ({ uid: live(run).deployment?.metadata?.uid ?? null,
  image: live(run).image ?? null, podUids: live(run).pods.map(pod => pod.metadata.uid).sort(),
  configUid: live(run).config?.metadata?.uid ?? null, secretUid: live(run).secret?.metadata?.uid ?? null,
  internalUid: live(run).internal?.metadata?.uid ?? null, externalUid: live(run).external?.metadata?.uid ?? null }) }
const sourceFiles = ['app.py', 'retrieval.sql', 'Dockerfile', 'training_workload.py'].map(path => file(path))
const yamlFiles = ['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml']
const applyFiles = paths => paths.map(path => command(`kubectl apply -f ${path}`))

const authored = {
  'source-contract': {
    text: 'Complete and save the Python assistant, retrieval SQL, health checks, structured request logs and bounded work route. Verify the fixture-backed source preview.',
    check: run => CAPSTONE_MANIFEST.buildFiles.every(path => typeof run.project.savedFiles[path] === 'string'), dependencies: sourceVersions,
    hints: ['Start with input validation, published-row SQL and the three operation sequence.', 'Read the preview diagnostics for readiness, retry and logging gaps.'],
    solution: solution(...sourceFiles, verify('source-contract')),
    examNote: 'Source preview proves code behavior against supplied fixtures; it creates no image or running service.',
  },
  'registry-created': {
    text: 'Create the owned resource group and Basic Azure Container Registry for the assistant image.', check: group,
    dependencies: { 'capstone-group-registry': run => ({ group: live(run).group?.id ?? null, registry: live(run).registry?.id ?? null }) }, aksSourceIndependent: true,
    hints: ['Create rg-aks-capstone in West Europe.', 'Create acrakscapstone in that group with Basic SKU.'],
    solution: solution(command('az group create -n rg-aks-capstone -l westeurope'), command('az acr create -g rg-aks-capstone -n acrakscapstone --sku Basic'), verify('registry-created')),
    examNote: 'A registry resource alone does not publish an image or create a workload.',
  },
  'image-v1': {
    text: 'Build assistant:capstone-v1 in the registry from the saved v1 application and SQL.', check: image,
    dependencies: { ...sourceVersions, ...published },
    hints: ['Save the source before building; ACR captures saved files.', 'Use the capstone-v1 tag in acrakscapstone.'],
    solution: solution(command('az acr build --registry acrakscapstone --image assistant:capstone-v1 .'), verify('image-v1')),
    examNote: 'A published tag is a build artifact; it is not evidence of a running Pod.',
  },
  'cluster-connected': {
    text: 'Create the two-node managed identity AKS cluster, attach registry pull access and select its Kubernetes context.', check: connected,
    dependencies: infrastructure, aksSourceIndependent: true,
    hints: ['Create aks-capstone with two Standard_D2s_v5 nodes.', 'Attach acrakscapstone to the kubelet identity and get credentials for the correct cluster.'],
    solution: solution(command('az aks create -g rg-aks-capstone -n aks-capstone --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys'),
      command('az aks update -g rg-aks-capstone -n aks-capstone --attach-acr acrakscapstone'), command('az aks get-credentials -g rg-aks-capstone -n aks-capstone'), verify('cluster-connected')),
    examNote: 'Kubernetes context and ACR pull authorization are separate requirements.',
  },
  'config-applied': {
    text: 'Save and apply Namespace assistant; ConfigMap assistant-config with APP_ENV=training, AI_ENDPOINT=https://ai-training.example, ANSWER_DEPLOYMENT=answers-v1, EMBEDDING_DEPLOYMENT=embeddings-v1, PGHOST=pg-training.example, PGDATABASE=knowledge, PGUSER=assistant_training, COLLECTION=training and AUDIENCE=employee; Secret assistant-credentials with PGPASSWORD=training-only-password. AI and PostgreSQL are external prerequisites.', check: configured,
    dependencies: { ...sourceVersions, ...infrastructure, 'capstone-config': run => ({ config: live(run).config?.data ?? null,
      secretUid: live(run).secret?.metadata?.uid ?? null }) },
    hints: ['Use the assistant namespace for both resources.', 'Keep the external PostgreSQL and AI fixture references in the supplied configuration.'],
    solution: solution(...yamlFiles.slice(0, 3).map(path => file(path)), ...applyFiles(yamlFiles.slice(0, 3)), verify('config-applied')),
    examNote: 'A manifest on disk does not configure Pods until it is applied and consumed.',
  },
  'deployment-ready': {
    text: 'Apply Deployment assistant-api in namespace assistant with image acrakscapstone.azurecr.io/assistant:capstone-v1, imagePullPolicy Always, two ready replicas, named http port 8080, ConfigMap/Secret key refs, startup /health/startup, readiness /health/ready and liveness /health/live. Set requests CPU 250m and memory 128Mi; limits CPU 500m and memory 256Mi. Use RollingUpdate maxSurge=1, maxUnavailable=0, minReadySeconds=5, progressDeadlineSeconds=60 and revisionHistoryLimit=3.', check: deployed,
    dependencies: { ...sourceVersions, ...published, ...deployment },
    hints: ['Use assistant-api with image assistant:capstone-v1 and two replicas.', 'Advance simulation time after applying so startup and readiness can settle.'],
    solution: solution(file('k8s/deployment.yaml'), command('kubectl apply -f k8s/deployment.yaml'),
      { kind: 'scenario', action: { type: 'aks-advance', seconds: 30 } }, verify('deployment-ready')),
    examNote: 'Check every desired Pod and its captured image and configuration, not just the Deployment object.',
  },
  'routing-ready': {
    text: 'Apply ClusterIP and LoadBalancer Services with port 80 to named port http; prove both entry points select ready Pods.', check: routed,
    dependencies: { ...sourceVersions, ...deployment },
    hints: ['The internal name is assistant-internal; the external name is assistant-external.', 'Both Services select app: assistant and target the named http port.'],
    solution: solution(...yamlFiles.slice(4).map(path => file(path)), ...applyFiles(yamlFiles.slice(4)), verify('routing-ready')),
    examNote: 'A ready Pod cannot serve through a Service with the wrong selector or target port.',
  },
}

const questions = {
  'answer-backups': ['How long are backups kept?', { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } }, 'Prove a 30-day backup answer from the training-backups row.'],
  'answer-support': ['Who provides support?', { status: 200, body: { answer: 'Contact the training desk for support.', sources: ['training-support'], environment: 'training' } }, 'Prove the support answer from the training-support row.'],
  'invalid-input': ['   ', { status: 400, body: { error: 'Question is required.' } }, 'Prove blank input returns 400 without dependency calls.'],
  'no-match': ['What is the travel allowance?', { status: 200, body: { answer: 'No matching documents.', sources: [], environment: 'training' } }, 'Prove no-match skips the answer dependency.'],
}
for (const [id, [, , text]] of Object.entries(questions)) authored[id] = {
  text, check: routed, dependencies: { ...sourceVersions, ...published, ...deployment },
  hints: ['Run the named Verify request against the running service.', 'Inspect the request trace, retrieved IDs and correlated logs.'],
  solution: solution(verify(id)),
  examNote: 'The request must traverse the deployed image and current service route; source preview cannot satisfy this check.',
}

const tasks = stages.flatMap(stage => stage.taskIds.map(id => capstoneTask(id, authored[id] ?? {
  text: `Complete the ${id} measured capstone milestone when this stage is available.`, check: () => false,
  hints: ['This stage requires its own measured simulator evidence.', 'Inspect the active experiment and saved deployment before verifying.'],
  solution: solution(verify(id)), examNote: 'This later milestone is unavailable until its measured scenario is implemented.',
})))
const scenarios = Object.fromEntries(tasks.map(task => [task.verification.scenarioId, { kind: 'aks-capstone-pending', version: 1 }]))
for (const id of stages.slice(0, 3).flatMap(stage => stage.taskIds)) scenarios[`capstone-${id}`] = { kind: 'aks-capstone-check', version: 1 }
for (const [id, [question, expected]] of Object.entries(questions)) scenarios[`capstone-${id}`] = {
  kind: 'aks-request', version: 1, target: CAPSTONE_EXTERNAL,
  request: { method: 'POST', path: '/api/ask', body: { question } }, expected,
  integrationProfile: 'healthy',
  connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 },
}

export const aksCapstoneLab = {
  id: 'aks-knowledge-assistant-capstone', title: 'Build and operate a knowledge assistant on AKS', status: 'unavailable',
  skillAreaId: 'containers', service: 'aks', minutes: 120,
  brief: 'Build a Python assistant, publish it to ACR, deploy it on AKS, verify behavior, then measure resilience and releases before cleanup.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 25, labMode: 'capstone',
  manifestId: CAPSTONE_MANIFEST.id, initialProjectFiles: CAPSTONE_FILES,
  healthFixture: { initializationSeconds: 6 },
  capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true,
    kubernetesRollouts: true, kubernetesDiagnostics: true, aksCapstone: true, acrBuild: true },
  stages, tasks, scenarios,
  aksCapstone: { stageExit(run, stage) {
    if (stage.id === 'provision' && (!image(run) || !connected(run)))
      return [{ code: 'AKS_CAPSTONE_PROVISION_DRIFT', message: 'Current image publication and cluster access must be valid.' }]
    if (['deploy', 'behavior'].includes(stage.id) && !routed(run))
      return [{ code: 'AKS_CAPSTONE_DEPLOYMENT_DRIFT', message: 'Restore the current running image, configuration and Services.' }]
    return []
  } },
}

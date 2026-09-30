import { CAPSTONE_FILES, CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../../templates/aks-python/capstone.js'
import { CAPSTONE_CLUSTER_ID, CAPSTONE_TARGET, CAPSTONE_EXTERNAL, CAPSTONE_IMAGE,
  capstoneLive, capstoneCommand as command, capstoneFile as file, capstoneVerify as verify,
  capstoneSolution as solution, capstoneAdvance as advance } from './capstone-helpers.js'
import { projectSourceHash, selectBuildFiles } from '../../../lib/project/build.js'
import { HEALTH_FIXTURES } from '../../fixtures/aks/health.js'
import { CAPSTONE_HPA_DISABLED, measuredMilestone, milestoneDependencies, releaseBaselineReady } from '../../../lib/kubernetes/capstone/resilience.js'
import { CAPSTONE_INCIDENT_FILES, CAPSTONE_INCIDENT_ID, CAPSTONE_RELEASE_REQUIREMENTS, CAPSTONE_V2_IMAGE,
  publishedAksCapstoneV2, stableAksCapstoneV2, stableAksCapstoneV2Dependencies, capstoneReleaseProof, capstoneReleaseDependencies,
  capstoneIncidentIdentity, validateCapstoneReleaseStart, validateCapstoneReleaseFinish, validateAksCapstoneDiagnosis } from '../../../lib/kubernetes/capstone/incident.js'
import { aksFinalReady, aksFinalDependencyHash, aksCleanupEligibility, validateAksCleanupCheckpoint,
  inspectAksCleanup, aksCleanupReady, aksCleanupDependencies, aksCleanupAppDependencies,
  aksCleanupAppInventoryClear, aksCleanupInventoryClear } from '../../../lib/kubernetes/capstone/cleanup.js'

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

const start = (type, id) => ({ kind: 'scenario', action: { type, scenarioId: `capstone-${id}` } })
const probeSpecs = [
  ['startup-proof', 'coldStartup', 30, 'Measure fresh containers starting at age zero: startup may succeed only after 6 seconds; readiness and liveness stay gated, with no cold-start restart.'],
  ['readiness-proof', 'temporaryAdmissionClosure', 60, 'Close one Pod admission at baseline +5s, clear at +20s, and measure withdrawal within 4s and recovery within 5s without restarting. Sample at +9s and +25s; finish at +30s.'],
  ['liveness-proof', 'processHang', 130, 'Hang one process at baseline +5s. Measure withdrawal within 4s, termination within 30s and same-Pod/new-container recovery within 90s; prove a healthy answer at +100s.'],
]
for (const [id, , seconds, text] of probeSpecs) authored[id] = {
  text, check: run => !!measuredMilestone(run, id), dependencies: milestoneDependencies(id), aksHistorical: true,
  hints: ['Begin with two settled v1 Pods and no HPA. Starting the experiment recreates this exact pair under the same template.', 'Advance the shared simulation clock, inspect measured probe timing, then run the named Verify.'],
  solution: solution(start('aks-probe-start', id), advance(seconds), verify(id)),
  examNote: 'Startup gates other probes; readiness removes a backend, while liveness restarts the container inside the same Pod.',
}
const measured = (id, text, steps, hints, examNote) => ({ text, check: run => !!measuredMilestone(run, id),
  dependencies: milestoneDependencies(id), aksHistorical: true, hints, solution: solution(...steps, verify(id)), examNote })
authored['manual-capacity'] = measured('manual-capacity',
  'Save and apply three fixed replicas without an HPA; measure the 30-second local-work profile at 10 requests/second using the 20-unit, 96Mi scratch workload.',
  [{ kind: 'file', path: 'k8s/deployment.yaml', content: CAPSTONE_SOLUTION_FILES.v1['k8s/deployment.yaml'].replace('  replicas: 2\n', '  replicas: 3\n') },
    command('kubectl apply -f k8s/deployment.yaml'), advance(30), start('aks-resource-start', 'manual-capacity'), advance(60)],
  ['Both saved and live Deployment must say replicas: 3.', 'Three Pods alone are not workload evidence: start the profile, advance time and verify its completed work.'],
  'Manual scaling changes desired capacity; measured throughput and scheduling show whether that capacity can serve work.')
authored['hpa-cycle'] = measured('hpa-cycle',
  'Omit replicas from the saved Deployment and apply it before adopting assistant-cpu: target assistant-api, min 2/max 4, CPU utilization 60%, scale-down stabilization 60s. Measure 2 requests/s for 30s, 28 requests/s until 120s, then zero until 270s; observe genuine HPA 2→4→2 decisions and conserved work.',
  [file('k8s/deployment.yaml', 'scale'), command('kubectl apply -f k8s/deployment.yaml'), advance(30),
    file('k8s/hpa.yaml', 'scale'), command('kubectl apply -f k8s/hpa.yaml'), advance(30),
    start('aks-resource-start', 'hpa-cycle'), advance(300)],
  ['Remove explicit replicas ownership before applying the exact HPA policy shown in the Solution.', 'Warmup is bounded to 360s; use complete CPU windows and wait through the zero-load scale-in phase.'],
  'CPU utilization is relative to CPU requests. Stabilization prevents immediate scale-in; manually setting four replicas is not an HPA decision.')
authored['ai-wait'] = measured('ai-wait',
  'After the measured CPU cycle returns to two, run 28 answer requests/second for 60s: 1ms local CPU/request and 150ms answer latency. Prove dependency waiting does not cause CPU scale-out.',
  [start('aks-resource-start', 'ai-wait'), advance(90)],
  ['Keep the HPA at its minimum of two before starting.', 'Observe answer latency separately from local CPU work and verify no scale-out decision occurred.'],
  'Waiting on a remote AI service is not local CPU consumption; CPU HPA cannot directly measure dependency latency.')
authored['release-baseline'] = {
  text: 'Finish all experiments, explicitly delete assistant-cpu, save/apply replicas: 2, and replace saved hpa.yaml with “# HPA exercise complete; final deployment uses two fixed replicas.” Verify two Available current Pods with all six nonempty manifests aligned.',
  check: releaseBaselineReady, dependencies: { ...sourceVersions, ...deployment, 'capstone-release-baseline': releaseBaselineReady },
  hints: ['A comment-only manifest does not delete a live HPA: use kubectl delete hpa assistant-cpu -n assistant.', 'Restore explicit replicas: 2 and wait for two Available Pods; retain the six historical measurements.'],
  solution: solution(command('kubectl delete hpa assistant-cpu -n assistant'), file('k8s/deployment.yaml'),
    command('kubectl apply -f k8s/deployment.yaml'), { kind: 'file', path: 'k8s/hpa.yaml', content: CAPSTONE_HPA_DISABLED }, advance(30), verify('release-baseline')),
  examNote: 'Release rollouts use fixed replicas in this trainer. Removing the saved HPA definition and deleting its live controller are distinct operations.',
}

const releaseControl = (type, id) => ({ kind: 'scenario', action: { type, scenarioId: `capstone-${id}` } })
const incidentControl = { kind: 'scenario', action: { type: 'aks-capstone-incident' } }
const badReadiness = CAPSTONE_SOLUTION_FILES.v2['k8s/deployment.yaml'].replace('path: /health/ready', 'path: /health/missing')
const incidentPaths = ['k8s/service-internal.yaml', 'k8s/service-external.yaml', 'k8s/configmap.yaml']
const currentTask = (run, id) => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]
const incidentHistory = { 'capstone-incident': capstoneIncidentIdentity }
authored['published-v2'] = {
  text: 'Set SERVICE_VERSION to 2.0, include release from that binding in successful answers, and publish assistant:capstone-v2 from saved source.',
  check: publishedAksCapstoneV2, aksHistorical: true, dependencies: { ...sourceVersions, 'capstone-v2-artifact': run => run.artifacts.publishedTags[CAPSTONE_V2_IMAGE] ?? null },
  hints: ['Keep the complete AI, SQL, health, logging and work behavior while updating the successful answer formatter.', 'Save app.py and build a distinct capstone-v2 tag; publishing alone does not update Pods.'],
  solution: solution(file('app.py', 'v2'), command('az acr build --registry acrakscapstone --image assistant:capstone-v2 .'), verify('published-v2')),
  examNote: 'An image publication proves a source snapshot, not rollout completion or service availability.',
}
authored['release-v2'] = {
  text: 'Start the release observation while v1 is healthy; save/apply the v2 Deployment and observe every desired Pod Available on v2 with zero failed observed requests and at least two Available Pods throughout.',
  check: run => !!capstoneReleaseProof(run, 'release-v2'), aksHistorical: true, dependencies: capstoneReleaseDependencies('release-v2'),
  hints: ['Start the measurement before applying the changed image.', 'Advance through the rollout and ten stable terminal seconds, then finish the measurement and Verify.'],
  solution: solution(releaseControl('aks-release-start', 'release-v2'), file('k8s/deployment.yaml', 'v2'),
    command('kubectl apply -f k8s/deployment.yaml'), advance(90), releaseControl('aks-release-finish', 'release-v2'), verify('release-v2')),
  examNote: 'This bounded observation proves its sampled requests and availability window; it makes no production continuity guarantee.',
}
authored['rollback-recovered'] = {
  text: 'Start recovery observation, save/apply readiness /health/missing, observe the stalled revision and ProgressDeadlineExceeded, then undo to the retained healthy v2 revision or forward-fix. Align saved YAML with recovered v2.',
  check: run => !!capstoneReleaseProof(run, 'rollback-recovered'), aksHistorical: true, dependencies: capstoneReleaseDependencies('rollback-recovered'),
  hints: ['A successful request from an old Pod does not prove the new revision is healthy; inspect rollout history and the failed readiness probe.', 'Undo restores the Pod template, not saved files or separate ConfigMaps/Secrets. Save the healthy v2 manifest and apply it.'],
  solution: solution(releaseControl('aks-release-start', 'rollback-recovered'), { kind: 'file', path: 'k8s/deployment.yaml', content: badReadiness },
    command('kubectl apply -f k8s/deployment.yaml'), advance(75), command('kubectl rollout history deployment/assistant-api -n assistant'),
    command('kubectl rollout undo deployment/assistant-api -n assistant'), file('k8s/deployment.yaml', 'v2'), command('kubectl apply -f k8s/deployment.yaml'),
    advance(90), releaseControl('aks-release-finish', 'rollback-recovered'), verify('rollback-recovered')),
  examNote: 'Rollback needs an actual failed-revision receipt and completed recovery. Old-Pod success and an unaligned saved manifest are insufficient.',
}
authored['fault-route'] = {
  text: 'Start the declared dual-fault incident. Wait for both faulty-config Pods, then observe the external Service and preserve CONNECTION_REFUSED with null HTTP status and no application or dependency work.',
  check: run => Object.values(run.evidence.experimentsById).some(record => record.taskId === 'fault-route' && record.outcome === 'passed' && record.measurements.diagnosisCapture),
  aksHistorical: true, dependencies: incidentHistory,
  hints: ['Start incident visibly saves/applies targetPort 8081 in both Services and ai-missing.example in the ConfigMap, then restarts Pods.', 'Ready Pods do not imply the Service target port has a listener. Observe before repairing either cause.'],
  solution: solution(incidentControl, advance(90), verify('fault-route')),
  examNote: 'A refused connection occurs before Python; no handler or dependency logs can be attributed to that request.',
}
authored['fault-dependency'] = {
  text: 'Repair both saved Service targetPorts and expose 502 AI_ENDPOINT at embedding. Preserve the second cause; when both causes were repaired together, inspect the explicitly historical isolated-snapshot result.',
  check: run => { const record = currentTask(run, 'fault-dependency'); return record?.outcome === 'passed' && record.measurements.provenanceValid === true
    && record.measurements.status === 502 && record.measurements.body?.code === 'AI_ENDPOINT' },
  aksHistorical: true, dependencies: incidentHistory,
  hints: ['Restore targetPort http in both Services and apply both files while Pods still have the unavailable endpoint.', 'The isolated snapshot changes only the old Service port and is labeled historical; it never proves live recovery.'],
  solution: solution(...incidentPaths.slice(0, 2).flatMap(path => [file(path, 'v2'), command(`kubectl apply -f ${path}`)]), verify('fault-dependency')),
  examNote: 'Transport failure can mask a dependency failure. Applying a ConfigMap does not update captured environment variables.',
}
authored['incident-recovered'] = {
  text: 'Restore the saved AI endpoint, apply configuration and restart. Prove two current v2 Pods, both repaired Services, fresh environments and the complete embedding, PostgreSQL and answer flow.',
  check: run => stableAksCapstoneV2(run, aksCapstoneLab), dependencies: { 'capstone-current-v2': stableAksCapstoneV2Dependencies, ...incidentHistory },
  hints: ['Save/apply https://ai-training.example, then restart assistant-api and wait for every desired Pod.', 'Keep both historical observations. Verify recovery on the current source, image, manifests and captured environment.'],
  solution: solution(file('k8s/configmap.yaml', 'v2'), command('kubectl apply -f k8s/configmap.yaml'),
    command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(90), verify('incident-recovered')),
  examNote: 'A healthy live request must agree with repeatable saved configuration. Historical isolated results cannot satisfy recovery.',
}

const finalCases = {
  'final-internal': ['How long are backups kept?', { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '2.0' } }, 'internal backup answer and DNS'],
  'final-external': ['Who provides support?', { status: 200, body: { answer: 'Contact the training desk for support.', sources: ['training-support'], environment: 'training', release: '2.0' } }, 'external support answer'],
  'final-invalid': ['   ', { status: 400, body: { error: 'Question is required.' } }, 'blank input with no dependency calls'],
  'final-no-match': ['What is the travel allowance?', { status: 200, body: { answer: 'No matching documents.', sources: [], environment: 'training' } }, 'empty retrieval without an answer call'],
  'final-timeout': ['How long are backups kept?', { status: 504, body: { error: 'A dependency timed out after retries.', code: 'DEPENDENCY_TIMEOUT' } }, 'bounded persistent embedding timeout'],
}
for (const [id, [, , description]] of Object.entries(finalCases)) authored[id] = {
  text: `Verify the current v2 ${description} after applying all six final manifests and restarting every desired Pod.`,
  check: run => aksFinalReady(run, aksCapstoneLab), dependencies: { 'capstone-final-current': aksFinalDependencyHash },
  hints: ['Keep two fixed healthy replicas, no HPA and no active experiment; save all project edits.',
    id === 'final-timeout' ? 'The request-local timeout profile must return 504 after three embedding attempts, with no query or answer.' : 'Reapply all six final manifests, restart assistant-api, wait for complete rollout and refresh all five final Verify cases.'],
  solution: solution(...(id === 'final-internal' ? [...yamlFiles.map(path => command(`kubectl apply -f ${path}`)),
    command('kubectl rollout restart deployment/assistant-api -n assistant'), advance(90)] : []), verify(id)),
  examNote: 'Final requests observe current saved source, artifact, Services and restarted Pods. A later edit or restart requires fresh proof.',
}
authored['cleanup-app'] = {
  text: 'Freeze the five current final proofs, then delete the owned assistant namespace and its application resources.',
  check: aksCleanupAppInventoryClear, dependencies: { 'capstone-cleanup-app': aksCleanupAppDependencies },
  hints: ['Freeze final proof only after all five final Verify cases currently pass.', 'Delete namespace assistant; the ordinary cascade removes its Pods, controllers, HPA and per-Pod timers.'],
  solution: solution({ kind: 'scenario', action: { type: 'aks-freeze-cleanup' } }, command('kubectl delete namespace assistant'), verify('cleanup-app')),
  examNote: 'Freeze preserves the demonstrated service before intentional deletion. After freezing, source and workload changes are disabled.',
}
authored['cleanup-cloud'] = {
  text: 'Delete every attempt-owned AKS, ACR and resource group, preserving the supplied prerequisites; verify cleanup and seal the final checkpoint.',
  check: aksCleanupInventoryClear, dependencies: { 'capstone-cleanup': aksCleanupDependencies },
  hints: ['Delete aks-capstone, acrakscapstone and rg-aks-capstone with the supported commands.', 'Safe group deletion is an equivalent cascade. Retry remaining exact owned resources after any partial failure.'],
  solution: solution(command('az aks delete -g rg-aks-capstone -n aks-capstone --yes'), command('az acr delete -n acrakscapstone --yes'),
    command('az group delete -n rg-aks-capstone --yes'), verify('cleanup-app'), verify('cleanup-cloud')),
  examNote: 'Historical build/source/evidence records remain after cleanup; live registry publications, contexts, identities and node resources must be gone.',
}

const tasks = stages.flatMap(stage => stage.taskIds.map(id => capstoneTask(id, authored[id] ?? {
  text: `Complete the ${id} measured capstone milestone when this stage is available.`, check: () => false,
  hints: ['This stage requires its own measured simulator evidence.', 'Inspect the active experiment and saved deployment before verifying.'],
  solution: solution(verify(id)), examNote: 'This later milestone is unavailable until its measured scenario is implemented.',
})))
const scenarios = Object.fromEntries(tasks.map(task => [task.verification.scenarioId, { kind: 'aks-capstone-pending', version: 1 }]))
for (const [id, [question, expected]] of Object.entries(finalCases)) scenarios[`capstone-${id}`] = {
  kind: 'aks-request', version: 1, target: id === 'final-internal' ? CAPSTONE_TARGET : CAPSTONE_EXTERNAL,
  request: { method: 'POST', path: '/api/ask', body: { question } }, expected, requireTwoReplicas: true,
  integrationProfile: id === 'final-timeout' ? 'embedding-timeout-always' : 'healthy',
  connectivity: id === 'final-internal'
    ? { origin: { kind: 'service', clusterId: CAPSTONE_CLUSTER_ID, namespace: 'assistant', serviceName: 'assistant-internal' }, hostname: 'assistant-internal.assistant.svc.cluster.local', port: 80 }
    : { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 },
}
for (const id of ['cleanup-app', 'cleanup-cloud']) scenarios[`capstone-${id}`] = { kind: 'aks-capstone-cleanup', version: 1 }
for (const [id, script] of probeSpecs) scenarios[`capstone-${id}`] = { kind: 'aks-probe', version: 1,
  target: { ...CAPSTONE_TARGET, externalServiceName: 'assistant-external' }, durationSeconds: 150,
  script: script === 'coldStartup' ? { initializationSeconds: 6 } : { ...HEALTH_FIXTURES.scenarios[script] } }
for (const [id, profileId, requiredReadyReplicas] of [['manual-capacity', 'manual-work', 3], ['hpa-cycle', 'guided-cycle', 2], ['ai-wait', 'ai-wait', 2]])
  scenarios[`capstone-${id}`] = { kind: 'aks-resource-profile', version: 1, profileId, requiredReadyReplicas,
    target: { clusterId: CAPSTONE_CLUSTER_ID, namespace: 'assistant', deploymentName: 'assistant-api' } }
scenarios['capstone-release-baseline'] = { kind: 'aks-capstone-check', version: 1 }
for (const id of stages.slice(0, 3).flatMap(stage => stage.taskIds)) scenarios[`capstone-${id}`] = { kind: 'aks-capstone-check', version: 1 }
for (const [id, [question, expected]] of Object.entries(questions)) scenarios[`capstone-${id}`] = {
  kind: 'aks-request', version: 1, target: CAPSTONE_EXTERNAL,
  request: { method: 'POST', path: '/api/ask', body: { question } }, expected,
  integrationProfile: 'healthy',
  connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 },
}
scenarios['capstone-published-v2'] = { kind: 'aks-capstone-check', version: 1 }
for (const id of ['release-v2', 'rollback-recovered']) scenarios[`capstone-${id}`] = { kind: 'aks-release', version: 1, target: CAPSTONE_EXTERNAL,
  expectedRelease: '2.0', requiredAvailable: 2, zeroFailedRequests: true, requireIncident: id === 'rollback-recovered', requireDeadline: id === 'rollback-recovered', incidentEpoch: id === 'release-v2' ? 0 : 1 }
const diagnosticRequest = (expected, extra = {}) => ({ kind: 'aks-request', version: 1, target: CAPSTONE_EXTERNAL,
  request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, expected,
  connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-external', namespace: 'assistant' }, port: 80 }, ...extra })
scenarios['capstone-fault-route'] = diagnosticRequest({ status: null, body: null, transport: { ok: false, reason: 'CONNECTION_REFUSED' }, route: { selectedCount: 2 } })
scenarios['capstone-fault-dependency'] = diagnosticRequest({ status: 502, body: { error: 'The configured AI endpoint is not available in this trainer.', code: 'AI_ENDPOINT' } }, { historicalProbeOf: 'capstone-fault-route' })
scenarios['capstone-incident-recovered'] = diagnosticRequest({ status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '2.0' } },
  { requireCompleteRollout: true, expectedCapturedConfig: { AI_ENDPOINT: 'https://ai-training.example' }, expectedCurrentConfig: { AI_ENDPOINT: 'https://ai-training.example' } })
scenarios[CAPSTONE_INCIDENT_ID] = { kind: 'aks-diagnosis', version: 1, target: CAPSTONE_EXTERNAL,
  investigationArea: 'Declared Service targetPort and captured AI endpoint faults',
  controlledProbe: { kind: 'isolated-port-repair', labId: 'aks-knowledge-assistant-capstone', phaseId: 'port-and-endpoint', servicePort: 'http' },
  phases: [{ id: 'port-and-endpoint', edits: incidentPaths.map(path => ({ path, before: CAPSTONE_INCIDENT_FILES[path],
    after: CAPSTONE_INCIDENT_FILES[path].replace(/targetPort: http/g, 'targetPort: 8081').replace('https://ai-training.example', 'https://ai-missing.example') })),
    commands: [...incidentPaths.map(path => `kubectl apply -f ${path}`), 'kubectl rollout restart deployment/assistant-api -n assistant'],
    observationScenarioId: 'capstone-fault-route', recoveryScenarioId: 'capstone-incident-recovered' }] }

export const aksCapstoneLab = {
  id: 'aks-knowledge-assistant-capstone', title: 'Build and operate a knowledge assistant on AKS', status: 'available',
  skillAreaId: 'containers', service: 'aks', minutes: 120,
  brief: 'Build a Python assistant, publish it to ACR, deploy it on AKS, verify behavior, then measure resilience and releases before cleanup.',
  engineVersion: 2, contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 25, labMode: 'capstone',
  manifestId: CAPSTONE_MANIFEST.id, initialProjectFiles: CAPSTONE_FILES,
  healthFixture: { initializationSeconds: 6, maximumWarmupSeconds: 60 },
  capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesConnectivity: true,
    kubernetesAiIntegration: true, kubernetesProbes: true, kubernetesResources: true,
    kubernetesRollouts: true, kubernetesDiagnostics: true, aksCapstone: true, acrBuild: true },
  stages, tasks, scenarios, releaseRequirements: CAPSTONE_RELEASE_REQUIREMENTS,
  aksCapstone: { incidentFiles: CAPSTONE_INCIDENT_FILES,
    cleanupEligibility: run => aksCleanupEligibility(run, aksCapstoneLab),
    validateCleanupCheckpoint: validateAksCleanupCheckpoint,
    cleanupReady: run => aksCleanupReady(run, aksCapstoneLab),
    inspectCleanup: run => inspectAksCleanup(run, aksCapstoneLab),
    validateReleaseStart: (run, scenarioId) => validateCapstoneReleaseStart(run, aksCapstoneLab, scenarioId),
    validateReleaseFinish: (run, experiment) => validateCapstoneReleaseFinish(run, aksCapstoneLab, experiment),
    validatePinnedDiagnosisEvidence: (record, proof, run) => validateAksCapstoneDiagnosis(record, proof, run, aksCapstoneLab),
    stageExit(run, stage) {
    if (['release', 'incident'].includes(stage.id) && !stableAksCapstoneV2(run, aksCapstoneLab))
      return [{ code: 'AKS_CAPSTONE_V2_DRIFT', message: 'Restore current stable v2 source, manifests, two fixed Pods and fresh configuration.' }]
    if (stage.id === 'resilience' && !releaseBaselineReady(run))
      return [{ code: 'AKS_CAPSTONE_RELEASE_BASELINE', message: 'Restore two Available fixed replicas, current manifests and no HPA before releases.' }]
    if (stage.id === 'provision' && (!image(run) || !connected(run)))
      return [{ code: 'AKS_CAPSTONE_PROVISION_DRIFT', message: 'Current image publication and cluster access must be valid.' }]
    if (['deploy', 'behavior'].includes(stage.id) && !routed(run))
      return [{ code: 'AKS_CAPSTONE_DEPLOYMENT_DRIFT', message: 'Restore the current running image, configuration and Services.' }]
    return []
  } },
}

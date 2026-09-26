import { canonicalize, recordVerification } from '../labEngine/evidence.js'
import { getDeploymentPods } from './reconcile.js'
import { kubeObjectKey } from './objects.js'
import { routeServiceRequest } from './connectivity.js'
import { sampleResourceMetrics } from './resource-usage.js'
import { parseKubernetesYaml } from './yaml.js'
import { getProjectManifest } from '../project/manifests.js'
import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { normalizeContainerResources } from './resource-schema.js'
import { RESOURCE_MANIFEST, RESOURCE_SOLUTION_FILES } from '../../data/templates/aks-python/resources.js'
import { projectSourceHash, selectBuildFiles } from '../project/build.js'

const clone = value => structuredClone(value)
const PROFILES = RESOURCE_FIXTURES.profiles
const workloadFor = profileId => profileId === 'independent-cycle' ? RESOURCE_FIXTURES.workload.independent : RESOURCE_FIXTURES.workload.guided
const RESOURCE_SOURCE_HASH = projectSourceHash(selectBuildFiles(RESOURCE_SOLUTION_FILES, RESOURCE_MANIFEST))

function invalid(message, code = 'INVALID_RESOURCE_EXPERIMENT') { return { code, message } }
function stateFor(run, clusterId) { return run.runtime.kubernetes.clusters?.[clusterId] }
function resourceRuntime(run, clusterId) { return stateFor(run, clusterId)?.resourcesRuntime }
function descendants(run, target) { return getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName) }
function container(state, pod) { return state.health?.containers?.[pod.metadata.uid] }
function ready(state, pod) { const c = container(state, pod); return pod.status?.phase === 'Running' && !pod.metadata.deletionTimestamp && c?.ready && c.terminatedAtMs === null && c.restartAtMs === null }

function liveHpa(state, namespace, deploymentName) {
  return Object.values(state.resources ?? {}).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.namespace === namespace
    && item.spec?.scaleTargetRef?.kind === 'Deployment' && item.spec.scaleTargetRef.name === deploymentName) ?? null
}

function savedDeployment(run, target) {
  for (const [path, text] of Object.entries(run.project.savedFiles)) {
    if (!/^k8s\/.*\.ya?ml$/i.test(path)) continue
    const doc = parseKubernetesYaml(text, path).documents.find(item => item?.kind === 'Deployment' && item.metadata?.name === target.deploymentName && item.metadata?.namespace === target.namespace)
    if (doc) return doc
  }
  return null
}

function suppliedResourceArtifact(run, state, deployment, target, requirePodSnapshots = false) {
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = image && run.artifacts.publishedTags?.[image]
  const artifact = artifactId && run.artifacts.buildsById?.[artifactId]
  const source = artifact && run.artifacts.sourceSnapshotsByHash?.[artifact.sourceHash]
  const registry = artifact && run.sandbox.containerRegistries.find(item => item.id === artifact.image?.registryId)
  const expected = RESOURCE_FIXTURES.workload
  const separator = image?.indexOf('/') ?? -1; const colon = image?.lastIndexOf(':') ?? -1
  const publishedImage = typeof artifactId === 'string' && artifact?.id === artifactId && separator > 0 && colon > separator
    && artifact.image?.loginServer === image.slice(0, separator).toLowerCase()
    && artifact.image?.repository === image.slice(separator + 1, colon).toLowerCase()
    && artifact.image?.tag === image.slice(colon + 1)
    && registry?.loginServer?.toLowerCase() === artifact.image.loginServer
  const sourceIsSupplied = artifact?.sourceHash === RESOURCE_SOURCE_HASH && source?.hash === artifact.sourceHash
    && source.files && projectSourceHash(source.files) === artifact.sourceHash
  const workloadIsSupplied = artifact?.appSpec?.workload?.operation === expected.operation
    && artifact.appSpec.workload.units === expected.guided.units && artifact.appSpec.workload.scratchMiB === expected.guided.scratchMiB
  const podsMatch = !requirePodSnapshots || descendants(run, target).every(pod => state.podSnapshots?.[pod.metadata.uid]?.artifactId === artifactId)
  return publishedImage && sourceIsSupplied && workloadIsSupplied && podsMatch ? { artifactId, artifact, source } : null
}

function adoptionReady(run, state, target) {
  const hpa = liveHpa(state, target.namespace, target.deploymentName)
  const key = `Deployment/${target.namespace}/${target.deploymentName}`
  const doc = savedDeployment(run, target)
  const omitted = doc && !Object.hasOwn(doc.spec ?? {}, 'replicas')
  return !!hpa && omitted && state.applyOwnership?.[key]?.replicas === false ? hpa : null
}

function fingerprint(run, state, target, clusterId, { historical = false, hpa = null } = {}) {
  const deployment = state.resources[kubeObjectKey('Deployment', target.namespace, target.deploymentName)]
  const template = clone(deployment?.spec?.template ?? null)
  const services = Object.values(state.resources).filter(item => item.kind === 'Service' && item.metadata.namespace === target.namespace)
    .map(item => ({ uid: item.metadata.uid, name: item.metadata.name, digest: digest(item.spec) })).sort((a, b) => a.name.localeCompare(b.name))
  const configuration = Object.values(state.resources).filter(item => ['ConfigMap', 'Secret'].includes(item.kind) && item.metadata.namespace === target.namespace)
    .map(item => ({ kind: item.kind, name: item.metadata.name, uid: item.metadata.uid, keys: Object.keys(item.data ?? {}).sort(), dataDigest: digest(item.data ?? {}) }))
    .sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`))
  const manifest = getProjectManifest(run.project.manifestId)
  const source = digest(Object.fromEntries((manifest.buildFiles ?? []).map(path => [path, run.project.savedFiles[path] ?? null])))
  const sourceVersions = Object.fromEntries((manifest.buildFiles ?? []).map(path => [path, run.project.fileVersions[path] ?? 0]))
  const targetSaved = Object.entries(run.project.savedFiles).flatMap(([path, text]) => {
    if (!/^k8s\/.*\.ya?ml$/i.test(path)) return []
    const parsed = parseKubernetesYaml(text, path)
    const docs = parsed.documents.flatMap(doc => {
      if (!doc || doc.metadata?.namespace !== target.namespace) return []
      if (doc.kind === 'Deployment' && doc.metadata.name === target.deploymentName) {
        const canonical = clone(doc); if (historical && canonical.spec) delete canonical.spec.replicas
        return [[doc.kind, canonical]]
      }
      if (doc.kind === 'HorizontalPodAutoscaler' && doc.spec?.scaleTargetRef?.name === target.deploymentName) return historical ? [] : [[doc.kind, doc]]
      if (doc.kind === 'Service' && services.some(item => item.name === doc.metadata.name) || ['ConfigMap', 'Secret'].includes(doc.kind)) return [[doc.kind, doc]]
      return []
    })
    return docs.length ? [[path, digest(docs.map(([kind, doc]) => [kind, doc]))]] : []
  })
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image
  const artifactId = image ? run.artifacts.publishedTags?.[image] ?? null : null
  const key = `Deployment/${target.namespace}/${target.deploymentName}`
  return { clusterId, target, deploymentUid: deployment?.metadata.uid ?? null, templateDigest: digest(template), services, configuration, source, sourceVersions, targetSaved,
    artifactId, fixtureVersion: 1, ...(historical ? {} : hpa ? { hpaUid: hpa.metadata.uid, hpaPolicyDigest: digest(hpa.spec),
      hpaPolicyGeneration: state.resourcesRuntime.hpa[hpa.metadata.uid]?.policyGeneration ?? 1 }
      : { savedDeploymentDigest: digest(savedDeployment(run, target)),
        replicasOwnership: state.applyOwnership?.[key]?.replicas ?? null, liveReplicas: deployment?.spec?.replicas ?? null }) }
}

function validScenario(lab, id) {
  const value = lab?.scenarios?.[id]; const target = value?.target
  const keys = ['kind', 'version', 'target', 'requiredReadyReplicas', 'profileId']
  return value?.kind === 'aks-resource-profile' && value.version === 1 && Object.keys(value).every(key => keys.includes(key))
    && Object.keys(value).length === keys.length && Object.hasOwn(PROFILES, value.profileId) && target && Object.keys(target).sort().join(',') === 'clusterId,deploymentName,namespace'
    && ['clusterId', 'deploymentName', 'namespace'].every(key => typeof target[key] === 'string' && target[key])
    && Number.isInteger(value.requiredReadyReplicas) && value.requiredReadyReplicas >= 1 && value.requiredReadyReplicas <= 6
}

export function resourceExperimentActive(run) {
  return Object.values(run.runtime.kubernetes.clusters ?? {}).some(state => ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase))
}

function digest(value) { let hash = 2166136261; for (const c of JSON.stringify(canonicalize(value))) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0).toString(16) }

export function startResourceExperiment(input, scenarioId, lab) {
  if (lab?.capabilities?.kubernetesResources !== true || !validScenario(lab, scenarioId))
    return { run: input, diagnostics: [invalid('Resource experiment starts accept only a declared immutable profile ID.')] }
  if (Object.values(input.runtime.kubernetes.clusters ?? {}).some(state => ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase) || state.health?.experiment?.status === 'active'))
    return { run: input, diagnostics: [invalid('A probe or resource experiment is already active.', 'RESOURCE_EXPERIMENT_ACTIVE')] }
  const scenario = lab.scenarios[scenarioId], profileId = scenario.profileId, profile = PROFILES[profileId]
  const original = stateFor(input, scenario.target.clusterId)
  const target = { namespace: scenario.target.namespace, deploymentName: scenario.target.deploymentName }
  const deployment = original?.resources?.[kubeObjectKey('Deployment', target.namespace, target.deploymentName)]
  const hpa = profile.requiresHpa
    ? profile.diagnosis === 'no-cpu' ? liveHpa(original ?? {}, target.namespace, target.deploymentName) : adoptionReady(input, original ?? {}, target)
    : null
  if (!original?.resourcesRuntime || !deployment || descendants(input, { ...target, clusterId: scenario.target.clusterId }).length === 0)
    return { run: input, diagnostics: [invalid('The declared resource profile target is unavailable.')] }
  const expectedIncidentPhase = profile.diagnosis === 'pending' ? 'scheduling' : profile.diagnosis === 'oom' ? 'memory' : profile.diagnosis === 'no-cpu' ? 'hpa' : null
  if (expectedIncidentPhase && input.labId === 'aks-resources-troubleshooting'
    && original.resourcesRuntime.incident?.phase !== expectedIncidentPhase)
    return { run: input, diagnostics: [invalid(`The ${profile.diagnosis} diagnosis is not active in the current incident phase.`, 'RESOURCE_INCIDENT_PHASE')] }
  if (profile.requiresHpa && !hpa) return { run: input, diagnostics: [invalid(profile.diagnosis === 'no-cpu'
    ? 'The missing-request diagnosis requires its declared live HPA.'
    : 'This profile requires a live HPA and an applied Deployment with replicas omitted.')] }
  if (profile.diagnosis === 'oom') {
    const pod = descendants(input, { ...target, clusterId: scenario.target.clusterId })[0]
    const resources = normalizeContainerResources(pod?.spec?.containers?.[0]?.resources ?? {}).effective
    if (!suppliedResourceArtifact(input, original, deployment, { ...target, clusterId: scenario.target.clusterId }, true)
      || resources.memoryRequestBytes !== 128 * 1024 * 1024 || resources.memoryLimitBytes !== 128 * 1024 * 1024)
      return { run: input, diagnostics: [invalid('The OOM diagnosis requires the supplied 20-unit workload with a 128Mi memory limit.')] }
  }
  if (profile.diagnosis === 'pending'
    && !suppliedResourceArtifact(input, original, deployment, { ...target, clusterId: scenario.target.clusterId }))
    return { run: input, diagnostics: [invalid('The Pending diagnosis requires the supplied immutable 20-unit workload artifact.')] }
  if (profile.diagnosis === 'no-cpu') {
    const rawResources = deployment.spec.template.spec.containers[0].resources ?? {}
    const effective = normalizeContainerResources(rawResources).effective
    const validPolicy = hpa?.spec?.minReplicas === 2 && hpa?.spec?.maxReplicas === 4
      && hpa?.spec?.metrics?.[0]?.resource?.target?.averageUtilization === 60
      && hpa?.spec?.behavior?.scaleDown?.stabilizationWindowSeconds === 60
    if (!suppliedResourceArtifact(input, original, deployment, { ...target, clusterId: scenario.target.clusterId }, true)
      || rawResources.requests?.cpu !== undefined || rawResources.limits?.cpu !== undefined || effective.cpuRequestM || effective.cpuLimitM || !validPolicy)
      return { run: input, diagnostics: [invalid('The undefined-utilization diagnosis requires no CPU request or limit and the declared HPA policy.')] }
  }
  const required = scenarioId.startsWith('test-') ? scenario.requiredReadyReplicas : profile.requiredReadyReplicas
  if (profileId === 'manual-work' && (deployment.spec.replicas !== 3 || liveHpa(original, target.namespace, target.deploymentName)
    || !savedDeploymentHasReplicas(input, target, 3)))
    return { run: input, diagnostics: [invalid('The manual profile requires three saved and live replicas with no HPA.')] }
  let run = clone(input); const state = stateFor(run, scenario.target.clusterId); const runtime = state.resourcesRuntime
  const fingerprintValue = fingerprint(run, state, target, scenario.target.clusterId, { hpa })
  runtime.experiment = { version: 1, profileId, scenarioId, clusterId: scenario.target.clusterId, target, phase: 'warming',
    startedAtMs: run.runtime.simTimeMs, warmupDeadlineMs: run.runtime.simTimeMs + 360_000, phaseZeroAtMs: null,
    requiredReadyReplicas: profile.requiresHpa ? hpa.spec.minReplicas : scenario.profileId.startsWith('test-') ? required : Math.max(required, profile.requiredReadyReplicas), atMs: run.runtime.simTimeMs, overflowBacklog: 0,
    totals: { arrivals: 0, completed: 0, remaining: 0, peakBacklog: 0 }, unsupported: null,
    fingerprint: fingerprintValue, historicalFingerprint: fingerprint(run, state, target, scenario.target.clusterId, { historical: true }),
    deploymentUid: deployment.metadata.uid, hpaUid: hpa?.metadata.uid ?? null, hpaPolicy: clone(hpa?.spec ?? null), baselineReplicas: null,
    routeSamples: [], observations: [], boundaryKeys: [], proof: null, cancellationReason: null, startSequence: run.nextSequence,
    scaleReceipts: [], pendingObserved: false, pendingProof: null, oomObserved: false, oomProof: null,
    hpaObservations: [], provenance: [], podSeenAt: {} }
  // A scheduling diagnosis observes the declared Pending state itself.  It is
  // deliberately not a weakened warmup for normal workload profiles.
  if (profileId === 'diagnostic-pending') {
    const pending = descendants(run, { ...target, clusterId: scenario.target.clusterId })
    const reason = pod => pod.status?.schedulingReason ?? pod.status?.conditions?.find(item => item.type === 'PodScheduled')?.message
    const valid = pending.length === 2 && pending.every(pod => pod.status?.phase === 'Pending' && !pod.spec?.nodeName
      && !runtime.assignments[pod.metadata.uid] && !state.health?.containers?.[pod.metadata.uid]
      && pod.status?.conditions?.some(item => item.type === 'PodScheduled' && item.status === 'False' && item.reason === 'Unschedulable')
      && reason(pod)?.includes('Insufficient cpu'))
    runtime.experiment.phase = 'complete'; runtime.experiment.phaseZeroAtMs = run.runtime.simTimeMs
    runtime.experiment.endedAtMs = run.runtime.simTimeMs; runtime.experiment.pendingObserved = valid
    runtime.experiment.pendingProof = valid ? { deploymentUid: deployment.metadata.uid, atMs: run.runtime.simTimeMs,
      podUids: pending.map(pod => pod.metadata.uid).sort(), reasons: pending.map(reason).sort() } : null
    runtime.experiment.outcome = valid ? 'passed' : 'failed'
    return { run: persistExperimentResult(run, scenario.target.clusterId, runtime.experiment, lab), diagnostics: [] }
  }
  run = sampleResourceMetrics(run, run.runtime.simTimeMs, lab)
  return { run, diagnostics: [] }
}

function savedDeploymentHasReplicas(run, target, expected) { return savedDeployment(run, target)?.spec?.replicas === expected }

function metricWindowReady(runtime, pod, state, atMs) {
  const c = container(state, pod)
  return (runtime.metrics[pod.metadata.uid] ?? []).some(sample => sample.containerId === c?.containerId && sample.windowEndMs <= atMs)
}

function maybeWarm(run, state, experiment, atMs) {
  if (experiment.phase !== 'warming') return
  const pods = descendants(run, { ...experiment.target, clusterId: experiment.clusterId }).filter(pod => ready(state, pod)
    && state.resourcesRuntime.assignments[pod.metadata.uid] && metricWindowReady(state.resourcesRuntime, pod, state, atMs))
  const deployment = state.resources[kubeObjectKey('Deployment', experiment.target.namespace, experiment.target.deploymentName)]
  const hpa = experiment.hpaUid && Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.uid === experiment.hpaUid)
  const expectedCount = hpa?.spec?.minReplicas ?? experiment.requiredReadyReplicas
  if (deployment?.spec?.replicas === expectedCount && pods.length === expectedCount) {
    experiment.phase = 'running'; experiment.phaseZeroAtMs = atMs; experiment.atMs = atMs
    experiment.baselineReplicas = deployment.spec.replicas
    experiment.baselinePodUids = pods.map(pod => pod.metadata.uid).sort()
    experiment.workloadSpec = run.artifacts.buildsById?.[state.podSnapshots?.[pods[0]?.metadata.uid]?.artifactId]?.appSpec?.workload ?? null
  } else if (atMs >= experiment.warmupDeadlineMs) {
    experiment.phase = 'complete'; experiment.unsupported = 'RESOURCE_WARMUP_TIMEOUT'; experiment.outcome = 'failed'
  }
}

function arrival(profile, seconds) { return profile.phases.find(([start, end]) => seconds >= start && seconds < end)?.[2] ?? 0 }
function currentBoundaryRecorded(experiment, offset, final) { return experiment.boundaryKeys.includes(`${final ? 'final' : 'phase'}:${offset}`) }
function profileBoundaryOffsets(profile) {
  const offsets = new Set([0])
  for (const [start, end] of profile.phases) {
    if (start >= 0 && start <= profile.durationSeconds) offsets.add(start)
    if (end >= 0 && end <= profile.durationSeconds) offsets.add(end)
  }
  return offsets
}

function captureBoundary(run, experiment, offset, final = false) {
  const key = `${final ? 'final' : 'phase'}:${offset}`
  if (experiment.boundaryKeys.includes(key)) return { run, evidence: experiment.routeSamples.find(item => item.boundaryKey === key) ?? null }
  const state = stateFor(run, experiment.clusterId); const service = Object.values(state.resources).find(item => item.kind === 'Service'
    && item.metadata.namespace === experiment.target.namespace && item.spec?.type === 'LoadBalancer' && item.spec?.selector?.app === 'assistant')
  const route = { origin: { kind: 'external', clusterId: experiment.clusterId }, hostname: service?.status?.loadBalancer?.ingress?.[0]?.ip ?? '',
    port: service?.spec.ports?.[0]?.port ?? 80 }
  const isAi = PROFILES[experiment.profileId].kind === 'ai-wait'
  const request = isAi ? { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } } : { method: 'GET', path: '/api/work' }
  const routed = routeServiceRequest(run, { ...route, ...request, integrationProfile: isAi ? 'answer-wait-150ms' : 'healthy' }, null)
  run = routed.run
  const evidence = { boundaryKey: key, atMs: run.runtime.simTimeMs, offsetSeconds: offset, request, requestId: routed.outcome.requestId,
    status: routed.outcome.status, body: routed.outcome.body, transport: routed.outcome.transport, route: routed.outcome.route,
    workload: routed.outcome.workload ?? null, dependencyTrace: routed.outcome.dependencyTrace ?? [],
    integrationTrace: routed.outcome.integrationTrace ?? null, final }
  const current = stateFor(run, experiment.clusterId).resourcesRuntime.experiment
  if (current) { current.boundaryKeys.push(key); current.routeSamples.push(evidence); current.routeSamples = current.routeSamples.slice(-12) }
  return { run, evidence }
}

function assess(experiment, profile) {
  const scales = experiment.scaleReceipts ?? []
  const base = experiment.baselineReplicas
  const hasMetricScaleOut = scales.some(item => item.cause === 'hpa' && item.from < item.to)
  const hasScaleIn = scales.some(item => item.cause === 'hpa' && item.from > item.to)
  const noPending = !experiment.pendingObserved
  const noOom = !experiment.oomObserved
  const routed = experiment.routeSamples.filter(item => item.final)
  const allRoutes = experiment.routeSamples ?? []
  const validRoute = routed.length > 0 && allRoutes.every(item => item.transport?.ok && item.status === 200 && item.route?.podUid
    && (profile.kind === 'ai-wait' ? item.request.path === '/api/ask' && item.integrationTrace?.profileId === 'answer-wait-150ms'
      && item.body?.answer === 'Training backups are kept for 30 days.'
      : item.request.path === '/api/work' && item.workload?.operation === 'process_batch'
        && item.workload.units === experiment.workloadSpec?.units && item.workload.checksum === workloadFor(experiment.profileId).checksum))
  if (profile.diagnosis === 'oom') return experiment.oomObserved && experiment.oomProof?.podUid && experiment.phase === 'complete' ? 'passed' : 'failed'
  if (profile.diagnosis === 'no-cpu') {
    const syncs = experiment.hpaObservations ?? []
    const validSyncs = syncs.filter(item => item.reason === 'FailedGetResourceMetric' && item.scalingActive === false
      && item.samplePodUids.length >= 2 && item.missingRequestPodUids.length >= 2)
    return validSyncs.length >= 2 && experiment.phase === 'complete' ? 'passed' : 'failed'
  }
  const success = experiment.phase === 'complete' && experiment.unsupported === null && experiment.totals.remaining < 1e-6
    && noOom && validRoute && (experiment.profileId === 'manual-work'
      ? base === 3 && experiment.baselinePodUids?.length === 3 && routed.filter(item => item.request.path === '/api/work').every(item => item.body?.checksum === 3230)
        && experiment.workloadSpec?.units === 20 && experiment.workloadSpec?.scratchMiB === 96 && experiment.workloadSpec?.operation === 'process_batch'
      : profile.kind === 'ai-wait' ? !scales.some(item => item.from < item.to) && routed.some(item => item.request.path === '/api/ask'
        && item.integrationTrace?.profileId === 'answer-wait-150ms' && item.body?.answer === 'Training backups are kept for 30 days.')
      : experiment.profileId === 'guided-cycle' ? guidedPass(experiment, scales, noPending)
      : experiment.profileId === 'independent-cycle' ? independentPass(experiment, scales, noPending)
          : true)
  return success ? 'passed' : 'failed'
}

function guidedPass(experiment, scales, noPending) {
  return experiment.baselineReplicas === 2 && experiment.workloadSpec?.units === 20 && experiment.workloadSpec?.scratchMiB === 96
    && experiment.totals.remaining === 0 && experiment.totals.completed === experiment.totals.arrivals && noPending && !experiment.oomObserved
    && scales.some(item => item.cause === 'hpa' && item.from === 2 && item.to === 4)
    && scales.some(item => item.cause === 'hpa' && item.from > item.to && item.to === 2 && item.atMs <= experiment.phaseZeroAtMs + 270_000)
}

function independentPass(experiment, scales, noPending) {
  const observations = experiment.observations
  const burst = observations.find(item => item.second === 90)
  const drained = observations.find(item => item.second === 150)
  const finished = observations.at(-1)
  const allPods = observations.flatMap(item => item.pods)
  const hpa = experiment.hpaPolicy
  const metrics = hpa?.metrics?.[0]?.resource?.target?.averageUtilization
  const window = hpa?.behavior?.scaleDown?.stabilizationWindowSeconds ?? 300
  const resourceRows = allPods.filter(item => item.phase === 'Running')
  const cpuFits = resourceRows.every(item => item.cpuRequestM > 0 && item.cpuLimitM !== null && item.cpuLimitM >= item.cpuRequestM)
  const peakByPod = new Map()
  for (const item of resourceRows) peakByPod.set(item.uid, Math.max(peakByPod.get(item.uid) ?? 0, item.memoryPeakBytes))
  const memoryFits = resourceRows.every(item => item.memoryRequestBytes > 0 && item.memoryLimitBytes >= item.memoryRequestBytes)
    && [...peakByPod.values()].every(value => value === 256 * 1024 * 1024)
  const maxPodsPerNode = Math.ceil(hpa.maxReplicas / Object.keys(RESOURCE_FIXTURES.nodes).length)
  const maxAllocationFits = Object.values(RESOURCE_FIXTURES.nodes).every(node =>
    node.fixedCpuM + maxPodsPerNode * (resourceRows[0]?.cpuRequestM ?? Infinity) <= node.allocatableCpuM
    && node.fixedMemoryBytes + maxPodsPerNode * (resourceRows[0]?.memoryRequestBytes ?? Infinity) <= node.allocatableMemoryBytes)
  const noRestart = allPods.every(item => item.restartCount === 0)
  const placedQuickly = allPods.every(item => item.phase !== 'Pending' || item.placementAgeSeconds <= 30)
  const routeProof = experiment.routeSamples.length >= 3 && experiment.routeSamples.every(item => item.transport?.ok && item.status === 200
    && item.route?.podUid && item.workload?.operation === 'process_batch' && item.workload.units === 30 && item.workload.checksum === 7395)
  const scaledUp = scales.some(item => item.from === 2 && item.to >= 4 && item.to <= 6)
  const scaledDown = scales.some(item => item.from > 2 && item.to === 2 && item.atMs <= experiment.phaseZeroAtMs + 300_000)
  return experiment.workloadSpec?.units === 30 && experiment.workloadSpec?.scratchMiB === 160 && experiment.baselineReplicas === 2
    && hpa?.minReplicas === 2 && hpa.maxReplicas >= 4 && hpa.maxReplicas <= 6 && metrics >= 50 && metrics <= 70 && window >= 30 && window <= 120
    && scaledUp && scaledDown && burst?.readyReplicas >= 4 && burst?.completed >= 32 - 1e-9 && drained?.remaining === 0
    && finished?.desiredReplicas === 2 && finished?.readyReplicas === 2 && experiment.totals.completed === experiment.totals.arrivals
    && experiment.totals.remaining === 0 && !experiment.oomObserved && noRestart && noPending && placedQuickly && cpuFits && memoryFits && maxAllocationFits && routeProof
}

function persistExperimentResult(input, clusterId, experiment, lab) {
  let run = input
  const task = lab.tasks.find(item => item.verification?.scenarioId === experiment.scenarioId && item.verification?.scenarioVersion === 1)
  if (task) {
    run = recordVerification(run, lab, task.id, { scenarioId: experiment.scenarioId, scenarioVersion: 1,
      outcome: experiment.outcome, completed: experiment.outcome === 'passed', startedAtMs: experiment.phaseZeroAtMs ?? experiment.startedAtMs,
      endedAtMs: experiment.endedAtMs,
      measurements: { clusterId, scenarioId: experiment.scenarioId, profileId: experiment.profileId, totals: experiment.totals,
        samples: experiment.routeSamples, observations: experiment.observations, scaleReceipts: experiment.scaleReceipts ?? [],
        fingerprint: experiment.historicalFingerprint } })
    resourceRuntime(run, clusterId).experiment.evidenceId = run.evidence.currentEvidenceByTask[task.id]
    const incident = resourceRuntime(run, clusterId).incident
    const phaseForTask = { 'observe-pending': ['observations', 'scheduling'], 'repair-scheduling': ['recoveries', 'scheduling'], 'observe-oom': ['observations', 'memory'], 'repair-memory': ['recoveries', 'memory'], 'observe-hpa': ['observations', 'hpa'], 'repair-hpa': ['recoveries', 'hpa'] }[task.id]
    if (incident && phaseForTask && experiment.outcome === 'passed') incident[phaseForTask[0]][phaseForTask[1]] = run.evidence.currentEvidenceByTask[task.id]
  }
  const runtime = resourceRuntime(run, clusterId); const completed = runtime.experiment
  runtime.receipts.push({ kind: 'resource-experiment', profileId: completed.profileId, phase: 'complete', outcome: completed.outcome,
    reason: completed.unsupported ?? null, startedAtMs: completed.phaseZeroAtMs ?? completed.startedAtMs, endedAtMs: completed.endedAtMs,
    deploymentUid: completed.deploymentUid, hpaUid: completed.hpaUid, totals: clone(completed.totals),
    fingerprint: completed.historicalFingerprint, evidenceId: completed.evidenceId ?? null,
    samples: completed.routeSamples.slice(-8), observationCount: completed.observations.length })
  if (runtime.receipts.length > 40) runtime.receipts.splice(0, runtime.receipts.length - 40)
  return run
}

export function observeResourceExperiment(input, atMs, lab) {
  let run = clone(input)
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    const experiment = state.resourcesRuntime?.experiment
    if (!experiment || !['warming', 'running', 'unsupported'].includes(experiment.phase)) continue
    experiment.atMs = atMs
    if (experiment.phase === 'warming' && atMs >= experiment.warmupDeadlineMs) {
      experiment.phase = 'complete'; experiment.unsupported = 'RESOURCE_WARMUP_TIMEOUT'; experiment.outcome = 'failed'; experiment.endedAtMs = atMs
      run = persistExperimentResult(run, clusterId, experiment, lab)
      continue
    }
    maybeWarm(run, state, experiment, atMs)
    if (experiment.phase === 'unsupported') {
      experiment.phase = 'complete'; experiment.outcome = 'failed'; experiment.endedAtMs = atMs
      run = persistExperimentResult(run, clusterId, experiment, lab)
      continue
    }
    if (experiment.phase === 'running') {
      const profile = PROFILES[experiment.profileId]; const elapsed = (atMs - experiment.phaseZeroAtMs) / 1000
      const runtime = resourceRuntime(run, clusterId), current = runtime.experiment
      const legacyFixture = current.profileId.startsWith('test-')
      const willFinish = elapsed >= profile.durationSeconds && (!legacyFixture || current.totals.remaining < 1e-9)
      if (!profile.diagnosis && elapsed >= 0 && Number.isInteger(elapsed) && profileBoundaryOffsets(profile).has(elapsed) && !willFinish
        && !currentBoundaryRecorded(current, elapsed, false)) {
        const routed = captureBoundary(run, current, elapsed); run = routed.run
      }
      const observedRuntime = resourceRuntime(run, clusterId)
      const observed = observedRuntime.experiment
      observed.pendingObserved ||= observed.observations.some(item => item.pods.some(pod => pod.phase === 'Pending' && pod.placementAgeSeconds > 30))
      const oom = observedRuntime.receipts.find(item => item.kind === 'container-termination' && item.reason === 'OOMKilled' && item.exitCode === 137 && item.atMs >= observed.phaseZeroAtMs)
      observed.oomObserved ||= !!oom
      if (oom && !observed.oomProof) {
        const pod = Object.values(stateFor(run, clusterId).resources).find(item => item.kind === 'Pod' && item.metadata.uid === oom.podUid)
        const health = stateFor(run, clusterId).health?.containers?.[oom.podUid]
        observed.oomProof = { podUid: oom.podUid, containerId: oom.containerId, atMs: oom.atMs,
          restartCount: health?.restartCount ?? 0, restartAtMs: health?.restartAtMs ?? null, samePod: !!pod }
      }
      if (observed.oomProof) {
        const pod = Object.values(stateFor(run, clusterId).resources).find(item => item.kind === 'Pod' && item.metadata.uid === observed.oomProof.podUid)
        const health = stateFor(run, clusterId).health?.containers?.[observed.oomProof.podUid]
        observed.oomProof.restartCount = Math.max(observed.oomProof.restartCount, health?.restartCount ?? 0)
        observed.oomProof.restartAtMs = health?.restartAtMs ?? observed.oomProof.restartAtMs
        observed.oomProof.samePod = !!pod
      }
      if (observed.hpaUid) {
        const hpaRuntime = observedRuntime.hpa[observed.hpaUid]
        const hpa = Object.values(stateFor(run, clusterId).resources).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.uid === observed.hpaUid)
        if (hpaRuntime?.lastSyncMs === atMs && hpa && !(observed.hpaObservations ?? []).some(item => item.atMs === atMs)) {
          const pods = descendants(run, { ...observed.target, clusterId })
          const samplePodUids = pods.filter(pod => (observedRuntime.metrics[pod.metadata.uid] ?? []).some(sample => sample.windowEndMs === atMs
            && sample.containerId === stateFor(run, clusterId).health?.containers?.[pod.metadata.uid]?.containerId)).map(pod => pod.metadata.uid).sort()
          const conditions = hpa.status?.conditions ?? []
          const row = { atMs, reason: hpaRuntime.lastDecision?.reason ?? null,
            scalingActive: conditions.find(item => item.type === 'ScalingActive')?.status === 'True',
            eligiblePodUids: pods.filter(pod => pod.status?.phase === 'Running' && stateFor(run, clusterId).health?.containers?.[pod.metadata.uid]?.ready === true).map(pod => pod.metadata.uid).sort(),
            missingRequestPodUids: pods.filter(pod => !(normalizeContainerResources(pod.spec?.containers?.[0]?.resources ?? {}).effective.cpuRequestM > 0)).map(pod => pod.metadata.uid).sort(),
            samplePodUids }
          observed.hpaObservations ??= []; observed.hpaObservations.push(row); observed.hpaObservations = observed.hpaObservations.slice(-12)
        }
      }
      observed.scaleReceipts = observedRuntime.receipts.filter(item => item.kind === 'hpa-scale' && item.controllerUid === observed.hpaUid && item.atMs >= observed.phaseZeroAtMs)
      observed.provenance = run.runtime.kubernetes.requests.filter(item => item.workload?.operation === 'process_batch' && item.sequence >= (observed.startSequence ?? 0)).map(item => ({ operation: item.workload.operation, units: item.workload.units, checksum: item.workload.checksum })).slice(-12)
      if (willFinish
        && (profile.diagnosis || !currentBoundaryRecorded(current, elapsed, true))) {
        if (!profile.diagnosis) { const finalSample = captureBoundary(run, current, elapsed, true); run = finalSample.run }
        const completed = resourceRuntime(run, clusterId).experiment
        completed.phase = 'complete'; completed.endedAtMs = atMs; completed.outcome = assess(completed, profile)
        run = persistExperimentResult(run, clusterId, completed, lab)
      }
    }
  }
  return run
}

export function cancelResourceExperiment(input, clusterId, reason = 'Cancelled by learner.') {
  const run = clone(input); const runtime = resourceRuntime(run, clusterId); const experiment = runtime?.experiment
  if (!experiment || !['warming', 'running'].includes(experiment.phase)) return { run: input, diagnostics: [invalid('There is no active resource experiment.', 'INVALID_RESOURCE_EXPERIMENT')] }
  experiment.phase = 'cancelled'; experiment.outcome = 'cancelled'; experiment.cancellationReason = reason; experiment.endedAtMs = run.runtime.simTimeMs
  runtime.receipts.push({ kind: 'resource-experiment', profileId: experiment.profileId, phase: 'cancelled', outcome: 'cancelled',
    reason, startedAtMs: experiment.phaseZeroAtMs ?? experiment.startedAtMs, endedAtMs: run.runtime.simTimeMs,
    deploymentUid: experiment.deploymentUid, hpaUid: experiment.hpaUid, totals: clone(experiment.totals), fingerprint: experiment.historicalFingerprint,
    evidenceId: null, samples: experiment.routeSamples.slice(-8) })
  if (runtime.receipts.length > 40) runtime.receipts.splice(0, runtime.receipts.length - 40)
  return { run, diagnostics: [] }
}

export function cancelChangedResourceExperiments(input) {
  let run = input
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    const experiment = state.resourcesRuntime?.experiment
    if (!experiment || !['warming', 'running'].includes(experiment.phase)) continue
  const liveHpa = experiment.hpaUid ? Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.uid === experiment.hpaUid) : null
    const expected = fingerprint(run, state, experiment.target, clusterId, { hpa: liveHpa })
    const explicitDelete = (state.receipts ?? []).some(item => item.cause === 'pod-delete' && item.sequence >= experiment.startSequence
      && item.deletedPodName?.startsWith(`${experiment.target.deploymentName}-`))
    if (JSON.stringify(expected) === JSON.stringify(experiment.fingerprint) && !explicitDelete) continue
    const reason = liveHpa ? 'Saved source, routing, resource template, or HPA policy changed.' : 'Saved source, routing, resource template, or replicas changed.'
    run = cancelResourceExperiment(run, clusterId, reason).run
  }
  return run
}

export { PROFILES as RESOURCE_EXPERIMENT_PROFILES }

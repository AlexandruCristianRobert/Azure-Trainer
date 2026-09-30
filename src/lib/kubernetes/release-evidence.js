import { releaseDigest, captureReleaseSample, validReleaseScenario, releasePolicy, releasePolicyMeetsBrief, validReleaseFlow } from './release-experiments.js'
import { getProjectManifest } from '../project/manifests.js'
import { projectSourceHash, selectBuildFiles } from '../project/build.js'
import { parseKubernetesYaml } from './yaml.js'
import { validateKubernetesObject } from './schema.js'
import { getDeploymentPods } from './reconcile.js'
import { getRolloutSummary } from './rollouts.js'
import { recordVerification } from '../labEngine/evidence.js'
import { canonicalize } from '../labEngine/evidence.js'
import { routeServiceRequest } from './connectivity.js'

const clone = value => structuredClone(value)
const objectKey = object => `${object.kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`
const resourcesFor = (run, target) => run.runtime.kubernetes.clusters[target.clusterId]?.resources ?? {}
const consistencyLab = { capabilities: { kubernetesRollouts: true, kubernetesConfiguration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesConnectivity: true } }
const proofTargets = lab => Object.values(lab.scenarios ?? {}).filter(scenario => ['aks-release', 'aks-release-final'].includes(scenario.kind)
  || lab.capabilities?.kubernetesDiagnostics === true && scenario.kind === 'aks-request' && scenario.requireTwoReplicas === true).map(scenario => scenario.target)

function desired(object) {
  if (!object) return null
  const value = clone(object)
  delete value.sourceLocation; delete value.status
  value.metadata = { name: value.metadata.name, ...(value.metadata.namespace ? { namespace: value.metadata.namespace } : {}), ...(value.metadata.labels ? { labels: value.metadata.labels } : {}) }
  if (value.kind === 'Service') delete value.spec.clusterIP
  if (value.kind === 'Deployment') {
    delete value.spec.template.metadata.labels?.['pod-template-hash']
    delete value.spec.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at']
    if (value.spec.template.metadata.annotations && !Object.keys(value.spec.template.metadata.annotations).length) delete value.spec.template.metadata.annotations
  }
  return value
}

export function releaseSavedObjects(run, target, lab) {
  const docs = []; const diagnostics = []
  for (const [path, text] of Object.entries(run.project.savedFiles)) {
    if (lab.capabilities?.aksCapstone === true && path === 'k8s/hpa.yaml' && text.trim()
      && text.split(/\r?\n/).every(line => !line.trim() || line.trim().startsWith('#'))) continue
    if (!/^k8s\/.*\.ya?ml$/i.test(path)) continue
    const parsed = parseKubernetesYaml(text, path)
    diagnostics.push(...parsed.diagnostics)
    for (const doc of parsed.documents) {
      if (!doc || (doc.metadata?.namespace ?? target.namespace) !== target.namespace
        || !['Deployment', 'ConfigMap', 'Secret', 'Service'].includes(doc.kind) || doc.kind === 'Deployment' && doc.metadata.name !== target.deploymentName) continue
      const result = validateKubernetesObject(doc, { namespace: target.namespace, capabilities: lab.capabilities })
      diagnostics.push(...result.diagnostics)
      if (result.object) docs.push({ path, key: objectKey(result.object), object: result.object })
    }
  }
  return { docs, diagnostics }
}

/** Hash only: no manifests, configuration values or captured environments enter proof. */
export function releaseFingerprint(run, target, lab) {
  const resources = resourcesFor(run, target); const deployment = resources[`Deployment/${target.namespace}/${target.deploymentName}`]
  const image = deployment?.spec.template.spec.containers[0].image ?? null
  const artifactId = image ? run.artifacts.publishedTags[image] ?? null : null
  const artifact = run.artifacts.buildsById[artifactId]
  const manifest = getProjectManifest(run.project.manifestId)
  const { docs, diagnostics } = releaseSavedObjects(run, target, lab)
  return { version: 1, deploymentUid: deployment?.metadata.uid ?? null,
    sourceHash: projectSourceHash(selectBuildFiles(run.project.savedFiles, manifest)),
    sourceVersions: Object.fromEntries(manifest.buildFiles.map(path => [path, run.project.fileVersions[path] ?? 0])),
    savedObjects: docs.map(({ key, object }) => ({ key, hash: releaseDigest(desired(object)) })).sort((a, b) => a.key.localeCompare(b.key)),
    invalidYaml: diagnostics.length > 0,
    liveObjects: Object.values(resources).filter(object => object.metadata.namespace === target.namespace && ['ConfigMap', 'Secret', 'Service'].includes(object.kind) || object === deployment)
      .map(object => ({ key: objectKey(object), uid: object.metadata.uid, hash: releaseDigest(desired(object)) })).sort((a, b) => a.key.localeCompare(b.key)),
    artifact: artifact ? { id: artifactId, sourceHash: artifact.sourceHash, digest: artifact.digest } : null }
}

function proofState(run, target, lab, { trackObjects = false } = {}) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  if (!state?.rollouts) return null
  const key = `Deployment/${target.namespace}/${target.deploymentName}`; const uid = state.resources[key]?.metadata.uid
  if (!uid) return null
  const fingerprint = releaseFingerprint(run, target, lab); const hash = releaseDigest(fingerprint)
  const map = state.rollouts.proofs ??= {}
  const proof = map[uid] ??= { version: 1, target: clone(target), generation: 0, hash, appliedKeys: [], reapply: null, restart: null }
  if (!trackObjects && proof.objectStates === undefined && proof.hash === hash) return { proof, fingerprint, state, uid }
  if (proof.objectStates === undefined && proof.hash !== hash) proof.appliedKeys = []
  const inputsHash = releaseDigest({ deploymentUid: uid, sourceHash: fingerprint.sourceHash, sourceVersions: fingerprint.sourceVersions,
    artifact: fingerprint.artifact, invalidYaml: fingerprint.invalidYaml })
  const previousObjects = proof.objectStates ?? {}
  const objectStates = {}
  for (const key of new Set([...fingerprint.savedObjects.map(item => item.key), ...fingerprint.liveObjects.map(item => item.key)])) {
    const objectHash = releaseDigest({ saved: fingerprint.savedObjects.filter(item => item.key === key), live: fingerprint.liveObjects.find(item => item.key === key) ?? null })
    const previous = previousObjects[key]
    objectStates[key] = { hash: objectHash, generation: (previous?.generation ?? 0) + (previous && previous.hash !== objectHash ? 1 : 0) }
    if (previous && previous.hash !== objectHash) proof.appliedKeys = proof.appliedKeys.filter(item => item !== key)
  }
  proof.appliedKeys = proof.appliedKeys.filter(key => Object.hasOwn(objectStates, key))
  if (proof.inputsHash !== undefined && proof.inputsHash !== inputsHash) proof.appliedKeys = []
  proof.inputsHash = inputsHash; proof.objectStates = objectStates
  if (proof.hash !== hash) { proof.generation++; proof.hash = hash; proof.reapply = null; proof.restart = null }
  return { proof, fingerprint, state, uid }
}

/** Called at the successful apply boundary, including genuine no-op apply. */
export function noteReleaseReapply(run, clusterId, object, lab) {
  if (!lab.capabilities?.kubernetesRollouts || !['Deployment', 'ConfigMap', 'Secret', 'Service'].includes(object.kind)) return run
  const targets = proofTargets(lab).filter(target => target.clusterId === clusterId && target.namespace === object.metadata.namespace)
  for (const target of targets) {
    const view = proofState(run, target, lab, { trackObjects: true }); if (!view) continue
    const key = objectKey(object); const saved = view.fingerprint.savedObjects.find(item => item.key === key)
    if (!saved || saved.hash !== releaseDigest(desired(object))) continue
    if (!view.proof.appliedKeys.includes(key)) view.proof.appliedKeys.push(key)
    if (view.fingerprint.savedObjects.length > 0 && view.fingerprint.savedObjects.every(item => view.proof.appliedKeys.includes(item.key))) {
      view.proof.reapply = { atMs: run.runtime.simTimeMs, hash: view.proof.hash, dependencyGenerations: { release: view.proof.generation, ...view.fingerprint.sourceVersions },
        objectGenerations: Object.fromEntries(view.fingerprint.savedObjects.map(item => [item.key, view.proof.objectStates[item.key].generation])),
        semanticHashes: { saved: releaseDigest(view.fingerprint.savedObjects), live: releaseDigest(view.fingerprint.liveObjects) } }
      view.proof.restart = null
    }
  }
  return run
}

export function refreshReleaseProofs(run, lab, { restarted = false, previous = null } = {}) {
  if (!lab.capabilities?.kubernetesRollouts) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters)) for (const uid of Object.keys(state.rollouts?.proofs ?? {}))
    if (!Object.values(state.resources).some(item => item.kind === 'Deployment' && item.metadata.uid === uid)) delete state.rollouts.proofs[uid]
  const targets = proofTargets(lab)
  const visited = new Set()
  for (const target of targets) {
    const view = proofState(run, target, lab); if (!view || visited.has(view.uid)) continue
    visited.add(view.uid)
    const rs = view.state.rollouts.deployments[view.uid]?.currentRsUid
    const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).filter(pod => pod.metadata.ownerReferences.some(ref => ref.uid === rs))
    if (restarted && previous && view.proof.reapply) {
      const before = previous.runtime.kubernetes.clusters[target.clusterId]?.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
      const after = view.state.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
      if (before?.spec.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at'] !== after?.spec.template.metadata.annotations?.['kubectl.kubernetes.io/restarted-at'])
        view.proof.restart = { atMs: run.runtime.simTimeMs, rsUid: rs, generation: view.proof.generation,
          beforePodUids: getDeploymentPods(previous, target.clusterId, target.namespace, target.deploymentName).map(pod => pod.metadata.uid), podUids: pods.map(pod => pod.metadata.uid) }
    }
    if (view.proof.restart?.rsUid === rs) for (const pod of pods) if (!view.proof.restart.podUids.includes(pod.metadata.uid)) view.proof.restart.podUids.push(pod.metadata.uid)
  }
  return run
}

/** Pure shared saved/build/live alignment. Witnesses are written only by apply/restart boundaries. */
export function inspectDeploymentConsistency(input, target, manifest = getProjectManifest(input.project.manifestId), lab = consistencyLab, { requireRestart = true } = {}) {
  const run = JSON.parse(JSON.stringify(input))
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const deployment = resourcesFor(run, target)[`Deployment/${target.namespace}/${target.deploymentName}`]
  const reasons = []
  const summary = getRolloutSummary(run, target)
  if (!deployment || !summary?.complete) reasons.push('Complete the intended rollout; inspect every new Pod, events and rollout status.')
  if (!deployment || !state?.rollouts) return { consistent: false, reasons, witness: null }
  const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, manifest))
  const artifactId = run.artifacts.publishedTags[deployment.spec.template.spec.containers[0].image]
  const artifact = run.artifacts.buildsById[artifactId]
  if (artifact?.sourceHash !== sourceHash) reasons.push('Rebuild and publish an image from the current saved build files.')
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  if (pods.length !== deployment.spec.replicas || pods.some(pod => state.podSnapshots[pod.metadata.uid]?.artifactId !== artifactId)) reasons.push('Deploy or restart the intended published artifact on every desired Pod.')
  const { docs, diagnostics } = releaseSavedObjects(run, target, lab)
  const savedDeployment = docs.find(item => item.key === objectKey(deployment))
  if (!savedDeployment || releaseDigest(desired(savedDeployment.object)) !== releaseDigest(desired(deployment))) reasons.push('Repair the saved Deployment to match the desired live spec and apply it.')
  if (diagnostics.length || new Set(docs.map(item => item.key)).size !== docs.length
    || Object.values(state.resources).some(object => object.metadata.namespace === target.namespace && ['ConfigMap', 'Secret', 'Service'].includes(object.kind) && !docs.some(item => item.key === objectKey(object)))) reasons.push('Repair saved configuration/Services so every required live object has a valid saved manifest, then apply them.')
  if (docs.filter(item => item.object.kind !== 'Deployment').some(item => releaseDigest(desired(item.object)) !== releaseDigest(desired(state.resources[item.key])))) reasons.push('Repair saved configuration/Services and apply them to match live objects.')
  if (pods.some(pod => (state.podSnapshots[pod.metadata.uid]?.configRefs ?? []).some(ref => {
    const object = state.resources[`${ref.kind}/${ref.namespace}/${ref.name}`]
    return !object || ref.uid !== object.metadata.uid || ref.resourceVersion !== object.metadata.resourceVersion
  }))) reasons.push('Captured configuration is stale; restart Pods after applying the final configuration.')
  const fingerprint = releaseFingerprint(run, target, lab); const hash = releaseDigest(fingerprint)
  const proof = state.rollouts.proofs?.[deployment.metadata.uid]
  if (requireRestart && (!proof?.reapply || !proof.restart || proof.hash !== hash || proof.reapply.hash !== hash || proof.restart.generation !== proof.generation
    || proof.reapply.objectGenerations !== undefined && canonicalize(proof.reapply.objectGenerations)
      !== canonicalize(Object.fromEntries(fingerprint.savedObjects.map(item => [item.key, proof.objectStates?.[item.key]?.generation ?? -1])))
    || proof.restart.atMs < proof.reapply.atMs || proof.restart.rsUid !== state.rollouts.deployments[deployment.metadata.uid]?.currentRsUid
    || pods.some(pod => !proof.restart.podUids.includes(pod.metadata.uid) || proof.restart.beforePodUids.includes(pod.metadata.uid)))) reasons.push('Reapply all final files, then rollout restart and wait for successful completion.')
  return { consistent: reasons.length === 0, reasons, witness: proof ? clone(proof) : null }
}

export function verifyReleaseState(run, lab, scenarioId) {
  const scenario = lab.scenarios?.[scenarioId]
  const failed = reason => ({ passed: false, reason, evidence: {} })
  if (!validReleaseScenario(scenario, true)) return failed('Select the declared final release verification.')
  const target = scenario.target; const state = run.runtime.kubernetes.clusters[target.clusterId]
  const deployment = resourcesFor(run, target)[`Deployment/${target.namespace}/${target.deploymentName}`]
  const summary = getRolloutSummary(run, target)
  if (!deployment || !summary?.complete) return failed('Complete the intended rollout; inspect every new Pod, events and rollout status.')
  if (!releasePolicyMeetsBrief(releasePolicy(run, target), lab.releaseRequirements)) return failed('Meet the independent replica, rolling budget, readiness, deadline and retained-history brief.')
  const manifest = getProjectManifest(run.project.manifestId)
  const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, manifest))
  const image = deployment.spec.template.spec.containers[0].image; const artifactId = run.artifacts.publishedTags[image]
  const artifact = run.artifacts.buildsById[artifactId]
  if (artifact?.sourceHash !== sourceHash) return failed('Rebuild and publish an image from the current saved build files.')
  if (artifact.appSpec.version !== scenario.expectedRelease) return failed('Set saved source version to 2.0, rebuild and deploy that artifact.')
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  const consistency = inspectDeploymentConsistency(run, target, manifest, lab)
  if (!consistency.consistent) return failed(consistency.reasons[0])
  const proof = consistency.witness
  const service = state.resources[`Service/${target.namespace}/${target.serviceName}`]
  const info = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target.clusterId },
    hostname: service?.status.loadBalancer?.ingress?.[0]?.ip ?? 'unassigned', port: service?.spec.ports[0].port ?? 80,
    method: 'GET', path: '/api/info' }, null)
  if (!info.outcome.transport.ok || info.outcome.status !== 200 || info.outcome.body?.version !== scenario.expectedRelease
    || info.outcome.route.artifactId !== artifactId) return failed('Verify fresh /api/info version 2.0 through the intended current artifact.')
  const samples = []; let current = info.run
  for (const index of [0, 1]) {
    const captured = captureReleaseSample(current, target, run.runtime.simTimeMs, index)
    current = captured.run; samples.push(captured.sample)
    if (!validReleaseFlow(captured.sample) || captured.sample.release !== scenario.expectedRelease || captured.sample.artifactId !== artifactId)
      return failed('Repair and verify both known questions with their correct answers, retrieved source IDs and fresh three-stage flow through the intended current artifact.')
  }
  return { passed: true, reason: 'Current saved source, applied objects and newly restarted Pods agree.', evidence: { clusterId: target.clusterId, namespace: target.namespace,
    deploymentUid: deployment.metadata.uid, sourceHash, artifactId, digest: artifact.digest, currentRevision: summary.currentRevision,
    infoVersion: info.outcome.body.version, podUids: pods.map(pod => pod.metadata.uid), sample: samples[0], samples, witness: clone(proof) } }
}

export function releaseDependencies(target, { historical = false, scenarioId = null, incidentEpoch = null } = {}) {
  const key = `aks-release:${target.clusterId}:${target.namespace}:${target.deploymentName}:${historical ? `history:${scenarioId}:${incidentEpoch}` : 'live'}`
  return { [key]: context => {
    const state = context.runtime.kubernetes?.clusters[target.clusterId]
    if (historical) {
      // Receipt arrays are bounded, but an earned milestone already retains
      // its immutable receipt identity in the engine dependency snapshot.
      const earned = Object.values(context.evidence?.currentEvidenceByTask ?? {}).map(id => context.evidence.experimentsById[id]).find(record => record?.outcome === 'passed' && record.completed
        && record.scenarioId === scenarioId && record.measurements?.clusterId === target.clusterId && record.measurements?.namespace === target.namespace
        && (incidentEpoch === null || record.measurements?.incidentEpoch === incidentEpoch) && record.dependencyValues?.[key]?.length === 1
        && record.dependencyValues[key][0]?.attemptId === record.attemptId && record.dependencyValues[key][0]?.deploymentUid === record.measurements?.deploymentUid
        && record.dependencyValues[key][0]?.scenarioId === scenarioId && record.dependencyValues[key][0]?.incidentEpoch === record.measurements?.incidentEpoch
        && record.dependencyValues[key][0]?.outcome === 'passed' && record.dependencyValues[key][0]?.id === record.measurements?.receiptId)
      if (earned) return earned.dependencyValues[key]
      return (state?.rollouts.receipts ?? []).filter(receipt => receipt.scenarioId === scenarioId && receipt.outcome === 'passed' && (incidentEpoch === null || receipt.incidentEpoch === incidentEpoch)).slice(0, 1)
        .map(receipt => ({ id: receipt.id, attemptId: receipt.attemptId, scenarioId: receipt.scenarioId, deploymentUid: receipt.deploymentUid, incidentEpoch: receipt.incidentEpoch, outcome: receipt.outcome }))
    }
    const lab = { capabilities: { kubernetesRollouts: true, kubernetesConfiguration: true, kubernetesProbes: true, kubernetesResources: true, kubernetesConnectivity: true } }
    const fingerprint = releaseFingerprint(context, target, lab)
    const uid = fingerprint.deploymentUid
    return { ...fingerprint, proofGeneration: state?.rollouts.proofs?.[uid]?.generation ?? 0,
      proof: state?.rollouts.proofs?.[uid] ?? null, rollout: getRolloutSummary(context, target),
      podUids: getDeploymentPods(context, target.clusterId, target.namespace, target.deploymentName).map(pod => pod.metadata.uid).sort() }
  } }
}

/** Observation tasks may share an active recovery stream's actual incident. */
export function releaseIncidentObservation(run, lab, scenarioId) {
  const scenario = lab.scenarios?.[scenarioId]
  if (!validReleaseScenario(scenario) || !scenario.requireIncident) return null
  const state = run.runtime.kubernetes.clusters[scenario.target.clusterId]
  const uid = state?.resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]?.metadata.uid
  const experiment = [state?.rollouts.experiment, ...(state?.rollouts.receipts ?? [])].find(item => item?.scenarioId === scenarioId && item.attemptId === run.attemptId
    && item.deploymentUid === uid && item.incidentEpoch === (scenario.freshIncidentEpoch ? state.rollouts.experiment?.incidentEpoch : scenario.incidentEpoch) && item.incidentSeen && item.incident
    && (!scenario.requireDeadline || item.deadlineSeen && item.incident.deadline) && canonicalize(item.target) === canonicalize(scenario.target))
  return experiment ? { attemptId: experiment.attemptId, scenarioId, deploymentUid: uid, incidentEpoch: experiment.incidentEpoch, ...clone(experiment.incident) } : null
}

export function recordFinalReleaseVerification(run, lab, scenarioId) {
  const task = lab.tasks.find(task => task.verification?.scenarioId === scenarioId)
  if (!task) return { run, diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'No Task declares this final verification scenario.' }] }
  const result = verifyReleaseState(run, lab, scenarioId)
  return { run: recordVerification(run, lab, task.id, { scenarioId, scenarioVersion: 1, outcome: result.passed ? 'passed' : 'failed', completed: result.passed,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements: { ...result.evidence, reason: result.reason } }),
    lines: [{ kind: result.passed ? 'out' : 'err', text: result.reason }], diagnostics: [] }
}

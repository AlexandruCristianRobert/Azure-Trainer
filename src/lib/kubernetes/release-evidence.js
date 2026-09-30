import { releaseDigest, captureReleaseSample, validReleaseScenario } from './release-experiments.js'
import { getProjectManifest } from '../project/manifests.js'
import { projectSourceHash, selectBuildFiles } from '../project/build.js'
import { parseKubernetesYaml } from './yaml.js'
import { validateKubernetesObject } from './schema.js'
import { getDeploymentPods } from './reconcile.js'
import { getRolloutSummary } from './rollouts.js'
import { recordVerification } from '../labEngine/evidence.js'
import { canonicalize } from '../labEngine/evidence.js'

const clone = value => structuredClone(value)
const objectKey = object => `${object.kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`
const resourcesFor = (run, target) => run.runtime.kubernetes.clusters[target.clusterId]?.resources ?? {}

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

function proofState(run, target, lab) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  if (!state?.rollouts) return null
  const key = `Deployment/${target.namespace}/${target.deploymentName}`; const uid = state.resources[key]?.metadata.uid
  if (!uid) return null
  const fingerprint = releaseFingerprint(run, target, lab); const hash = releaseDigest(fingerprint)
  const map = state.rollouts.proofs ??= {}
  const proof = map[uid] ??= { version: 1, target: clone(target), generation: 0, hash, appliedKeys: [], reapply: null, restart: null }
  if (proof.hash !== hash) { proof.generation++; proof.hash = hash; proof.appliedKeys = []; proof.reapply = null; proof.restart = null }
  return { proof, fingerprint, state, uid }
}

/** Called at the successful apply boundary, including genuine no-op apply. */
export function noteReleaseReapply(run, clusterId, object, lab) {
  if (!lab.capabilities?.kubernetesRollouts || !['Deployment', 'ConfigMap', 'Secret', 'Service'].includes(object.kind)) return run
  const targets = Object.values(lab.scenarios ?? {}).filter(scenario => ['aks-release', 'aks-release-final'].includes(scenario.kind) && scenario.target.clusterId === clusterId && scenario.target.namespace === object.metadata.namespace).map(scenario => scenario.target)
  for (const target of targets) {
    const view = proofState(run, target, lab); if (!view) continue
    const key = objectKey(object); const saved = view.fingerprint.savedObjects.find(item => item.key === key)
    if (!saved || saved.hash !== releaseDigest(desired(object))) continue
    if (!view.proof.appliedKeys.includes(key)) view.proof.appliedKeys.push(key)
    if (view.fingerprint.savedObjects.length > 0 && view.fingerprint.savedObjects.every(item => view.proof.appliedKeys.includes(item.key))) {
      view.proof.reapply = { atMs: run.runtime.simTimeMs, hash: view.proof.hash, dependencyGenerations: { release: view.proof.generation, ...view.fingerprint.sourceVersions }, semanticHashes: { saved: releaseDigest(view.fingerprint.savedObjects), live: releaseDigest(view.fingerprint.liveObjects) } }
      view.proof.restart = null
    }
  }
  return run
}

export function refreshReleaseProofs(run, lab, { restarted = false, previous = null } = {}) {
  if (!lab.capabilities?.kubernetesRollouts) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters)) for (const uid of Object.keys(state.rollouts?.proofs ?? {}))
    if (!Object.values(state.resources).some(item => item.kind === 'Deployment' && item.metadata.uid === uid)) delete state.rollouts.proofs[uid]
  const targets = Object.values(lab.scenarios ?? {}).filter(scenario => ['aks-release', 'aks-release-final'].includes(scenario.kind)).map(scenario => scenario.target)
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

export function verifyReleaseState(run, lab, scenarioId) {
  const scenario = lab.scenarios?.[scenarioId]
  const failed = reason => ({ passed: false, reason, evidence: {} })
  if (!validReleaseScenario(scenario, true)) return failed('Select the declared final release verification.')
  const target = scenario.target; const state = run.runtime.kubernetes.clusters[target.clusterId]
  const deployment = resourcesFor(run, target)[`Deployment/${target.namespace}/${target.deploymentName}`]
  const summary = getRolloutSummary(run, target)
  if (!deployment || !summary?.complete) return failed('Complete the intended rollout; inspect every new Pod, events and rollout status.')
  const manifest = getProjectManifest(run.project.manifestId)
  const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, manifest))
  const image = deployment.spec.template.spec.containers[0].image; const artifactId = run.artifacts.publishedTags[image]
  const artifact = run.artifacts.buildsById[artifactId]
  if (artifact?.sourceHash !== sourceHash) return failed('Rebuild and publish an image from the current saved build files.')
  if (artifact.appSpec.version !== scenario.expectedRelease) return failed('Set saved source version to 2.0, rebuild and deploy that artifact.')
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  if (pods.length !== deployment.spec.replicas || pods.some(pod => state.podSnapshots[pod.metadata.uid]?.artifactId !== artifactId)) return failed('Deploy or restart the intended published artifact on every desired Pod.')
  const { docs, diagnostics } = releaseSavedObjects(run, target, lab)
  const savedDeployment = docs.find(item => item.key === objectKey(deployment))
  if (!savedDeployment || releaseDigest(desired(savedDeployment.object)) !== releaseDigest(desired(deployment))) return failed('Repair the saved Deployment to match the desired live spec and apply it.')
  if (diagnostics.length || new Set(docs.map(item => item.key)).size !== docs.length
    || Object.values(state.resources).some(object => object.metadata.namespace === target.namespace && ['ConfigMap', 'Secret', 'Service'].includes(object.kind) && !docs.some(item => item.key === objectKey(object)))) return failed('Repair saved configuration/Services so every required live object has a valid saved manifest, then apply them.')
  for (const item of docs.filter(item => item.object.kind !== 'Deployment')) {
    if (releaseDigest(desired(item.object)) !== releaseDigest(desired(state.resources[item.key]))) return failed('Repair saved configuration/Services and apply them to match live objects.')
  }
  for (const pod of pods) for (const ref of state.podSnapshots[pod.metadata.uid]?.configRefs ?? []) {
    const object = state.resources[`${ref.kind}/${ref.namespace}/${ref.name}`]
    if (!object || ref.uid !== object.metadata.uid || ref.resourceVersion !== object.metadata.resourceVersion) return failed('Captured configuration is stale; restart Pods after applying the final configuration.')
  }
  const fingerprint = releaseFingerprint(run, target, lab); const hash = releaseDigest(fingerprint)
  const proof = state.rollouts.proofs?.[deployment.metadata.uid]
  if (!proof?.reapply || !proof.restart || proof.hash !== hash || proof.reapply.hash !== hash || proof.restart.generation !== proof.generation
    || proof.restart.atMs < proof.reapply.atMs || proof.restart.rsUid !== state.rollouts.deployments[deployment.metadata.uid].currentRsUid
    || pods.some(pod => !proof.restart.podUids.includes(pod.metadata.uid) || proof.restart.beforePodUids.includes(pod.metadata.uid))) return failed('Reapply all final files, then rollout restart and wait for successful completion.')
  const { sample } = captureReleaseSample(run, target, run.runtime.simTimeMs, 0)
  if (!sample.transport.ok || sample.status !== 200 || sample.release !== scenario.expectedRelease || !['embedding', 'postgres-query', 'answer'].every(operation => sample.operations.some(item => item.operation === operation && item.status === 'succeeded'))) return failed('Repair and verify a fresh embedding, PostgreSQL retrieval and answer flow.')
  return { passed: true, reason: 'Current saved source, applied objects and newly restarted Pods agree.', evidence: { clusterId: target.clusterId, namespace: target.namespace,
    deploymentUid: deployment.metadata.uid, sourceHash, artifactId, digest: artifact.digest, currentRevision: summary.currentRevision, podUids: pods.map(pod => pod.metadata.uid), sample, witness: clone(proof) } }
}

export function releaseDependencies(target, { historical = false, scenarioId = null, incidentEpoch = null } = {}) {
  const key = `aks-release:${target.clusterId}:${target.namespace}:${target.deploymentName}:${historical ? `history:${scenarioId}:${incidentEpoch}` : 'live'}`
  return { [key]: context => {
    const state = context.runtime.kubernetes?.clusters[target.clusterId]
    if (historical) return (state?.rollouts.receipts ?? []).filter(receipt => receipt.scenarioId === scenarioId && receipt.outcome === 'passed' && (incidentEpoch === null || receipt.incidentEpoch === incidentEpoch)).slice(0, 1)
      .map(receipt => ({ id: receipt.id, attemptId: receipt.attemptId, scenarioId: receipt.scenarioId, deploymentUid: receipt.deploymentUid, incidentEpoch: receipt.incidentEpoch, outcome: receipt.outcome }))
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
    && item.deploymentUid === uid && item.incidentEpoch === scenario.incidentEpoch && item.incidentSeen && item.incident
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

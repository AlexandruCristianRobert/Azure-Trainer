import { getRolloutSummary } from './rollouts.js'
import { getDeploymentPods } from './reconcile.js'
import { releaseFingerprint } from './release-evidence.js'
import { redactRolloutOutput } from './diagnostics.js'

/** Pure, value-safe read model. It never reconciles, sends requests or advances time. */
export function inspectRelease(run, target, lab) {
  // Pinia exposes reactive proxies; inspect a finite JSON snapshot without
  // handing those proxies to the controller's structuredClone read helpers.
  run = run ? JSON.parse(JSON.stringify(run)) : run
  const state = run?.runtime?.kubernetes?.clusters?.[target?.clusterId]
  const deployment = state?.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]
  if (!state?.rollouts || !deployment) return null
  const rollout = state.rollouts.deployments[deployment.metadata.uid]
  const proof = releaseFingerprint(run, target, lab)
  const savedLiveMismatch = proof.invalidYaml || proof.savedObjects.some(item => item.hash !== proof.liveObjects.find(live => live.key === item.key)?.hash)
  return { summary: getRolloutSummary(run, target), savedLiveMismatch,
    experiment: state.rollouts.experiment?.deploymentUid === deployment.metadata.uid ? structuredClone(state.rollouts.experiment) : null,
    revisions: (rollout?.revisions ?? []).map(item => ({ revision: item.revision, current: item.revision === rollout.currentRevision, rsUid: item.rsUid, image: redactRolloutOutput(item.imageRef, state) })),
    pods: getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).map(pod => {
      const snapshot = state.podSnapshots[pod.metadata.uid]; const artifact = run.artifacts.buildsById[snapshot?.artifactId]
      return { uid: pod.metadata.uid, name: pod.metadata.name, revision: rollout.revisions.find(item => pod.metadata.ownerReferences.some(ref => ref.uid === item.rsUid))?.revision ?? null,
        artifactId: snapshot?.artifactId ?? null, digest: artifact?.digest ?? null, sourceHash: artifact?.sourceHash ?? null,
        status: pod.metadata.deletionTimestamp !== undefined ? 'Terminating' : pod.status.phase }
    }) }
}

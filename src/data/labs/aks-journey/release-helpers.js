import { releaseDependencies } from '../../../lib/kubernetes/release-evidence.js'
import { releaseMilestoneDependencies, releaseMilestonePassed } from '../../../lib/kubernetes/release-milestones.js'

export function releaseTask(id, scenarioId, content) {
  const { target, historical = true, milestone = false, ...task } = content
  return { id, ...task, verification: { scenarioId, scenarioVersion: 1 },
    dependencies: task.dependencies ?? (milestone ? releaseMilestoneDependencies(target, scenarioId)
      : releaseDependencies(target, { historical, scenarioId })),
    check: task.check ?? (context => releaseMilestonePassed(context, id, scenarioId, target)) }
}

export function previousHealthyReleaseAction(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const deployment = state.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
  const history = state.rollouts.deployments[deployment.metadata.uid]
  const retained = history.revisions.filter(item => item.revision < history.currentRevision
    && item.template.spec.containers[0].readinessProbe?.httpGet?.path === '/health/ready'
    && run.artifacts.buildsById[run.artifacts.publishedTags[item.imageRef]]?.appSpec.version === '2.0')
    .sort((a, b) => b.revision - a.revision)[0]
  if (!retained) throw new Error('Inspect rollout history: no retained healthy v2 template is available.')
  return { type: 'command', line: `kubectl rollout undo deployment/${target.deploymentName} -n ${target.namespace} --to-revision=${retained.revision}` }
}

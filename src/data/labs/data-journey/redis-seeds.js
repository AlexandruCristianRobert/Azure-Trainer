import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { REDIS_TARGET, REDIS_CLUSTER_ID, REDIS_CREATE_COMMAND, REDIS_INDEX_COMMAND, redisCliCommand } from './redis-helpers.js'

export function applyRedisSeedActions(run, actions) {
  const lab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    dataTarget: REDIS_TARGET, tasks: [], capabilities: { dataRedis: true, acrBuild: true, kubernetes: true } }
  let seeded = run
  for (const action of actions) {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(`Redis seed failed: ${JSON.stringify({ action, diagnostics: result.diagnostics, lines: result.lines })}`)
    seeded = result.run
  }
  return seeded
}
const command = line => ({ type: 'command', line })
const initialized = run => ({ sandbox: run.sandbox, artifacts: run.artifacts, runtime: run.runtime, nextSequence: run.nextSequence })
export function seedRedisGuided(run) {
  let seeded = applyRedisSeedActions(run, [
    command('az group create -n rg-assistant -l eastus'),
    command('az acr create -g rg-assistant -n acrassistant --sku Basic'),
    command('az aks create -g rg-assistant -n aks-assistant --enable-managed-identity --generate-ssh-keys --attach-acr acrassistant'),
    command('az aks get-credentials -g rg-assistant -n aks-assistant'),
  ])
  seeded.runtime.kubernetes.clusters[REDIS_CLUSTER_ID].resources['Namespace//assistant'] = {
    apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'assistant', uid: `fixture-${REDIS_CLUSTER_ID}-assistant-namespace`, resourceVersion: '1' },
  }
  seeded = applyRedisSeedActions(seeded, [command('kubectl apply -f k8s/service.yaml')])
  return initialized(seeded)
}
function seedApp(run, { modules, index, tag }) {
  const infrastructure = { ...run, ...seedRedisGuided(run) }
  const create = modules ? REDIS_CREATE_COMMAND : REDIS_CREATE_COMMAND.replace(' --modules name=RediSearch', '')
  // Build caller-supplied unfinished/faulty zones, never substitute solution code.
  const seeded = applyRedisSeedActions(infrastructure, [command(create), ...(index ? [command(redisCliCommand(REDIS_INDEX_COMMAND))] : []),
    command(`az acr build --registry acrassistant --image assistant:${tag} .`),
    { type: 'save-file', path: 'k8s/deployment.yaml', text: run.project.savedFiles['k8s/deployment.yaml'].replace(/assistant:[A-Za-z0-9_.-]+/g, `assistant:${tag}`) },
    command('kubectl apply -f k8s/deployment.yaml'),
  ])
  return initialized(seeded)
}
// Only the caller's invalidation fault is active; schema faults enter visibly later.
export function seedRedisTroubleshooting(run) { return seedApp(run, { modules: true, index: true, tag: 'redis-troubleshooting-seed' }) }
export function seedRedisIndependent(run) { return seedApp(run, { modules: true, index: true, tag: 'redis-independent-seed' }) }

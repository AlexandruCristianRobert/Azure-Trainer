import { BICEP_INDEPENDENT_INITIAL_FILES, BICEP_INDEPENDENT_SOLUTION_FILES,
  BICEP_INDEPENDENT_TARGETS, BICEP_INDEPENDENT_CONFIGS, BICEP_INDEPENDENT_BASELINE,
  BICEP_INDEPENDENT_MANIFEST } from '../../templates/containerapps-dotnet/bicep-independent.js'
import { initializeBicepIndependentSimulation } from '../../templates/containerapps-dotnet/bicep-independent-seed.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { bicepCommandSource } from '../../../lib/az/commands/deployment.js'
import { bicepTargetKey } from '../../../lib/bicep/provenance.js'
import { compileBicepProject } from '../../../lib/bicep/compile.js'
import { previewBicepDeployment } from '../../../lib/bicep/preview.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { foundryEvidenceDependencies } from '../../../lib/simulation/inference.js'

const [primary, staging] = BICEP_INDEPENDENT_CONFIGS
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
const appId = config => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${config.resourceGroup}/providers/Microsoft.App/containerApps/${config.appName}`
const command = (verb, config) => `az deployment group ${verb} --name ${config.deploymentName} --resource-group ${config.resourceGroup} --template-file infra/main.bicep --parameters ${config.parameterPath}`
const file = (path, content) => ({ kind: 'file', path, content })
const shell = line => ({ kind: 'command', line })
const scenario = action => ({ kind: 'scenario', action })
const solution = (...steps) => ({ steps })
const source = (context, config) => bicepCommandSource({ project: context.project }, config.parameterPath)
const sourceMatches = (record, context, config) => !!record && record.parameterPath === config.parameterPath
  && record.target === config.resourceGroup && record.name === config.deploymentName
  && record.sourceHash === source(context, config).sourceHash
  && record.parameterHash === source(context, config).parameterHash
  && canonicalize(record.fileVersions) === canonicalize(source(context, config).fileVersions)
const current = (context, config) => context.runtime.bicep?.currentByTarget?.[bicepTargetKey(config.resourceGroup, config.deploymentName)]
const preview = (context, config) => {
  const item = current(context, config)?.preview
  return sourceMatches(item, context, config) ? item : null
}
const latest = (context, config) => {
  const item = current(context, config)?.latest
  return sourceMatches(item, context, config) ? item : null
}
const successful = (context, config) => {
  const item = latest(context, config)
  return item?.status === 'succeeded' && current(context, config).successful?.id === item.id ? item : null
}
const active = (context, config) => context.runtime.deploymentsByApp[appId(config)]?.active ?? null
const imageArtifact = (context, config) => context.artifacts.publishedTags[config.image.toLowerCase()]
const environment = node => Object.fromEntries(node.body.properties.template.containers[0].env.map(item => [item.name, item.value]))

function graphFor(context, config) {
  const compiled = compileBicepProject(context.project.savedFiles, BICEP_INDEPENDENT_MANIFEST,
    { resourceGroup: { name: config.resourceGroup, location: 'eastus' }, parameterPath: config.parameterPath })
  if (compiled.diagnostics.length) return null
  const graph = compiled.graph
  const resources = graph.order.filter(item => item.kind === 'resource')
  const of = type => resources.filter(item => item.type === type)
  const one = type => of(type).length === 1 ? of(type)[0] : null
  const registry = one('Microsoft.ContainerRegistry/registries')
  const identity = one('Microsoft.ManagedIdentity/userAssignedIdentities')
  const env = one('Microsoft.App/managedEnvironments')
  const account = one('Microsoft.CognitiveServices/accounts')
  const project = one('Microsoft.CognitiveServices/accounts/projects')
  const deployment = one('Microsoft.CognitiveServices/accounts/deployments')
  const app = one('Microsoft.App/containerApps')
  const roles = of('Microsoft.Authorization/roleAssignments')
  if (resources.length !== 9 || !registry || !identity || !env || !account || !project || !deployment || !app
    || roles.length !== 2 || !registry.existing || registry.name !== config.registryName
    || identity.name !== config.identityName || env.name !== config.environmentName
    || account.name !== config.accountName || project.name !== config.projectName
    || deployment.name !== config.modelDeploymentName || app.name !== config.appName
    || !same(project.body.parent?.id, account.armId) || !same(deployment.body.parent?.id, account.armId)
    || !resources.every(item => item.armId.toLowerCase().includes(`/resourcegroups/${config.resourceGroup.toLowerCase()}/`))
    || !same(graph.outputs.appId, appId(config))
    || graph.outputs.foundryEndpoint !== config.endpoint
    || graph.outputs.foundryDeployment !== config.modelDeploymentName) return null
  const appEnv = environment(app)
  const scale = app.body.properties.template.scale
  if (app.body.properties.template.containers[0].image !== config.image
    || appEnv.APP_ENV !== config.appEnvironment || appEnv.FOUNDRY_ENDPOINT !== config.endpoint
    || appEnv.FOUNDRY_DEPLOYMENT !== config.modelDeploymentName
    || scale.minReplicas !== config.minReplicas || scale.maxReplicas !== config.maxReplicas
    || !same(app.body.properties.managedEnvironmentId, env.armId)
    || !same(app.body.properties.configuration.registries[0].server, `${config.registryName}.azurecr.io`)
    || !same(Object.keys(app.body.identity.userAssignedIdentities)[0], identity.armId)
    || roles.map(item => item.body.scope.id.toLowerCase()).sort().join('|') !== [registry.armId, account.armId].map(item => item.toLowerCase()).sort().join('|')) return null
  const proposed = previewBicepDeployment(graph, context.sandbox, context.artifacts, bicepIndependentLab)
  return proposed.diagnostics.length ? null : { graph, operations: proposed.operations }
}

function activeReady(context, config) {
  const app = context.sandbox.containerApps.find(item => same(item.name, config.appName) && same(item.resourceGroup, config.resourceGroup))
  const snapshot = active(context, config)
  const artifact = imageArtifact(context, config)
  return !!app && !!snapshot && snapshot.artifactId === artifact && snapshot.image === config.image
    && snapshot.env?.APP_ENV === config.appEnvironment
    && snapshot.foundry?.endpoint === config.endpoint
    && snapshot.foundry?.deployment === config.modelDeploymentName
    && snapshot.scalePolicy?.minReplicas === config.minReplicas
    && snapshot.scalePolicy?.maxReplicas === config.maxReplicas
    && app.minReplicas === config.minReplicas && app.maxReplicas === config.maxReplicas
    && same(app.registryServer, `${config.registryName}.azurecr.io`)
}

function primaryBaseline(context) {
  const app = context.sandbox.containerApps.find(item => same(item.name, primary.appName)
    && same(item.resourceGroup, primary.resourceGroup))
  const snapshot = active(context, primary)
  const baseline = BICEP_INDEPENDENT_BASELINE
  return activeReady(context, primary) && snapshot.artifactId === baseline.artifactId
    && snapshot.image === baseline.image && snapshot.env.APP_ENV === baseline.appEnvironment
    && snapshot.foundry.endpoint === baseline.endpoint
    && snapshot.foundry.deployment === baseline.modelDeploymentName
    && snapshot.scalePolicy.cpu === baseline.scalePolicy.cpu
    && snapshot.scalePolicy.memory === baseline.scalePolicy.memory
    && app.userAssigned?.toLowerCase().endsWith(`/${baseline.identityName}`.toLowerCase())
    && app.registryServer === `${baseline.registryName}.azurecr.io`
    && context.sandbox.foundryAccounts.some(item => same(item.name, baseline.accountName)
      && same(item.resourceGroup, baseline.target)
      && item.deployments.some(child => same(child.name, baseline.modelDeploymentName)))
}

const noChanges = items => items.length === 9 && items.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))
function previewReady(context, config) {
  const graph = graphFor(context, config), item = preview(context, config)
  return !!graph && !!item
}
function deployed(context, config, noChange = false) {
  const graph = graphFor(context, config), prev = preview(context, config), attempt = successful(context, config)
  return !!graph && previewReady(context, config) && !!attempt && attempt.sequence > prev.sequence
    && canonicalize(attempt.outputs) === canonicalize(graph.graph.outputs)
    && noChanges(graph.operations)
    && (!noChange || noChanges(prev.operations) && noChanges(attempt.operations))
    && activeReady(context, config) && (config !== primary || primaryBaseline(context))
}

function deploymentTuple(context, config) {
  const item = successful(context, config)
  return item ? { target: item.target, name: item.name, parameterPath: item.parameterPath,
    sourceHash: item.sourceHash, parameterHash: item.parameterHash, fileVersions: item.fileVersions,
    status: item.status } : null
}
function proofDependencies(config) {
  const id = appId(config)
  return { [`bicep:source:${config.resourceGroup}`]: context => source(context, config),
    [`bicep:deployment:${config.resourceGroup}`]: context => deploymentTuple(context, config),
    [`bicep:active:${config.resourceGroup}`]: context => {
      const item = active(context, config)
      return item ? { generation: item.generation, artifactId: item.artifactId, image: item.image,
        foundry: item.foundry, env: item.env } : null
    },
    [`bicep:scale:${config.resourceGroup}`]: context => active(context, config)?.scalePolicy ?? null,
    ...foundryEvidenceDependencies(id) }
}
const dependencies = { [primary.parameterPath]: proofDependencies(primary), [staging.parameterPath]: proofDependencies(staging) }
function proof(context, config, taskId) {
  const id = context.evidence.currentEvidenceByTask[taskId]
  const record = context.evidence.experimentsById[id]
  if (!record || record.taskId !== taskId || record.outcome !== 'passed' || record.completed !== true) return null
  const measurements = record.measurements
  if (taskId.endsWith('-request')) {
    if (measurements?.appId !== appId(config) || measurements.method !== 'POST'
      || measurements.path !== '/api/summarize' || measurements.status !== 200
      || measurements.body?.deployment !== config.modelDeploymentName
      || measurements.upstream?.deployment !== config.modelDeploymentName
      || !measurements.upstream?.correlationId
      || !measurements.upstream.attempts?.some(item => item.status === 200
        && item.correlationId === measurements.upstream.correlationId)) return null
  } else if (taskId.endsWith('-load')) {
    if (measurements?.appId !== appId(config) || measurements.endReadyReplicas !== config.maxReplicas
      || measurements.trace?.slice(-15).length !== 15
      || !measurements.trace.slice(-15).every(item => item.offeredThroughput > item.servedThroughput)) return null
  }
  for (const [key, selector] of Object.entries(dependencies[config.parameterPath])) {
    if (canonicalize(record.dependencyValues[key]) !== canonicalize(selector(context))
      || record.dependencyGenerations[key] !== (context.dependencyGenerations[key] ?? 0)) return null
  }
  return record
}
function proofAfter(context, config, taskId) {
  const record = proof(context, config, taskId)
  if (!successful(context, config) || !record) return null
  const secondRequest = config === primary ? proofAfter(context, staging, 'second-request') : null
  const secondLoad = config === primary ? proofAfter(context, staging, 'second-load') : null
  if (config === primary && (!secondRequest || !secondLoad)) return null
  const after = config === primary ? Math.max(secondRequest.sequence, secondLoad.sequence) : 0
  const anchored = context.runtime.bicep.attempts.some(attempt => attempt.status === 'succeeded'
    && sourceMatches(attempt, context, config) && attempt.sequence < record.sequence
    && (config !== primary || noChanges(attempt.operations))
    && context.runtime.bicep.previews.some(item => sourceMatches(item, context, config)
      && item.sequence > after && item.sequence < attempt.sequence
      && (config !== primary || noChanges(item.operations))))
  return anchored ? record : null
}
const secondProof = context => deployed(context, staging)
  && proofAfter(context, staging, 'second-request') && proofAfter(context, staging, 'second-load')
function firstPreviewReady(context) {
  const evidence = secondProof(context), item = preview(context, primary)
  return !!evidence && primaryBaseline(context) && previewReady(context, primary)
    && noChanges(item.operations)
    && item.sequence > Math.max(proof(context, staging, 'second-request').sequence,
      proof(context, staging, 'second-load').sequence)
}
function firstDeployed(context) {
  return firstPreviewReady(context) && deployed(context, primary, true)
    && successful(context, primary).sequence > preview(context, primary).sequence
}

const requestScenario = (config, title) => Object.freeze({ kind: 'foundry', version: 1, appId: appId(config), title,
  request: { method: 'POST', path: '/api/summarize', body: { text: `The ${config.appEnvironment} environment is reproducible.` } },
  faultProfile: { attempts: [] }, expected: { status: 200 } })
const cpuScenario = (config, title) => Object.freeze({ kind: 'cpu', version: 1, appId: appId(config), title,
  durationSeconds: 90, demandCpuSecondsPerSecond: 4, requestCpuSeconds: 0.02,
  assess: measurements => measurements.endReadyReplicas === config.maxReplicas
    && measurements.trace.slice(-15).length === 15
    && measurements.trace.slice(-15).every(item => item.offeredThroughput > item.servedThroughput) })

export const bicepIndependentLab = {
  id: 'aca-bicep-independent', title: 'Adapt one Bicep project to two environments', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 45,
  brief: 'A working primary Bicep stack and two published API images are supplied. Complete the second parameter file, preview and deploy its isolated stack, then prove a named request and CPU behavior. Re-preview and reapply the current shared source to the primary target without changes, then collect fresh primary request and CPU proof. All operations are local simulations.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 15, labMode: 'independent',
  manifestId: BICEP_INDEPENDENT_MANIFEST.id,
  capabilities: { bicepDeployment: true, foundryInference: true, cpuScaling: true },
  bicepTargets: BICEP_INDEPENDENT_TARGETS,
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
  initialProjectFiles: BICEP_INDEPENDENT_INITIAL_FILES,
  initializeSimulation: initializeBicepIndependentSimulation,
  scenarios: Object.freeze({
    'second-request': requestScenario(staging, 'Staging inference request'),
    'second-load': cpuScenario(staging, 'Staging CPU load'),
    'first-request': requestScenario(primary, 'Primary inference request'),
    'first-load': cpuScenario(primary, 'Primary CPU load'),
  }),
  stages: [
    { id: 'second', title: 'Adapt and prove staging', taskIds: ['second-source', 'second-preview', 'second-deploy', 'second-request', 'second-load'] },
    { id: 'first', title: 'Reproduce and prove primary', taskIds: ['first-preview', 'first-deploy', 'first-request', 'first-load'] },
  ],
  tasks: [
    { id: 'second-source', stageId: 'second', text: 'Complete and save the staging parameters for distinct local resources, image, environment and replica bounds.',
      check: context => !!graphFor(context, staging),
      hints: ['Use the supplied staging registry and image with the staging Foundry deployment name.', 'Keep both targets on the same shared Bicep modules.'],
      solution: solution(file(staging.parameterPath, BICEP_INDEPENDENT_SOLUTION_FILES[staging.parameterPath])) },
    { id: 'second-preview', stageId: 'second', text: 'Preview the current staging graph in its declared resource group.',
      check: context => previewReady(context, staging),
      hints: ['What-if must use second.bicepparam and the staging group.', 'The existing Basic registry is ignored; the app stack is created.'],
      solution: solution(shell(command('what-if', staging))) },
    { id: 'second-deploy', stageId: 'second', text: 'Apply the staging graph and inspect its active app, roles and Foundry links.',
      check: context => deployed(context, staging),
      hints: ['Apply the same saved graph you previewed.', 'The staged image must match this account endpoint and deployment.'],
      solution: solution(shell(command('create', staging))) },
    { id: 'second-request', stageId: 'second', text: 'Prove a correlated HTTP 200 from the staging app.',
      check: context => !!proofAfter(context, staging, 'second-request') && deployed(context, staging),
      dependencies: dependencies[staging.parameterPath], verification: { scenarioId: 'second-request', scenarioVersion: 1 },
      hints: ['Use the named staging request in Foundry Request Controls.'],
      solution: solution(scenario({ type: 'request', scenarioId: 'second-request' })) },
    { id: 'second-load', stageId: 'second', text: 'Measure staging CPU scale-out to its declared ceiling under load.',
      check: context => !!proofAfter(context, staging, 'second-load') && deployed(context, staging),
      dependencies: dependencies[staging.parameterPath], verification: { scenarioId: 'second-load', scenarioVersion: 1 },
      hints: ['Run the named staging CPU scenario for its full 90 seconds.'],
      solution: solution(scenario({ type: 'scenario-start', scenarioId: 'second-load' }), scenario({ type: 'simulation-advance', seconds: 90 })) },
    { id: 'first-preview', stageId: 'first', text: 'Preview the primary target from the current shared source after both staging proofs.',
      check: firstPreviewReady,
      hints: ['Use first.bicepparam with the primary group.', 'The current graph should show no changes to the supplied primary stack.'],
      solution: solution(shell(command('what-if', primary))) },
    { id: 'first-deploy', stageId: 'first', text: 'Reapply the current primary graph with a successful no-change deployment.',
      check: firstDeployed,
      hints: ['Apply exactly the graph previewed for primary.', 'A healthy old app is insufficient if shared source can no longer reproduce it.'],
      solution: solution(shell(command('create', primary))) },
    { id: 'first-request', stageId: 'first', text: 'Collect a fresh correlated HTTP 200 from the preserved primary app.',
      check: context => firstDeployed(context) && !!proofAfter(context, primary, 'first-request'),
      dependencies: dependencies[primary.parameterPath], verification: { scenarioId: 'first-request', scenarioVersion: 1 },
      hints: ['Send the named primary request only after the no-change reapply.'],
      solution: solution(scenario({ type: 'request', scenarioId: 'first-request' })) },
    { id: 'first-load', stageId: 'first', text: 'Measure fresh primary CPU behavior under its frozen two-replica ceiling.',
      check: context => firstDeployed(context) && !!proofAfter(context, primary, 'first-load'),
      dependencies: dependencies[primary.parameterPath], verification: { scenarioId: 'first-load', scenarioVersion: 1 },
      hints: ['Run the named primary CPU scenario after the no-change reapply.'],
      solution: solution(scenario({ type: 'scenario-start', scenarioId: 'first-load' }), scenario({ type: 'simulation-advance', seconds: 90 })) },
  ],
}

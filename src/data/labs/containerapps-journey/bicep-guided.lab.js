import { BICEP_GUIDED_MANIFEST, BICEP_GUIDED_INITIAL_FILES, BICEP_GUIDED_SOLUTION_FILES, BICEP_GUIDED_UPDATED_APP } from '../../templates/containerapps-dotnet/bicep-guided-solution.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { bicepCommandSource } from '../../../lib/az/commands/deployment.js'
import { bicepTargetKey } from '../../../lib/bicep/provenance.js'
import { compileBicepProject } from '../../../lib/bicep/compile.js'
import { previewBicepDeployment } from '../../../lib/bicep/preview.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'

const group = 'rg-aca-bicep', name = 'first', registry = 'acrbicepguided', app = 'api-bicep'
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const image = `${registry}.azurecr.io/api:v1`
const key = bicepTargetKey(group, name)
const command = line => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const scenario = (action, instruction) => ({ kind: 'scenario', action, instruction })
const solution = (...steps) => ({ steps })
const base = `az deployment group --name ${name} --resource-group ${group} --template-file infra/main.bicep --parameters infra/first.bicepparam`
const deployment = verb => base.replace('group --name', `group ${verb} --name`)
const show = `az deployment group show --name ${name} --resource-group ${group}`
const bicepFiles = BICEP_GUIDED_MANIFEST.bicepFiles

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-23T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}
function initializeSimulation(run) {
  let seeded = run
  const seedLab = { ...bicepGuidedLab, capabilities: { ...bicepGuidedLab.capabilities, acrBuild: true } }
  for (const line of [
    `az group create -n ${group} -l eastus`,
    `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`,
  ]) {
    const result = applyRunAction(seeded, { type: 'command', line }, seedLab)
    if (result.diagnostics.length || result.lines.some(item => item.kind === 'err'))
      throw new Error(`Bicep Lab seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

function provenance(context) {
  const state = context.runtime.bicep?.currentByTarget?.[key]
  const source = bicepCommandSource({ project: context.project })
  const matches = record => !!record && record.key === key && record.target === group && record.name === name
    && record.sourceHash === source.sourceHash && record.parameterHash === source.parameterHash
    && bicepFiles.every(path => record.fileVersions[path] === source.fileVersions[path])
  return { preview: matches(state?.preview) ? state.preview : null,
    successful: matches(state?.successful) && state.successful.status === 'succeeded' ? state.successful : null,
    latest: matches(state?.latest) ? state.latest : null }
}
function graphFor(context, savedFiles) {
  const compiled = compileBicepProject(savedFiles, BICEP_GUIDED_MANIFEST,
    { resourceGroup: { name: group, location: 'eastus' } })
  if (compiled.diagnostics.length) return null
  const types = compiled.graph.order.filter(item => item.kind === 'resource').map(item => item.type)
  if (types.length !== 9 || !['Microsoft.ContainerRegistry/registries', 'Microsoft.ManagedIdentity/userAssignedIdentities',
    'Microsoft.App/managedEnvironments', 'Microsoft.CognitiveServices/accounts', 'Microsoft.CognitiveServices/accounts/projects',
    'Microsoft.CognitiveServices/accounts/deployments', 'Microsoft.App/containerApps'].every(type => types.includes(type))
    || types.filter(type => type === 'Microsoft.Authorization/roleAssignments').length !== 2) return null
  const preview = previewBicepDeployment(compiled.graph, context.sandbox, context.artifacts)
  return preview.diagnostics.length ? null : { graph: compiled.graph, operations: preview.operations }
}
function currentGraph(context) { return graphFor(context, context.project.savedFiles) }
function sourceReady(context) { return !!graphFor(context, { ...context.project.savedFiles,
  'infra/first.bicepparam': BICEP_GUIDED_SOLUTION_FILES['infra/first.bicepparam'] }) }
function previewReady(context) { return !!currentGraph(context) && !!provenance(context).preview }
function deployed(context) {
  const current = currentGraph(context)
  const { preview, successful } = provenance(context)
  const active = context.runtime.deploymentsByApp[appId]?.active
  return !!current && !!preview && !!successful && !!active && active.artifactId === context.artifacts.publishedTags[image]
    && current.operations.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))
    && foundryInferenceReady(context, appId)
}
function updated(context) { return deployed(context) && context.runtime.deploymentsByApp[appId].active.scalePolicy.maxReplicas === 5 }
function initialAttempt(context) { return context.runtime.bicep?.attempts?.find(item => item.key === key && item.status === 'succeeded'
  && item.operations.some(operation => operation.type === 'Microsoft.App/containerApps' && operation.changeType === 'create')) }
function initialCreated(context) { return !!initialAttempt(context) }
function validated(context) {
  const current = bicepCommandSource({ project: context.project })
  const initial = initialAttempt(context)
  const matches = (item, source) => !!source && item.sourceHash === source.sourceHash && item.parameterHash === source.parameterHash
    && bicepFiles.every(path => item.fileVersions[path] === source.fileVersions[path])
  return !!currentGraph(context) && context.runtime.bicep?.observations?.some(item => item.kind === 'validate' && item.key === key
    && (matches(item, current) || matches(item, initial))) === true
}
function inspected(context) {
  const initial = initialAttempt(context)
  const seen = kind => context.runtime.bicep?.observations?.some(item => item.kind === kind && item.key === key
    && item.attemptId === initial.id && item.sourceHash === initial.sourceHash && item.parameterHash === initial.parameterHash) === true
  return !!initial && seen('show') && seen('app-show')
}
const requestDependencies = { ...foundryEvidenceDependencies(appId), 'bicep:source': context => bicepCommandSource({ project: context.project }) }
const scaleDependencies = {
  'bicep:source': context => bicepCommandSource({ project: context.project }),
  [`deployment:${appId}`]: context => context.runtime.deploymentsByApp[appId]?.active ?? null,
  [`scaling:${appId}`]: context => context.sandbox.containerApps.find(item => item.id?.toLowerCase() === appId.toLowerCase())?.scaleRules ?? null,
}
const load = Object.freeze({ kind: 'cpu', version: 1, appId, title: 'Changed replica ceiling', durationSeconds: 90,
  demandCpuSecondsPerSecond: 4, requestCpuSeconds: 0.02,
  assess: measurements => measurements.endReadyReplicas === 5 && measurements.trace.slice(-15).length === 15
    && measurements.trace.slice(-15).every(item => item.offeredThroughput > item.servedThroughput) })
const request = Object.freeze({ kind: 'foundry', version: 1, appId, title: 'Summarize Bicep deployed API',
  request: { method: 'POST', path: '/api/summarize', body: { text: 'Azure Container Apps deploys a modular Bicep project.' } },
  faultProfile: { attempts: [] }, expected: { status: 200 } })

export const bicepGuidedLab = {
  id: 'aca-bicep-guided', title: 'Deploy a Container App with Bicep', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 35,
  brief: 'Complete the saved modular Bicep project, validate and preview the first environment, then deploy the app. The Basic registry and healthy published Foundry API are supplied. Prove a named request, raise the CPU replica ceiling in source, measure it under load, and redeploy unchanged files. All resource operations and model responses are local teaching simulations.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 13, labMode: 'guided',
  manifestId: BICEP_GUIDED_MANIFEST.id, capabilities: { bicepDeployment: true, foundryInference: true, cpuScaling: true },
  bicepInspect: { resourceGroup: group, deploymentName: name, appName: app },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
  initialProjectFiles: BICEP_GUIDED_INITIAL_FILES, initializeSimulation,
  scenarios: Object.freeze({ valid: request, ceiling: load }),
  stages: [
    { id: 'author', title: 'Author and preview', taskIds: ['connect', 'parameters', 'validate', 'preview'] },
    { id: 'deploy', title: 'Deploy and inspect', taskIds: ['create', 'inspect', 'request'] },
    { id: 'update', title: 'Update and prove', taskIds: ['change', 'refresh-preview', 'update-create', 'load', 'idempotent'] },
  ],
  tasks: [
    { id: 'connect', stageId: 'author', text: 'Complete main.bicep and its five local modules. Link the app to module outputs for identity, environment, existing ACR, Foundry endpoint and deployment; declare exact-scope grants.', check: sourceReady,
      hints: ['The identity and environment modules create resources. The roles module declares the supplied registry as existing.', 'Pass module outputs into the app module. The app must use one UAMI for both image pull and inference.'],
      solution: solution(...bicepFiles.filter(path => path.endsWith('.bicep')).map(path => file(path, BICEP_GUIDED_SOLUTION_FILES[path]))), examNote: 'A literal endpoint or deployment value does not carry the required declared-resource provenance.' },
    { id: 'parameters', stageId: 'author', text: 'Save first.bicepparam with the first environment names and published image tag.', check: context => !!currentGraph(context),
      hints: ['Use `using \'./main.bicep\'` and literal assignments.', 'The supplied image tag is v1 in acrbicepguided.'],
      solution: solution(file('infra/first.bicepparam', BICEP_GUIDED_SOLUTION_FILES['infra/first.bicepparam'])), examNote: 'The parameter file is separate from the source and is bound into each preview and deployment.' },
    { id: 'validate', stageId: 'author', text: 'Validate the saved graph for first deployment in rg-aca-bicep.', check: validated,
      hints: ['Run `az deployment group validate` with explicit name, resource group, template and parameter paths.', 'Validation reports located diagnostics but does not create a preview.'],
      solution: solution(command(deployment('validate'))), examNote: 'Validate catches unsupported syntax and provider shapes before mutation.' },
    { id: 'preview', stageId: 'author', text: 'Run a current what-if and inspect create operations plus the ignored existing ACR.', check: previewReady,
      hints: ['Use `az deployment group what-if` against the same target as validate.', 'A saved edit or different target stales this preview.'],
      solution: solution(command(deployment('what-if'))), examNote: 'What-if records the saved source, parameter versions and exact target.' },
    { id: 'create', stageId: 'deploy', text: 'Create the first deployment and activate the private API after both roles.', check: initialCreated,
      hints: ['Run `az deployment group create` with the same target and files.', 'Creation follows graph dependencies; app activation is last.'],
      solution: solution(command(deployment('create'))), examNote: 'A successful graph apply records source provenance and captures the active app.' },
    { id: 'inspect', stageId: 'deploy', text: 'Inspect the deployment outputs and app, account and role resources.', check: inspected,
      hints: ['Use `az deployment group show` to view the latest attempt.', 'Inspect the account resource endpoint and both role scopes.'],
      solution: solution(command(show), command(`az containerapp show -g ${group} -n ${app}`)), examNote: 'Outputs describe the deployed app and intended inference target.' },
    { id: 'request', stageId: 'deploy', text: 'Send the named successful POST /api/summarize request from the active Bicep deployed app.', check: deployed, dependencies: requestDependencies, verification: { scenarioId: 'valid', scenarioVersion: 1 },
      hints: ['Use Foundry Request Controls and inspect public status plus upstream trace.', 'A CLI-only resource repair cannot replace a current successful Bicep deployment.'],
      solution: solution(scenario({ type: 'request', scenarioId: 'valid' }, 'Send the named valid request in Foundry Request Controls.')), examNote: 'The HTTP 200 proof includes a correlated invocation under the app identity.' },
    { id: 'change', stageId: 'update', text: 'Change the saved app module maxReplicas from 2 to 5.', check: context => currentGraph(context)?.graph.order.find(item => item.type === 'Microsoft.App/containerApps')?.body.properties.template.scale.maxReplicas === 5,
      hints: ['Edit infra/modules/app.bicep, then save it.', 'Keep the CPU utilization rule and all module output links.'],
      solution: solution(file('infra/modules/app.bicep', BICEP_GUIDED_UPDATED_APP)), examNote: 'Saved source, rather than an unsaved draft, drives the update.' },
    { id: 'refresh-preview', stageId: 'update', text: 'Run a new what-if for the changed source and inspect the app modify operation.', check: context => !!provenance(context).preview && currentGraph(context)?.graph.order.find(item => item.type === 'Microsoft.App/containerApps')?.body.properties.template.scale.maxReplicas === 5
      && context.runtime.bicep.previews.some(item => item.key === key && item.operations.some(operation => operation.type === 'Microsoft.App/containerApps' && operation.changeType === 'modify')),
      hints: ['The first preview is stale after a saved file edit.', 'The second preview should show the app as modify.'],
      solution: solution(command(deployment('what-if'))), examNote: 'A fresh preview binds the changed file version.' },
    { id: 'update-create', stageId: 'update', text: 'Apply the previewed update and confirm the active app now has five maximum replicas.', check: updated,
      hints: ['Run create again with the same name and target.', 'The app active snapshot must show maxReplicas 5.'],
      solution: solution(command(deployment('create'))), examNote: 'The active deployment captures the scale policy used by the CPU simulation.' },
    { id: 'load', stageId: 'update', text: 'Run the named 90-second load and observe five ready replicas with unserved overload in the final window.', check: updated, dependencies: scaleDependencies, verification: { scenarioId: 'ceiling', scenarioVersion: 1 },
      hints: ['Start Changed replica ceiling in CPU Experiment Controls.', 'Advance the full 90 seconds, then inspect ready replicas and the last 15 seconds.'],
      solution: solution(scenario({ type: 'scenario-start', scenarioId: 'ceiling' }, 'Start the named CPU load.'), scenario({ type: 'simulation-advance', seconds: 90 }, 'Advance 90 simulated seconds.')),
      examNote: 'Load proves the changed active ceiling; a source edit or create response alone cannot.' },
    { id: 'idempotent', stageId: 'update', text: 'Reapply the unchanged files and inspect a successful no-change attempt while request and load proof remain current.',
      check: context => updated(context) && provenance(context).latest?.status === 'succeeded'
        && provenance(context).latest.operations.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))
        && context.runtime.bicep.attempts.filter(item => item.key === key && item.status === 'succeeded').length >= 3,
      hints: ['Run the same create command again without editing saved files.', 'Inspect no-change operations and rerun the named request if the earlier active deployment changed.'],
      solution: solution(command(deployment('create')), command(show), scenario({ type: 'request', scenarioId: 'valid' }, 'Refresh the named request proof after the scale update.')),
      examNote: 'An unchanged incremental redeploy keeps active behavior and evidence generations stable.' },
  ],
}

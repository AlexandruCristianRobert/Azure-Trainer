import { BICEP_TROUBLESHOOTING_MANIFEST, BICEP_TROUBLESHOOTING_STARTER_FILES,
  BICEP_TROUBLESHOOTING_SOLUTION_FILES, BICEP_TROUBLESHOOTING_DECOY_MAIN,
  BICEP_TROUBLESHOOTING_WRONG_PARAMETER } from '../../templates/containerapps-dotnet/bicep-troubleshooting.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { bicepCommandSource } from '../../../lib/az/commands/deployment.js'
import { bicepTargetKey } from '../../../lib/bicep/provenance.js'
import { compileBicepProject } from '../../../lib/bicep/compile.js'
import { previewBicepDeployment } from '../../../lib/bicep/preview.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'

const group = 'rg-aca-bicep-incident', name = 'first', registry = 'acrbicepincident', app = 'api-bicep-incident'
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const key = bicepTargetKey(group, name)
const command = line => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const scenario = (scenarioId, instruction) => ({ kind: 'scenario', action: { type: 'request', scenarioId }, instruction })
const solution = (...steps) => ({ steps })
const base = `az deployment group --name ${name} --resource-group ${group} --template-file infra/main.bicep --parameters infra/first.bicepparam`
const deployment = verb => base.replace('group --name', `group ${verb} --name`)
const show = `az deployment group show --name ${name} --resource-group ${group}`
const appShow = `az containerapp show --name ${app} --resource-group ${group}`
const bicepFiles = BICEP_TROUBLESHOOTING_MANIFEST.bicepFiles
const sourceFor = (main, parameters, fileVersions = {}) => bicepCommandSource({ project: {
  manifestId: BICEP_TROUBLESHOOTING_MANIFEST.id,
  savedFiles: { ...BICEP_TROUBLESHOOTING_SOLUTION_FILES, 'infra/main.bicep': main, 'infra/first.bicepparam': parameters },
  fileVersions,
} })
const seededWrong = sourceFor(BICEP_TROUBLESHOOTING_STARTER_FILES['infra/main.bicep'], BICEP_TROUBLESHOOTING_WRONG_PARAMETER)

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-23T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}
function initializeSimulation(run) {
  let seeded = run
  const seedLab = { ...bicepTroubleshootingLab, capabilities: { ...bicepTroubleshootingLab.capabilities, acrBuild: true } }
  for (const line of [
    `az group create -n ${group} -l eastus`,
    `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`,
  ]) {
    const result = applyRunAction(seeded, { type: 'command', line }, seedLab)
    if (result.diagnostics.length || result.lines.some(item => item.kind === 'err'))
      throw new Error(`Bicep incident seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

const currentSource = context => bicepCommandSource({ project: context.project })
const matches = (record, source) => !!record && record.key === key && record.target === group && record.name === name
  && record.sourceHash === source.sourceHash && record.parameterHash === source.parameterHash
  && bicepFiles.every(path => record.fileVersions[path] === source.fileVersions[path])
const hasObservation = (context, kind, source, attemptId) => context.runtime.bicep.observations.some(item =>
  item.kind === kind && matches(item, source) && (attemptId === undefined || item.attemptId === attemptId))
const currentRecords = context => {
  const source = currentSource(context)
  const state = context.runtime.bicep.currentByTarget[key] ?? {}
  return { source, preview: matches(state.preview, source) ? state.preview : null,
    successful: matches(state.successful, source) && state.successful.status === 'succeeded' ? state.successful : null }
}
function graphFor(context) {
  const compiled = compileBicepProject(context.project.savedFiles, BICEP_TROUBLESHOOTING_MANIFEST,
    { resourceGroup: { name: group, location: 'eastus' } })
  if (compiled.diagnostics.length) return null
  const preview = previewBicepDeployment(compiled.graph, context.sandbox, context.artifacts, bicepTroubleshootingLab)
  return preview.diagnostics.length ? null : compiled.graph
}
const wrongPreview = context => {
  const record = context.runtime.bicep.incidentPreview
  return !!record && record.key === key && record.parameterHash === seededWrong.parameterHash
    && record.fileVersions['infra/first.bicepparam'] === 0
    && record.operations.some(item => item.type === 'Microsoft.App/managedEnvironments'
      && item.name === 'env-bicep-test' && item.changeType === 'create')
}
const outputRepaired = context => context.runtime.bicep.observations.some(item => item.kind === 'validate' && item.key === key
    && item.parameterHash === seededWrong.parameterHash && item.fileVersions['infra/first.bicepparam'] === 0)
const correctEnvironment = graph => graph?.order.filter(item => item.type === 'Microsoft.App/managedEnvironments').length === 1
  && graph.order.some(item => item.type === 'Microsoft.App/managedEnvironments' && item.name === 'env-bicep-incident')
const correctedPreview = context => correctEnvironment(graphFor(context))
  && !!currentRecords(context).preview && wrongPreview(context)
const initialAttempt = context => context.runtime.bicep.attempts.find(item => item.key === key && item.status === 'succeeded'
  && item.parameterHash === currentSource(context).parameterHash
  && item.operations.some(operation => operation.type === 'Microsoft.App/containerApps' && operation.changeType === 'create'))
const initialInspected = context => {
  const attempt = initialAttempt(context)
  return !!attempt && hasObservation(context, 'show', attempt, attempt.id)
    && hasObservation(context, 'app-show', attempt, attempt.id)
}
const deniedRecord = context => {
  const item = Object.values(context.evidence.experimentsById)
    .filter(candidate => candidate.taskId === 'access-denied')
    .sort((left, right) => right.sequence - left.sequence)[0]
  const attempt = initialAttempt(context)
  const captured = item?.measurements?.bicep
  return !!attempt && !!item && item.taskId === 'access-denied'
  && item.scenarioId === 'access-denied' && item.outcome === 'passed' && item.completed === true
  && item.measurements.status === 502 && item.measurements.diagnosticCode === 'FOUNDRY_ACCESS_DENIED'
  && item.measurements.upstream?.attempts?.length === 0
  && captured?.authoredDecoyRole === true && captured.attemptId === attempt.id
  && captured.target === group && captured.name === name
  && captured.sourceHash === attempt.sourceHash && captured.parameterHash === attempt.parameterHash
  && bicepFiles.every(path => captured.fileVersions[path] === attempt.fileVersions[path]) ? item : null
}
const denied = context => initialInspected(context) && !!deniedRecord(context)
function authoredIdentity(context) {
  const graph = graphFor(context)
  if (!graph) return false
  const resources = graph.order.filter(item => item.kind === 'resource')
  const appNode = resources.find(item => item.type === 'Microsoft.App/containerApps')
  const attachedId = Object.keys(appNode?.body.identity.userAssignedIdentities ?? {})[0]
  const identity = resources.find(item => item.type === 'Microsoft.ManagedIdentity/userAssignedIdentities'
    && item.armId.toLowerCase() === attachedId?.toLowerCase())
  const account = resources.find(item => item.type === 'Microsoft.CognitiveServices/accounts'
    && appNode.bindings.some(binding => binding.source === item.id && binding.property === 'properties.endpoint'
      && binding.via && binding.path.startsWith('/properties/template/containers/0/env/')))
  const role = resources.filter(item => item.type === 'Microsoft.Authorization/roleAssignments'
    && item.body.scope?.id.toLowerCase() === account?.armId.toLowerCase())
  return !!identity && !!account && role.length === 1
    && role[0].body.properties.roleDefinitionId.endsWith('/a97b65f3-24c7-4388-baec-2e87135dc908')
    && role[0].bindings.some(binding => binding.path === '/properties/principalId'
      && binding.source === identity.id && binding.property === 'properties.principalId' && binding.via)
    && role[0].body.properties.principalId === context.sandbox.managedIdentities.find(item => item.id.toLowerCase() === identity.armId.toLowerCase())?.principalId
}
const repairedIdentity = context => {
  const { source, preview, successful } = currentRecords(context)
  return denied(context) && authoredIdentity(context) && correctEnvironment(graphFor(context))
    && !!preview && !!successful
    && hasObservation(context, 'validate', source)
    && hasObservation(context, 'show', source)
    && hasObservation(context, 'app-show', source)
    && !!context.runtime.deploymentsByApp[appId]?.active && foundryInferenceReady(context, appId)
}
const recovered = context => {
  const deniedEvidence = deniedRecord(context)
  const id = context.evidence.currentEvidenceByTask.recovered
  const record = context.evidence.experimentsById[id]
  return repairedIdentity(context) && !!deniedEvidence && !!record
    && deniedEvidence.sequence < record.sequence && record.measurements.status === 200
}
const requestDependencies = { ...foundryEvidenceDependencies(appId), 'bicep:source': currentSource }
const request = (title, expected) => Object.freeze({ kind: 'foundry', version: 1, appId, title,
  request: { method: 'POST', path: '/api/summarize', body: { text: 'A Bicep identity grant controls Foundry access.' } },
  faultProfile: { attempts: [] }, expected })

export const bicepTroubleshootingLab = {
  id: 'aca-bicep-troubleshooting', title: 'Troubleshoot a Bicep Deployment', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 35,
  brief: 'Repair a local Bicep deployment in three stages: a missing module output, a wrong environment parameter, and a valid but miswired Foundry grant. The Basic registry and published API image are supplied. All resource operations and model responses are local teaching simulations.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 14, labMode: 'troubleshooting',
  manifestId: BICEP_TROUBLESHOOTING_MANIFEST.id,
  capabilities: { bicepDeployment: true, bicepIdentityFault: true, foundryInference: true, cpuScaling: true },
  bicepInspect: { resourceGroup: group, deploymentName: name, appName: app },
  bicepIncident: { resourceGroup: group, deploymentName: name, wrongEnvironmentName: 'env-bicep-test',
    parameterHash: seededWrong.parameterHash, parameterVersion: 0 },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
  initialProjectFiles: BICEP_TROUBLESHOOTING_STARTER_FILES, initializeSimulation,
  scenarios: Object.freeze({ 'access-denied': request('Access denied from the attached app identity',
    { status: 502, diagnosticCode: 'FOUNDRY_ACCESS_DENIED' }), recovered: request('Recovered Foundry request', { status: 200 }) }),
  stages: [
    { id: 'validate', title: 'Locate the output error', taskIds: ['repair-output'] },
    { id: 'preview', title: 'Correct the target environment', taskIds: ['wrong-preview', 'correct-preview'] },
    { id: 'diagnose', title: 'Deploy and diagnose identity', taskIds: ['deploy-decoy', 'access-denied'] },
    { id: 'recover', title: 'Repair the grant', taskIds: ['repair-identity', 'recovered'] },
  ],
  tasks: [
    { id: 'repair-output', stageId: 'validate', text: 'Validate the saved Bicep files, locate the missing environment output, repair the reference, and validate again.', check: outputRepaired,
      hints: ['The environment module exports id.', 'The app module input in main.bicep uses a misspelled output name.'],
      solution: solution(file('infra/main.bicep', BICEP_TROUBLESHOOTING_DECOY_MAIN), command(deployment('validate'))),
      examNote: 'A failed validate is visible in Cloud Shell; only a successful validate becomes durable observation evidence.' },
    { id: 'wrong-preview', stageId: 'preview', text: 'Run a read-only what-if and identify the unwanted env-bicep-test environment.', check: wrongPreview,
      hints: ['Run deployment group what-if against the saved first parameter file.', 'Inspect the managed environment create operation; what-if does not change the Sandbox.'],
      solution: solution(command(deployment('what-if'))), examNote: 'The first successful wrong-target preview is preserved as incident evidence.' },
    { id: 'correct-preview', stageId: 'preview', text: 'Change the saved environment parameter to env-bicep-incident and preview the corrected target.', check: correctedPreview,
      hints: ['Edit infra/first.bicepparam, then save it.', 'Run what-if again; the current preview must match every saved file version.'],
      solution: solution(file('infra/first.bicepparam', BICEP_TROUBLESHOOTING_SOLUTION_FILES['infra/first.bicepparam']), command(deployment('what-if'))),
      examNote: 'Preview history proves the wrong target was seen before it was corrected.' },
    { id: 'deploy-decoy', stageId: 'diagnose', text: 'Create the stack and inspect the deployment and app. The role-list command can help reveal the miswire.', check: initialInspected,
      hints: ['Create from the saved files, then run deployment group show and containerapp show.', `Use az role assignment list --scope ${root}/providers/Microsoft.CognitiveServices/accounts/foundrybicepincident to inspect the principal.`],
      solution: solution(command(deployment('create')), command(show), command(appShow)),
      examNote: 'The decoy grant is structurally valid, so deployment succeeds.' },
    { id: 'access-denied', stageId: 'diagnose', text: 'Send the named access-denied request and inspect the 502 Foundry permission error with zero upstream attempts.',
      check: denied, verification: { scenarioId: 'access-denied', scenarioVersion: 1 },
      hints: ['Run the named access-denied scenario from the active app.', 'Compare the app caller identity to the account role principal.'],
      solution: solution(scenario('access-denied', 'Send the named access-denied request.')),
      examNote: 'The request simulator, rather than Bicep validation, diagnoses the runtime grant.' },
    { id: 'repair-identity', stageId: 'recover', text: 'Link the account role to the attached identity module output, then validate, preview, redeploy, and inspect.',
      check: repairedIdentity,
      hints: ['The app and AcrPull already use the intended identity.', 'Change only the Foundry principal input to identity.outputs.principalId; the corrected role has a different GUID.'],
      solution: solution(file('infra/main.bicep', BICEP_TROUBLESHOOTING_SOLUTION_FILES['infra/main.bicep']),
        command(deployment('validate')), command(deployment('what-if')), command(deployment('create')), command(show), command(appShow)),
      examNote: 'A manual CLI grant can enable the request but does not repair the authored graph.' },
    { id: 'recovered', stageId: 'recover', text: 'Send the separate recovered request and prove HTTP 200 after the corrected Bicep deployment.',
      check: recovered, dependencies: requestDependencies, verification: { scenarioId: 'recovered', scenarioVersion: 1 },
      hints: ['Run the named recovered scenario after the corrected deployment.', 'The denied request must precede this successful request.'],
      solution: solution(scenario('recovered', 'Send the named recovered request.')),
      examNote: 'The recovered evidence is bound to the current source, deployment and effective account grant.' },
  ],
}

<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { KNOWLEDGE_FIXTURES } from '../../data/fixtures/aks/knowledge.js'
import { configIncidentEvidenceForPhase, isConfigIncidentFileDraftClean, CONFIG_INCIDENT_PHASES } from '../../lib/kubernetes/config-incidents.js'
import { inspectConnectivity } from '../../lib/kubernetes/connectivity-inspection.js'
import { inspectIntegration, INTEGRATION_PROFILE_LABELS } from '../../lib/kubernetes/integration-inspection.js'
import { inspectProbes } from '../../lib/kubernetes/probe-inspection.js'
import { inspectResources } from '../../lib/kubernetes/resource-inspection.js'
import { inspectRelease } from '../../lib/kubernetes/release-inspection.js'
import { inspectDiagnosis } from '../../lib/kubernetes/diagnosis-inspection.js'
import AksDiagnosisInspection from './AksDiagnosisInspection.vue'
import { connectivityIncidentEvidenceForPhase, isConnectivityIncidentDraftClean, CONNECTIVITY_INCIDENT_PHASES } from '../../lib/kubernetes/connectivity-incidents.js'
import { CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, CONNECTIVITY_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/connectivity-troubleshooting-incidents.js'
import { AI_TROUBLESHOOTING_LAB_ID, INTEGRATION_INCIDENT_PHASES } from '../../data/labs/aks-journey/integration-incidents.js'

const run = useLabRunStore()
const diagnosisRequestId = ref('')
const diagnosisScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-diagnosis'))
const diagnosisInspection = computed(() => {
  if (!run.lab?.capabilities?.kubernetesDiagnostics || !run.behavioralRun) return null
  const target = selectedScenario.value?.target ?? diagnosisScenarios.value[0]?.[1].target ?? (() => {
    const [clusterId, state] = Object.entries(run.behavioralRun.runtime.kubernetes.clusters)[0] ?? []
    const deployment = Object.values(state?.resources ?? {}).find(item => item.kind === 'Deployment')
    return deployment ? { clusterId, namespace: deployment.metadata.namespace, deploymentName: deployment.metadata.name, serviceName: 'assistant-internal' } : null
  })()
  return target ? inspectDiagnosis(run.behavioralRun, { ...target, requestId: diagnosisRequestId.value || undefined }, run.lab) : null
})
async function diagnosisAction(type, scenarioId) {
  error.value = ''; statusMessage.value = 'Checking the declared diagnosis incident.'
  try {
    const result = await run.dispatchBehavioral({ type, scenarioId })
    error.value = result?.effects?.diagnostics?.map(item => item.message).join(' ') ?? ''
    statusMessage.value = error.value || 'Diagnosis incident action recorded.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Diagnosis action failed.' }
}
async function startCapstoneIncident() {
  error.value = ''; statusMessage.value = 'Starting the declared capstone incident.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-capstone-incident' })
    error.value = result?.effects?.diagnostics?.map(item => item.message).join(' ') ?? ''
    statusMessage.value = error.value || 'Declared capstone incident recorded.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Capstone incident could not be started.' }
}
const releaseChoice = ref('')
const releaseScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-release'))
const releaseFinalScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-release-final'))
const releaseMilestones = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-release-milestone'))
const releaseMilestoneChoice = ref('')
const releaseMilestoneEvidence = computed(() => {
  const scenarioId = releaseMilestoneChoice.value || releaseMilestones.value[0]?.[0]
  const task = run.lab?.tasks.find(task => task.verification?.scenarioId === scenarioId)
  const id = run.behavioralRun?.evidence.currentEvidenceByTask[task?.id]
  return id ? run.behavioralRun.evidence.experimentsById[id] : null
})
const releaseTarget = computed(() => releaseScenarios.value.find(([id]) => id === releaseChoice.value)?.[1]?.target ?? releaseScenarios.value[0]?.[1]?.target ?? releaseFinalScenarios.value[0]?.[1]?.target)
const releaseView = computed(() => run.lab?.capabilities?.kubernetesRollouts && releaseTarget.value && run.behavioralRun ? inspectRelease(run.behavioralRun, releaseTarget.value, run.lab) : null)
const releaseActive = computed(() => releaseView.value?.experiment?.status === 'active')
const anyExperimentActive = computed(() => Object.values(run.behavioralRun?.runtime?.kubernetes?.clusters ?? {}).some(state => state.rollouts?.experiment?.status === 'active' || state.health?.experiment?.status === 'active' || ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase)))
watch(releaseScenarios, values => { if (!values.some(([id]) => id === releaseChoice.value)) releaseChoice.value = values[0]?.[0] ?? '' }, { immediate: true })
async function releaseAction(type, value = null) {
  error.value = ''; statusMessage.value = 'Checking release experiment state.'
  const action = type === 'aks-advance' ? { type, seconds: value } : type === 'aks-release-cancel' ? { type } : { type, scenarioId: value ?? releaseView.value?.experiment?.scenarioId ?? releaseChoice.value }
  if (type === 'aks-request' && run.lab?.scenarios[value]?.kind === 'aks-release-milestone') releaseMilestoneChoice.value = value
  try {
    const result = await run.dispatchBehavioral(action)
    error.value = result?.effects?.diagnostics?.map(item => item.message).join(' ') ?? ''
    const experiment = releaseView.value?.experiment
    statusMessage.value = error.value || (type === 'aks-request' ? result?.effects?.lines?.map(line => line.text).join(' ') || 'Final release verification recorded.' : experiment ? `Release ${experiment.scenarioId}: ${experiment.phase}; ${experiment.status}; ${experiment.outcome ?? `${experiment.samples.length} observed samples`}.` : 'Release action recorded.')
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Release action failed.' }
}
const choice = ref('')
const error = ref('')
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-request'))
const probeScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-probe'))
const probeCapable = computed(() => run.lab?.capabilities?.kubernetesProbes === true && probeScenarios.value.length > 0)
const resourcesCapable = computed(() => run.lab?.capabilities?.kubernetesResources === true)
const resourceScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-resource-profile'))
const resourceChoice = ref('')
const resourceTarget = computed(() => resourceScenarios.value.find(([id]) => id === resourceChoice.value)?.[1]?.target ?? resourceScenarios.value[0]?.[1]?.target ?? null)
const resourceInspection = computed(() => resourcesCapable.value && resourceTarget.value && run.behavioralRun ? inspectResources(run.behavioralRun, resourceTarget.value) : null)
const resourceIncident = computed(() => resourceTarget.value ? run.behavioralRun?.runtime?.kubernetes?.clusters?.[resourceTarget.value.clusterId]?.resourcesRuntime?.incident ?? null : null)
const probeChoice = ref('')
const probeTarget = computed(() => probeScenarios.value.find(([id]) => id === probeChoice.value)?.[1]?.target ?? probeScenarios.value[0]?.[1]?.target ?? null)
const probeInspection = computed(() => probeCapable.value && probeTarget.value && run.behavioralRun ? inspectProbes(run.behavioralRun, probeTarget.value) : null)
const integrationCapable = computed(() => run.lab?.capabilities?.kubernetesAiIntegration === true)
const configCapable = computed(() => !integrationCapable.value && run.lab?.capabilities?.kubernetesConfiguration === true && run.lab?.id !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID)
const configIncident = computed(() => run.behavioralRun?.runtime?.kubernetes?.configIncident ?? null)
const configIncidentMessage = computed(() => CONFIG_INCIDENT_PHASES.find(item => item.phase === configIncident.value?.phase)?.message ?? '')
const canContinueIncident = computed(() => !!configIncident.value && configIncident.value.phase !== 'stale'
  && isConfigIncidentFileDraftClean(run.behavioralRun)
  && !!configIncidentEvidenceForPhase(run.behavioralRun, run.lab, configIncident.value.phase))
const connectivityIncident = computed(() => {
  if (run.lab?.id !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID) return null
  return run.behavioralRun?.runtime?.kubernetes?.clusters?.[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]?.connectivity?.incident ?? null
})
const integrationIncident = computed(() => run.lab?.id === AI_TROUBLESHOOTING_LAB_ID ? run.behavioralRun?.runtime?.kubernetes?.integrationIncident ?? null : null)
const integrationIncidentMessage = computed(() => INTEGRATION_INCIDENT_PHASES.find(item => item.phase === integrationIncident.value?.phase)?.phase === 'deployment'
  ? 'Repair the captured embedding deployment and verify recovery before revealing the metadata filter.'
  : integrationIncident.value?.phase === 'filter' ? 'Restore the employee audience and verify the published training row before revealing retry behavior.'
    : 'The throttled-once profile is active. Rebuild and deploy the bounded retry policy.')
const connectivityIncidentMessage = computed(() => CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === connectivityIncident.value?.phase)
  ? ({ selector: 'Observe and repair the internal Service selector fault before advancing.', port: 'Observe and repair the internal targetPort fault before advancing.', dependency: 'Repair PGHOST and restart the assistant Pods, then complete both final route checks.' }[connectivityIncident.value.phase]) : '')
const canIntroduceConnectivityIncident = computed(() => {
  const phase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === connectivityIncident.value?.phase)
  return !!phase?.next && isConnectivityIncidentDraftClean(run.behavioralRun, phase.phase)
    && !!connectivityIncidentEvidenceForPhase(run.behavioralRun, run.lab, 'observations', phase.phase)
    && !!connectivityIncidentEvidenceForPhase(run.behavioralRun, run.lab, 'recoveries', phase.phase)
})
const questionScenarios = computed(() => scenarios.value.filter(([, scenario]) => scenario.request?.method === 'POST' && scenario.request?.path === '/api/ask' && typeof scenario.request?.body?.question === 'string'))
const integrationChoices = computed(() => scenarios.value.filter(([, scenario]) => run.lab?.capabilities?.kubernetesDiagnostics || INTEGRATION_PROFILE_LABELS[scenario.integrationProfile] || scenario.request?.path === '/api/work'))
const canSend = computed(() => integrationCapable.value
  ? integrationChoices.value.some(([id]) => id === choice.value)
  : scenarios.value.some(([id]) => id === choice.value))
const integrationInspection = computed(() => integrationCapable.value && choice.value ? inspectIntegration(run.behavioralRun, run.lab, choice.value) : null)
const fixtureProfiles = computed(() => Object.entries(KNOWLEDGE_FIXTURES.profiles).map(([name, profile]) => ({ name, settings: Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'PGPASSWORD')) })))
const frozenCleanup = computed(() => run.lab?.capabilities?.aksCapstone === true && !!run.behavioralRun?.stages?.cleanupCheckpoint)
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy || frozenCleanup.value)
const capstoneStageLocked = stageId => run.lab?.capabilities?.aksCapstone === true && run.behavioralRun?.stages?.activeStageId !== stageId
const selectedScenario = computed(() => run.lab?.scenarios?.[choice.value] ?? null)
const latestEvidence = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter(record => record.scenarioId === choice.value && record.measurements?.clusterId === selectedScenario.value?.target?.clusterId
    && record.measurements?.namespace === selectedScenario.value?.target?.namespace)
  .sort((a, b) => b.sequence - a.sequence)[0] ?? null)
const connectivityTarget = computed(() => {
  const scenario = selectedScenario.value; const route = scenario?.connectivity
  if (!route || !scenario.target?.clusterId) return null
  if (route.service?.name && route.service?.namespace) return { clusterId: scenario.target.clusterId, namespace: route.service.namespace, serviceName: route.service.name }
  const host = String(route.hostname ?? '').replace(/\.$/, '').split('.')
  return { clusterId: scenario.target.clusterId, namespace: host.length > 1 ? host[1] : scenario.target.namespace, serviceName: host[0] }
})
const connectivityView = computed(() => connectivityTarget.value ? inspectConnectivity(run.behavioralRun, connectivityTarget.value) : null)
const latestRequest = computed(() => connectivityView.value?.requests?.find(item => item.scenarioId === choice.value) ?? null)
const latestLog = computed(() => connectivityView.value?.logs?.find(item => item.requestId === latestRequest.value?.requestId) ?? null)
const diagnosticCommands = computed(() => {
  const scenario = selectedScenario.value; const route = scenario?.connectivity
  if (!route || route.origin?.kind !== 'diagnostic') return []
  const host = route.hostname
  const request = scenario.request
  const url = `http://${host}:${route.port}${request?.path ?? '/api/info'}`
  const commands = [`kubectl exec diagnostics -n diagnostics -- nslookup ${host}`]
  commands.push(request?.method === 'POST'
    ? `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '${JSON.stringify(request.body)}' ${url}`
    : `kubectl exec diagnostics -n diagnostics -- curl -sS ${url}`)
  return commands
})
const statusMessage = ref('')
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}`, () => {
  choice.value = integrationCapable.value ? integrationChoices.value[0]?.[0] ?? '' : scenarios.value[0]?.[0] ?? ''
  probeChoice.value = probeScenarios.value[0]?.[0] ?? ''
  resourceChoice.value = resourceScenarios.value[0]?.[0] ?? ''
  error.value = ''; statusMessage.value = ''
}, { immediate: true })
async function startProbe() {
  if (!probeScenarios.value.some(([id]) => id === probeChoice.value)) return
  error.value = ''; statusMessage.value = 'Starting the controlled probe experiment and recreating its Pods.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-probe-start', scenarioId: probeChoice.value })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The experiment could not start.' : 'Experiment started. Advance simulated time to observe the probes.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The experiment could not start.' }
}
async function startResource() {
  if (!resourceScenarios.value.some(([id]) => id === resourceChoice.value)) return
  error.value = ''; statusMessage.value = 'Starting the declared resource profile. It will warm up from the actual Pod and metric state.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-resource-start', scenarioId: resourceChoice.value })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The resource experiment could not start.' : 'Resource experiment started; advance simulated time to complete warmup.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The resource experiment could not start.' }
}
async function cancelResource() {
  error.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-resource-cancel' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Resource cancellation failed.' : 'Resource experiment cancelled; injected arrivals have stopped.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Resource cancellation failed.' }
}
async function continueResourceIncident() {
  error.value = ''; statusMessage.value = 'Checking the observed recovery before introducing the next resource incident.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-resource-next-incident' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The next resource incident is not ready.' : 'The next controlled resource incident is active.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The next resource incident could not be introduced.' }
}
async function advanceResource(seconds) {
  error.value = ''; statusMessage.value = `Advancing resource simulation by ${seconds} seconds.`
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-advance', seconds })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Time advance failed.' : `Advanced ${seconds} simulated seconds.`
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Time advance failed.' }
}
async function advanceProbe(seconds) {
  error.value = ''; statusMessage.value = `Advancing simulated time by ${seconds} seconds.`
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-advance', seconds })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Time advance failed.' : `Advanced ${seconds} simulated seconds.`
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Time advance failed.' }
}
async function cancelProbe() {
  error.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-probe-cancel' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Cancellation failed.' : 'Experiment cancelled. Its scripted faults have been released.'
  } catch (reason) { error.value = reason.message }
}
async function send(scenarioId = choice.value) {
  const allowed = integrationCapable.value ? integrationChoices.value.some(([id]) => id === scenarioId) : scenarios.value.some(([id]) => id === scenarioId)
  if (!allowed) return
  choice.value = scenarioId
  error.value = ''
  statusMessage.value = 'Sending the declared simulated request.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-request', scenarioId })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Request finished with a diagnostic.' : 'Simulated request completed.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Simulated request failed.' }
}
async function advanceProjection() {
  error.value = ''
  statusMessage.value = 'Advancing AKS simulation by 60 seconds.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-advance', seconds: 60 })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Time advance failed.' : 'Advanced AKS simulation by 60 seconds.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Time advance failed.' }
}
async function continueIncident() {
  error.value = ''
  statusMessage.value = 'Checking the current recovery before revealing the next incident.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-config-next-incident' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The incident did not advance.' : 'The next simulated configuration incident is ready.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The incident did not advance.' }
}
async function introduceConnectivityIncident() {
  error.value = ''
  statusMessage.value = 'Checking the current Service recovery before introducing the next fault.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-connectivity-next-incident' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The connectivity fault was not introduced.' : 'The next connectivity fault was introduced and applied.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The connectivity fault was not introduced.' }
}
async function introduceIntegrationIncident() {
  error.value = ''; statusMessage.value = 'Checking the current assistant failure and recovery before revealing the next incident.'
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-integration-next-incident' })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'The assistant incident did not advance.' : 'The next assistant incident is ready.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'The assistant incident did not advance.' }
}
const dataCosmosCapable = computed(() => run.lab?.capabilities?.dataCosmos === true)
const dataPostgresCapable = computed(() => run.lab?.capabilities?.dataPostgres === true)
const dataScenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'data-request' || scenario.kind === 'data-worker' || (dataPostgresCapable.value && scenario.kind === 'data-load')))
const dataChoice = ref('')
watch(dataScenarios, values => { if (!values.some(([id]) => id === dataChoice.value)) dataChoice.value = values[0]?.[0] ?? '' }, { immediate: true })
const dataTask = computed(() => run.lab?.tasks?.find(task => task.verification?.scenarioId === dataChoice.value))
const dataEvidence = computed(() => {
  const id = dataTask.value && run.behavioralRun?.evidence.currentEvidenceByTask[dataTask.value.id]
  return id ? run.behavioralRun.evidence.experimentsById[id] : null
})
const postgresCalls = computed(() => (dataEvidence.value?.measurements?.calls ?? []).filter(call => typeof call.sql === 'string'))
const postgresRows = computed(() => {
  const measurements = dataEvidence.value?.measurements
  if (Array.isArray(measurements?.value)) return measurements.value.slice(0, 5)
  return postgresCalls.value.at(-1)?.rows?.slice(0, 5) ?? []
})
const postgresLatency = computed(() => postgresCalls.value.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0))
const postgresMode = computed(() => dataEvidence.value?.measurements?.mode ?? postgresCalls.value.at(-1)?.connection ?? 'unavailable')
async function sendData(scenarioId = dataChoice.value) {
  const scenario = run.lab?.scenarios?.[scenarioId]
  if (!scenario) return
  dataChoice.value = scenarioId
  error.value = ''
  statusMessage.value = 'Sending the declared simulated data request.'
  try {
    const result = await run.dispatchBehavioral({ type: scenario.kind, scenarioId })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
    statusMessage.value = error.value ? 'Request finished with a diagnostic.' : 'Simulated data request completed.'
  } catch (reason) { error.value = reason.message; statusMessage.value = 'Simulated data request failed.' }
}
async function copyLogCommand(command) {
  try { await navigator.clipboard.writeText(command); statusMessage.value = 'Supported log command copied.' }
  catch { statusMessage.value = 'Select and copy the displayed log command.' }
}
</script>

<template>
  <section class="experiment-tool" aria-label="AKS experiment controls">
    <header><h2>{{ run.lab?.capabilities?.kubernetesRollouts ? 'Observe and verify a release' : 'Verify a Kubernetes service' }}</h2><p>Requests use the current Service and the Pods' captured image. {{ run.lab?.capabilities?.kubernetesRollouts ? 'Advance simulated time explicitly to observe rolling updates.' : 'Results transition immediately because this is a simulation.' }}</p></header>
    <p v-if="frozenCleanup" role="status">Cleanup checkpoint frozen. Experiment controls are read-only; use the Lab Panel for the two cleanup Verify tasks. Only reads, deletes, and cleanup verification are permitted.</p>
    <section v-if="run.lab?.capabilities?.kubernetesDiagnostics" aria-label="AKS diagnosis controls">
      <h3>Diagnosis observation and recovery</h3>
      <p>Each Verify control runs its declared request and records evidence for its own Task.</p>
      <div v-if="run.lab?.capabilities?.aksCapstone" class="experiment-tool__controls">
        <button type="button" class="btn" :disabled="locked || capstoneStageLocked('incident') || !!diagnosisInspection?.incident || anyExperimentActive" @click="startCapstoneIncident">Start declared capstone incident</button>
      </div>
      <template v-else>
        <div v-for="[id] in diagnosisScenarios" :key="id" class="experiment-tool__controls">
          <button type="button" class="btn" :disabled="locked || !!diagnosisInspection?.incident" :aria-label="`Start diagnosis incident: ${id}`" @click="diagnosisAction('aks-diagnosis-start', id)">Start diagnosis incident</button>
          <button type="button" class="btn" :disabled="locked || !diagnosisInspection?.incident?.active" :aria-label="`Advance diagnosis incident: ${id}`" @click="diagnosisAction('aks-diagnosis-next', id)">Continue after recovery</button>
        </div>
        <button v-for="[id] in scenarios" :key="id" type="button" class="btn" :disabled="locked" :aria-label="`Verify diagnosis case: ${id}`" @click="send(id)">Verify {{ id }}</button>
      </template>
      <AksDiagnosisInspection v-if="diagnosisInspection" :inspection="diagnosisInspection" :selected-id="diagnosisRequestId" @select="diagnosisRequestId = $event" />
    </section>
    <div v-if="scenarios.length && !run.lab?.capabilities?.kubernetesDiagnostics" class="experiment-tool__controls">
      <label>{{ integrationCapable ? 'Question and fixture profile' : 'Declared verification' }}<select v-model="choice" :disabled="locked || !(integrationCapable ? integrationChoices : scenarios).length"><option v-for="[id, scenario] in (integrationCapable ? integrationChoices : scenarios)" :key="id" :value="id">{{ integrationCapable && scenario.request.path !== '/api/work' ? `${INTEGRATION_PROFILE_LABELS[scenario.integrationProfile]} · ${scenario.request.body.question}` : `${scenario.request?.method ?? 'GET'} ${scenario.request?.path ?? id}` }}</option></select></label>
      <button class="btn btn--primary" type="button" :disabled="locked || !canSend" @click="send()">Send simulated request</button>
    </div>
    <section v-if="run.lab?.capabilities?.kubernetesRollouts" class="aks-probe-controls" aria-label="AKS release experiments">
      <h3>Release traffic and recovery</h3>
      <p>Start captures the current release. Requests use the external Service and choose the smallest eligible Pod UID; the table inventories every ready backend. Observed samples describe this simulation's traffic.</p>
      <div class="experiment-tool__controls">
        <label>Release scenario<select v-model="releaseChoice" aria-label="Release scenario" :disabled="locked || releaseActive"><option v-for="[id] in releaseScenarios" :key="id" :value="id">{{ id }}</option></select></label>
        <button type="button" class="btn btn--primary" aria-label="Start release experiment" :disabled="locked || capstoneStageLocked('release') || anyExperimentActive || !releaseChoice" @click="releaseAction('aks-release-start', releaseChoice)">Start release experiment</button>
        <button type="button" class="btn" aria-label="Finish release experiment" :disabled="locked || !releaseActive" @click="releaseAction('aks-release-finish')">Finish release experiment</button>
        <button type="button" class="btn" aria-label="Cancel release experiment" :disabled="locked || !releaseActive" @click="releaseAction('aks-release-cancel')">Cancel release experiment</button>
      </div>
      <p role="status" aria-live="polite">{{ releaseView?.experiment ? `${releaseView.experiment.scenarioId}: ${releaseView.experiment.phase}; ${releaseView.experiment.status}; ${releaseView.experiment.samples.length} observed sample(s). ${releaseView.experiment.outcome ?? releaseView.experiment.cancellationReason ?? ''}` : 'No release experiment has started.' }}</p>
      <p v-if="releaseView?.summary">Revision {{ releaseView.summary.currentRevision }}: updated {{ releaseView.summary.updated }}, ready {{ releaseView.summary.ready }}, available {{ releaseView.summary.available }}, unavailable {{ releaseView.summary.unavailable }}, terminating {{ releaseView.summary.terminating }}. {{ releaseView.summary.complete ? 'Rollout complete.' : 'Rollout incomplete.' }}</p>
      <p v-if="releaseView">Saved/live objects: {{ releaseView.savedLiveMismatch ? 'mismatch; repair and reapply the saved manifests.' : 'match.' }}</p>
      <div class="experiment-tool__controls"><button v-for="seconds in [1, 15, 60]" :key="seconds" type="button" class="btn" :aria-label="`Advance release simulation by ${seconds} seconds`" :disabled="locked" @click="releaseAction('aks-advance', seconds)">Advance {{ seconds }}s</button><button v-for="[id] in releaseFinalScenarios" :key="id" type="button" class="btn" :disabled="locked" :aria-label="`Verify final release: ${id}`" @click="releaseAction('aks-request', id)">Verify final release</button></div>
      <div v-if="releaseMilestones.length" class="experiment-tool__controls" aria-label="Release milestone verification"><button v-for="[id] in releaseMilestones" :key="id" type="button" class="btn" :aria-label="`Verify release milestone: ${id}`" :disabled="locked" @click="releaseAction('aks-request', id)">Verify {{ id }}</button></div>
      <section v-if="releaseMilestones.length" aria-label="Release milestone evidence"><h4>Release milestone evidence</h4><template v-if="releaseMilestoneEvidence"><p>{{ releaseMilestoneEvidence.scenarioId }}: {{ releaseMilestoneEvidence.outcome }}. {{ releaseMilestoneEvidence.measurements.reason }}</p><pre>{{ JSON.stringify(releaseMilestoneEvidence.measurements.proof, null, 2) }}</pre></template><p v-else>Select the named Verify control to inspect its observed version, artifact and dependency proof.</p></section>
      <h4>Observed samples</h4>
      <div class="aks-probe-controls__table"><table><thead><tr><th scope="col">Time</th><th scope="col">Transport / HTTP</th><th scope="col">Answer / sources / release</th><th scope="col">Selected Pod</th><th scope="col">Available</th><th scope="col">Backend artifacts</th></tr></thead><tbody><tr v-for="sample in releaseView?.experiment?.samples ?? []" :key="sample.requestId"><th scope="row">{{ sample.atMs / 1000 }}s</th><td>{{ sample.transport.ok ? `HTTP ${sample.status}` : sample.transport.reason }}</td><td>{{ sample.answer ?? 'No answer' }}<br>{{ sample.sources.join(', ') || 'No sources' }} · {{ sample.release ?? 'No release field' }}</td><td>{{ sample.podUid ?? 'none' }}</td><td>{{ sample.rollout.available }}</td><td><div v-for="backend in sample.backends" :key="backend.podUid">{{ backend.podUid }} · revision {{ backend.revision }} · {{ backend.artifactId }} · {{ backend.digest }}</div></td></tr></tbody></table></div>
      <p>Inspect history, Pod events, and rollout status in the shell. Final proof requires current saved build files, matching applied manifests, and a witnessed reapply followed by rollout restart.</p>
    </section>
    <section v-if="probeCapable" class="aks-probe-controls" aria-label="AKS health probe experiments">
      <h3>Health probe timeline</h3>
      <p>Starting an experiment recreates the target Pods before the simulated clock advances. Their new containers begin cold. Probe schedules are deterministic teaching simulations; production timing can vary.</p>
      <div class="experiment-tool__controls">
        <label>Declared experiment<select v-model="probeChoice" :disabled="locked || !!probeInspection?.experiment"><option v-for="[id, scenario] in probeScenarios" :key="id" :value="id">{{ scenario.title ?? id }}</option></select></label>
        <button type="button" class="btn btn--primary" :disabled="locked || capstoneStageLocked('resilience') || !!probeInspection?.experiment || !probeChoice" @click="startProbe">Start experiment (recreates Pods)</button>
        <button v-if="probeInspection?.experiment" type="button" class="btn" :disabled="locked" @click="cancelProbe">Cancel experiment</button>
      </div>
      <p v-if="probeInspection?.experiment" role="status">{{ probeInspection.experiment.scenarioId }} is {{ probeInspection.experiment.phase ?? probeInspection.experiment.status ?? 'running' }}. Started at {{ probeInspection.experiment.startedAtMs / 1000 }}s; deadline {{ (probeInspection.experiment.deadlineAtMs ?? probeInspection.experiment.endsAtMs ?? 0) / 1000 }}s.</p>
      <p v-else>No probe experiment is active. Select a declared scenario to begin a fresh cold start.</p>
      <div class="experiment-tool__controls"><button v-for="seconds in [1, 5, 10]" :key="seconds" type="button" class="btn" :disabled="locked" @click="advanceProbe(seconds)">Advance {{ seconds }}s</button></div>
      <p v-if="probeInspection?.readyBackendCount !== undefined">Ready Service backends: {{ probeInspection.readyBackendCount }}</p>
      <div v-if="probeInspection?.containers?.length" class="aks-probe-controls__table"><table><thead><tr><th scope="col">Pod / container</th><th scope="col">Age</th><th scope="col">Initialized</th><th scope="col">Ready</th><th scope="col">Restarts</th><th scope="col">Next checks</th><th scope="col">Next start</th></tr></thead><tbody>
        <tr v-for="item in probeInspection.containers" :key="item.podUid"><th scope="row">{{ item.podName }}<br><small>{{ item.containerId }}</small></th><td>{{ Math.max(0, Math.floor(((run.behavioralRun?.runtime?.simTimeMs ?? 0) - item.startedAtMs) / 1000)) }}s</td><td>{{ (run.behavioralRun?.runtime?.simTimeMs ?? 0) >= item.initializedAtMs ? 'Yes' : 'No' }}</td><td>{{ item.ready ? 'Yes' : 'No' }}</td><td>{{ item.restartCount }}</td><td><span v-for="(check, type) in item.checks" :key="type">{{ type }}: {{ check ? `${(check.pending?.completeAtMs ?? check.nextAtMs ?? 0) / 1000}s` : 'off' }}<br></span></td><td>{{ item.restartAtMs == null ? '—' : `${item.restartAtMs / 1000}s` }}</td></tr>
      </tbody></table></div>
      <p v-if="probeInspection?.sourceVersion">Captured image: <code>{{ probeInspection.sourceVersion.image }}</code>; source version: <code>{{ probeInspection.sourceVersion.sourceHash }}</code>.</p>
      <ul v-if="probeInspection?.receipts?.some(item => item.scenarioId)"><li v-for="(receipt, index) in probeInspection.receipts.filter(item => item.scenarioId).slice(-5)" :key="`${receipt.scenarioId}:${index}`">{{ receipt.scenarioId }}: {{ receipt.outcome ?? receipt.status }}</li></ul>
      <ul v-if="probeInspection?.containers?.some(item => item.restartReason)"><li v-for="item in probeInspection.containers.filter(item => item.restartReason)" :key="item.podUid">{{ item.podName }}: {{ item.restartReason }}<span v-if="item.restartAtMs !== null">; next container start at {{ item.restartAtMs / 1000 }}s</span>.</li></ul>
      <p>Inspect current Pod names first: <code>kubectl get pods -n assistant</code>. Then use <code>kubectl describe pod POD_NAME -n assistant</code>, <code>kubectl logs POD_NAME -n assistant</code>, or <code>kubectl logs POD_NAME -n assistant --previous</code>. Previous logs exist only after a container restart.</p>
    </section>
    <section v-if="resourcesCapable && resourceScenarios.length" class="aks-probe-controls" aria-label="AKS resource experiments">
      <h3>Resource and autoscaling timeline</h3>
      <p>Profiles use supplied workload fixtures and the explicit cluster clock. Warmup waits for actual ready Pods and complete 15-second metric windows; starting never recreates Pods, forces replicas, or resets HPA history.</p>
      <div class="experiment-tool__controls">
        <label>Resource profile<select v-model="resourceChoice" aria-label="Resource profile" :disabled="locked || !!resourceInspection?.experiment && ['warming', 'running'].includes(resourceInspection.experiment.phase)"><option v-for="[id, scenario] in resourceScenarios" :key="id" :value="id">{{ scenario.profileId }}</option></select></label>
        <button type="button" class="btn btn--primary" aria-label="Start resource profile" :disabled="locked || capstoneStageLocked('resilience') || !resourceChoice || ['warming', 'running'].includes(resourceInspection?.experiment?.phase)" @click="startResource">Start resource profile</button>
        <button v-if="['warming', 'running'].includes(resourceInspection?.experiment?.phase)" type="button" class="btn" aria-label="Cancel resource profile" :disabled="locked" @click="cancelResource">Cancel resource profile</button>
      </div>
      <p v-if="resourceInspection?.experiment" role="status">{{ resourceInspection.experiment.profileId }} is {{ resourceInspection.experiment.phase }}<template v-if="resourceInspection.experiment.phase === 'warming'">; waiting for {{ resourceInspection.experiment.requiredReadyReplicas }} ready Pod(s) with complete metrics.</template><template v-else-if="resourceInspection.experiment.phase === 'complete'">; outcome {{ resourceInspection.experiment.outcome }}.</template><template v-else-if="resourceInspection.experiment.phase === 'cancelled'">; cancelled: {{ resourceInspection.experiment.cancellationReason }}.</template></p>
      <p v-else>No resource experiment is active. Select a declared profile to begin warmup.</p>
      <div class="experiment-tool__controls" aria-label="Resource simulation time controls"><button v-for="seconds in [1, 15, 60]" :key="seconds" type="button" class="btn" :aria-label="`Advance resource simulation by ${seconds} seconds`" :disabled="locked" @click="advanceResource(seconds)">Advance {{ seconds }}s</button></div>
      <div v-if="resourceIncident" class="aks-config-controls__incident" aria-label="Staged resource incident"><p>Current resource incident: {{ resourceIncident.phase }}</p><button type="button" class="btn" :disabled="locked || resourceIncident.phase === 'hpa'" @click="continueResourceIncident">Continue to next resource incident</button></div>
      <p>CPU values are supplied simulator millicores: delivered and throttled are instantaneous, while <code>kubectl top</code> reports completed 15-second averages. Memory is a 15-second peak. Unknown means no completed eligible window; it is not idle zero. No Metrics Server installation is required.</p>
      <p>Supported examples: <code>kubectl get hpa -n assistant</code>, <code>kubectl describe deployment assistant -n assistant</code>, <code>kubectl top pods -n assistant</code>, <code>kubectl top nodes</code>, and <code>kubectl scale deployment/assistant --replicas 3 -n assistant</code>.</p>
      <div v-if="resourceInspection" class="aks-probe-controls__table"><table><thead><tr><th scope="col">Pod</th><th scope="col">State / node</th><th scope="col">Requests / limits</th><th scope="col">CPU now</th><th scope="col">Latest metric</th><th scope="col">OOM</th></tr></thead><tbody><tr v-for="pod in resourceInspection.pods" :key="pod.uid"><th scope="row">{{ pod.name }}</th><td>{{ pod.phase }} / {{ pod.nodeName ?? pod.schedulingReason ?? 'unassigned' }}</td><td>{{ pod.resources?.authored?.cpuRequest ?? 'none' }} / {{ pod.resources?.authored?.cpuLimit ?? 'none' }} CPU<br>{{ pod.resources?.authored?.memoryRequest ?? 'none' }} / {{ pod.resources?.authored?.memoryLimit ?? 'none' }} memory</td><td>delivered {{ pod.cpuDeliveredM ?? 'unknown' }}m<br>throttled {{ pod.cpuThrottledM ?? 'unknown' }}m</td><td>{{ pod.metrics?.at(-1) ? `${pod.metrics.at(-1).cpuAverageM}m / ${Math.round(pod.metrics.at(-1).memoryPeakBytes / 1024 / 1024)}Mi; ${Math.round(pod.metrics.at(-1).ageSeconds)}s old` : '<unknown>' }}</td><td>{{ pod.oomCount }}<span v-if="pod.containerTerminations?.length"> · {{ pod.containerTerminations.at(-1).reason }}</span></td></tr></tbody></table></div>
    </section>
    <section v-if="connectivityView" class="aks-connectivity-trace" aria-labelledby="aks-connectivity-trace-title">
      <h3 id="aks-connectivity-trace-title">Request path trace</h3>
      <p v-if="connectivityTarget">Service: {{ connectivityTarget.namespace }}/{{ connectivityTarget.serviceName }} · {{ connectivityView.service?.spec?.type ?? 'not present' }} · ClusterIP {{ connectivityView.service?.spec?.clusterIP ?? 'not assigned' }}<template v-if="connectivityView.service?.status?.loadBalancer?.ingress?.[0]?.ip"> · external {{ connectivityView.service.status.loadBalancer.ingress[0].ip }}</template></p>
      <p v-if="diagnosticCommands.length">Diagnostic Pod: diagnostics/diagnostics in namespace diagnostics. Supported commands:</p>
      <ul v-if="diagnosticCommands.length"><li v-for="command in diagnosticCommands" :key="command"><code>{{ command }}</code></li></ul>
      <p v-if="latestRequest"><strong>Request {{ latestRequest.requestId }}</strong> · <span>{{ latestRequest.transport.ok ? 'Transport succeeded' : `Transport failed: ${latestRequest.transport.reason}` }}</span> · <span>{{ latestRequest.status == null ? 'No HTTP response' : `HTTP ${latestRequest.status}` }}</span></p>
      <ol v-if="latestRequest" class="aks-connectivity-trace__hops"><li v-for="hop in latestRequest.trace" :key="hop.name"><strong>{{ hop.name }}</strong><span>{{ hop.status }}</span><small v-if="hop.detail">{{ hop.detail }}</small></li></ol>
      <p v-else>No request trace has been recorded for this Service.</p>
      <div v-if="latestRequest?.logsCommand" class="aks-connectivity-trace__log"><span v-if="latestLog">Application log recorded for request {{ latestRequest.requestId }}</span><span v-else>No application handler log was recorded for request {{ latestRequest.requestId }}. Pod logs:</span><code>{{ latestLog?.command ?? latestRequest.logsCommand }}</code><button type="button" class="btn" @click="copyLogCommand(latestLog?.command ?? latestRequest.logsCommand)">Copy kubectl logs command</button></div>
      <p>Routing, addresses and responses are deterministic training simulations. No network packet, DNS server, load balancer or dependency service runs.</p>
    </section>
    <section v-if="integrationCapable && integrationInspection" class="aks-integration-inspection" aria-label="Assistant integration inspection">
      <h3>Question and fixture profile</h3>
      <p><strong>{{ integrationInspection.profile?.label }}</strong> · {{ integrationInspection.question }}</p>
      <p v-if="!integrationInspection.hasTrace">No request trace has been recorded for this declared scenario.</p>
      <template v-else>
        <p>Input: {{ integrationInspection.validation.disposition }} · HTTP {{ integrationInspection.validation.status ?? 'no response' }}. Vector: {{ integrationInspection.vector.dimension ?? 'unknown' }} dimensions · {{ integrationInspection.vector.provenance ?? 'no provenance' }}.</p>
        <h4>Bound retrieval values</h4><dl class="aks-integration-inspection__bindings"><template v-for="[key, value] in Object.entries(integrationInspection.bindings)" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl>
        <h4>Ranked documents, context and sources</h4><p>Ranked: <span v-for="(item, index) in integrationInspection.rankedDocuments" :key="item.id">{{ index ? ', ' : '' }}{{ item.id }} · distance {{ item.distance ?? 'unavailable' }}</span><span v-if="!integrationInspection.rankedDocuments.length">none</span></p>
        <p>Context IDs: {{ integrationInspection.contextIds.join(', ') || 'none' }} · Source IDs: {{ integrationInspection.sourceIds.join(', ') || 'none' }}</p>
        <h4>Dependency attempts · request time {{ integrationInspection.elapsedMs ?? 0 }} ms</h4><div class="aks-integration-inspection__operations"><article v-for="operation in integrationInspection.operations" :key="operation.name"><strong>{{ operation.name }}</strong><span>{{ operation.status }}</span><ol v-if="operation.attempts.length"><li v-for="attempt in operation.attempts" :key="attempt.attemptNumber">Attempt {{ attempt.attemptNumber }} · {{ attempt.durationMs }} ms<span v-if="attempt.waitMs"> · wait {{ attempt.waitMs }} ms</span><span v-if="attempt.errorCode"> · {{ attempt.errorCode }}</span></li></ol><small v-else>No attempts</small></article></div>
      </template>
    </section>
    <section v-if="configCapable" class="aks-config-controls" aria-label="Configuration fixture controls">
      <h3>Supplied assistant profiles</h3>
      <div class="aks-config-controls__profiles"><article v-for="profile in fixtureProfiles" :key="profile.name"><h4>{{ profile.name }}</h4><dl><template v-for="[key, value] in Object.entries(profile.settings)" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl></article></div>
      <h3>Ask a supplied question</h3>
      <div class="experiment-tool__controls"><button v-for="[id, scenario] in questionScenarios" :key="id" class="btn" type="button" :disabled="locked" :aria-label="`Send declared question: ${scenario.request.body.question} (${id})`" @click="send(id)">{{ scenario.request.body.question }}</button></div>
      <p>Environment changes take effect in replacement Pods after a restart. Mounted files may update after projection, and the application may need to reread them.</p>
      <button type="button" class="btn" :disabled="locked" aria-label="Advance the AKS simulation by 60 seconds" @click="advanceProjection">Advance 60 simulated seconds</button>
      <div v-if="configIncident" class="aks-config-controls__incident" aria-label="Staged configuration incident">
        <p>Current incident: {{ configIncident.phase }}</p>
        <p>{{ configIncidentMessage }}</p>
        <button type="button" class="btn" :disabled="locked || !canContinueIncident" @click="continueIncident">Continue to next configuration incident</button>
      </div>
    </section>
    <section v-if="connectivityIncident" class="aks-connectivity-controls" aria-label="Staged connectivity incident">
      <h3>Controlled connectivity incidents</h3>
      <p>Current phase: {{ connectivityIncident.phase }}. {{ connectivityIncidentMessage }}</p>
      <button type="button" class="btn" :disabled="locked || !canIntroduceConnectivityIncident" @click="introduceConnectivityIncident">Introduce next connectivity fault</button>
    </section>
    <section v-if="integrationIncident" class="aks-connectivity-controls" aria-label="Staged assistant incident">
      <h3>Controlled assistant incidents</h3>
      <p>Current phase: {{ integrationIncident.phase }}. {{ integrationIncidentMessage }}</p>
      <button type="button" class="btn" :disabled="locked || integrationIncident.phase === 'retry'" @click="introduceIntegrationIncident">Introduce next assistant fault</button>
    </section>
    <section v-if="dataCosmosCapable" class="aks-probe-controls" aria-label="Cosmos DB experiment controls">
      <h3>Cosmos DB requests</h3>
      <p>Requests run against the captured assistant-api/feedback-worker image. RU charges are simulated estimates.</p>
      <div v-if="dataScenarios.length" class="experiment-tool__controls">
        <label>Declared verification<select v-model="dataChoice" :disabled="locked"><option v-for="[id] in dataScenarios" :key="id" :value="id">{{ id }}</option></select></label>
        <button class="btn btn--primary" type="button" :disabled="locked || !dataChoice" @click="sendData()">Send simulated request</button>
      </div>
      <p v-else class="experiment-tool__empty">This Lab has no declared Cosmos DB verification scenarios.</p>
      <section class="experiment-tool__response">
        <h3>Latest Cosmos DB result</h3>
        <p v-if="!dataEvidence">No request has been recorded for this declared verification.</p>
        <template v-else>
          <strong>HTTP {{ dataEvidence.measurements.status }}</strong>
          <p>RU charge per call <small>(Simulated estimate — not an Azure guarantee.)</small></p>
          <ul><li v-for="(call, index) in dataEvidence.measurements.calls" :key="index">{{ call.call }} on {{ call.container }}: {{ call.charge }} RU{{ call.stale ? ' (stale)' : '' }}</li></ul>
          <p>Total charge: {{ dataEvidence.measurements.totalCharge }} RU <small>(Simulated estimate — not an Azure guarantee.)</small></p>
          <p>Stale: {{ dataEvidence.measurements.stale ? 'Yes' : 'No' }}</p>
          <pre>{{ JSON.stringify(dataEvidence.measurements.value, null, 2) }}</pre>
        </template>
      </section>
    </section>
    <section v-if="dataPostgresCapable" class="aks-probe-controls" aria-label="PostgreSQL experiment controls">
      <h3>PostgreSQL requests and load</h3>
      <p>Run a declared scenario against the current Service and its captured image. Load uses the Deployment's current replica count.</p>
      <div v-if="dataScenarios.length" class="experiment-tool__controls">
        <label>Declared verification<select v-model="dataChoice" :disabled="locked"><option v-for="[id, scenario] in dataScenarios" :key="id" :value="id">{{ id }}{{ scenario.kind === 'data-load' ? ' (load)' : '' }}</option></select></label>
        <button class="btn btn--primary" type="button" :disabled="locked || !dataChoice" @click="sendData()">Run simulated scenario</button>
      </div>
      <p v-else class="experiment-tool__empty">This Lab has no declared PostgreSQL verification scenarios.</p>
      <section class="experiment-tool__response" aria-label="Latest PostgreSQL result">
        <h3>Latest PostgreSQL result</h3>
        <p>Simulated estimate — not an Azure guarantee.</p>
        <p v-if="!dataEvidence">Run a declared scenario to inspect its rows, query plan and connection behavior.</p>
        <template v-else>
          <strong>Status: HTTP {{ dataEvidence.measurements.status }}</strong>
          <p v-if="dataEvidence.measurements.error" role="status">{{ dataEvidence.measurements.error.code }}: {{ dataEvidence.measurements.error.message }}</p>
          <p>Request latency: {{ postgresLatency.toFixed(2) }} ms. Connection mode: {{ postgresMode }}.</p>
          <ul v-if="postgresCalls.length"><li v-for="(call, index) in postgresCalls" :key="index">Query plan: {{ call.plan?.node ?? 'No plan' }}<template v-if="call.plan?.index"> ({{ call.plan.index }})</template>. Latency: {{ (call.latencyMs ?? 0).toFixed(2) }} ms.<template v-if="call.plan?.index && /hnsw|ivfflat/.test(call.plan.node ?? '')"> Recall: {{ ((call.recall ?? call.plan.recall ?? 0) * 100).toFixed(1) }}%.</template></li></ul>
          <h4>Rows (first 5)</h4>
          <div v-if="postgresRows.length" class="aks-postgres-results"><table><thead><tr><th scope="col">ID</th><th scope="col">Document</th><th scope="col">Metadata</th></tr></thead><tbody><tr v-for="(row, index) in postgresRows" :key="index"><td>{{ row.id ?? 'unavailable' }}</td><td>{{ row.document_id ?? row.id ?? 'unavailable' }}</td><td>{{ JSON.stringify(row.metadata ?? { product: row.product, version: row.version, language: row.language }) }}</td></tr></tbody></table></div>
          <p v-else>No rows returned.</p>
          <template v-if="dataEvidence.measurements.served != null">
            <h4>Load results</h4>
            <dl class="aks-postgres-load"><dt>Served / failed</dt><dd>{{ dataEvidence.measurements.served }} / {{ dataEvidence.measurements.failed }}</dd><dt>p95 latency</dt><dd>{{ dataEvidence.measurements.p95Ms.toFixed(2) }} ms</dd><dt>Throughput</dt><dd>{{ dataEvidence.measurements.throughputRps.toFixed(2) }} requests/s</dd><dt>Peak server connections</dt><dd>{{ dataEvidence.measurements.peakServerConnections }}</dd><dt>Replicas / pool maximum</dt><dd>{{ dataEvidence.measurements.replicas ?? 'unavailable' }} / {{ dataEvidence.measurements.poolMaxSize ?? 'none' }}</dd></dl>
            <ul v-if="dataEvidence.measurements.errors?.length" aria-label="Load errors"><li v-for="message in dataEvidence.measurements.errors" :key="message">{{ message }}</li></ul>
          </template>
          <pre>{{ JSON.stringify(dataEvidence.measurements.value, null, 2) }}</pre>
        </template>
      </section>
    </section>
    <p v-if="!scenarios.length && !probeScenarios.length && !resourceScenarios.length && !releaseScenarios.length && !releaseFinalScenarios.length && !releaseMilestones.length && !dataScenarios.length" class="experiment-tool__empty">This Lab has no declared Kubernetes verification scenarios.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="statusMessage" role="status" aria-live="polite">{{ statusMessage }}</p>
    <section v-if="!dataCosmosCapable && !dataPostgresCapable" class="experiment-tool__response"><h3>Latest result</h3><p v-if="!latestEvidence">No request has been recorded for this declared verification.</p><template v-else><p v-if="latestEvidence.measurements?.transport">Transport: {{ latestEvidence.measurements.transport.ok ? 'Succeeded' : `Failed (${latestEvidence.measurements.transport.reason})` }}</p><strong v-if="latestEvidence.measurements?.status != null">HTTP {{ latestEvidence.measurements?.status }}</strong><p v-else>No HTTP response was received.</p><p v-if="latestEvidence.measurements?.diagnosticCode" role="status">Diagnostic: {{ latestEvidence.measurements.diagnosticCode }}</p><pre>{{ JSON.stringify(latestEvidence.measurements?.body, null, 2) }}</pre><p>Evidence: {{ latestEvidence.id }} · {{ latestEvidence.outcome }}</p><template v-if="latestEvidence.measurements?.dependencyTrace?.length"><h4>Redacted operation trace</h4><pre>{{ JSON.stringify(latestEvidence.measurements.dependencyTrace, null, 2) }}</pre></template></template></section>
  </section>
</template>

<style scoped>
.aks-postgres-results { overflow-x: auto; }
.aks-postgres-results table { width: 100%; border-collapse: collapse; text-align: left; }
.aks-postgres-results th, .aks-postgres-results td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
.aks-postgres-load { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(0, 1fr); gap: 6px 12px; max-width: 560px; }
.aks-postgres-load dd { margin: 0; }
.aks-probe-controls { margin: 22px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-probe-controls > p { max-width: 78ch; line-height: 1.5; }
.aks-probe-controls__table { max-width: 100%; overflow-x: auto; }
.aks-probe-controls__table table { width: 100%; min-width: 700px; border-collapse: collapse; text-align: left; }
.aks-probe-controls__table th, .aks-probe-controls__table td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.aks-probe-controls__table small { color: var(--text-2); font-weight: 400; }
.aks-config-controls { margin: 22px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-config-controls h3 { margin: 0 0 10px; font-size: 15px; }
.aks-config-controls h3:not(:first-child) { margin-top: 18px; }
.aks-config-controls__profiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.aks-config-controls__profiles article { padding: 12px; border-left: 2px solid var(--accent); background: var(--surface); }
.aks-config-controls__profiles h4 { margin: 0 0 8px; text-transform: capitalize; }
.aks-config-controls__profiles dl { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 1.3fr); gap: 4px 10px; margin: 0; font-size: 12px; }
.aks-config-controls__profiles dt { color: var(--text-dim); }
.aks-config-controls__profiles dd { margin: 0; overflow-wrap: anywhere; }
.aks-config-controls > p { max-width: 70ch; line-height: 1.5; }
.aks-config-controls__incident { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }
.aks-config-controls__incident p { margin: 0 0 8px; text-transform: capitalize; }
.aks-connectivity-trace { margin: 22px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-connectivity-controls { margin: 22px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-connectivity-controls h3 { margin: 0 0 10px; font-size: 15px; }
.aks-connectivity-controls p { max-width: 70ch; line-height: 1.5; }
.aks-integration-inspection { margin: 22px 0; padding: 16px; border: 1px solid var(--border); background: var(--surface-subtle, var(--surface)); }
.aks-integration-inspection h3 { margin: 0 0 10px; }
.aks-integration-inspection h4 { margin: 16px 0 8px; }
.aks-integration-inspection__bindings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin: 0; }
.aks-integration-inspection__bindings dt { color: var(--text-2); }
.aks-integration-inspection__bindings dd { margin: 0; overflow-wrap: anywhere; }
.aks-integration-inspection__operations { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.aks-integration-inspection__operations article { min-width: 0; padding: 10px; background: var(--surface); overflow-wrap: anywhere; }
.aks-integration-inspection__operations article > * { display: block; margin-bottom: 4px; }
.aks-integration-inspection__operations ol { padding-left: 20px; }
@media (max-width: 520px) { .aks-integration-inspection__bindings { grid-template-columns: 1fr; } }
.aks-connectivity-trace > p { max-width: 80ch; line-height: 1.5; }
.aks-connectivity-trace code { overflow-wrap: anywhere; }
.aks-connectivity-trace__hops { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; padding: 0; list-style: none; }
.aks-connectivity-trace__hops li { display: grid; gap: 4px; min-width: 0; padding: 10px; border-left: 3px solid var(--border); background: var(--surface); overflow-wrap: anywhere; }
.aks-connectivity-trace__hops li span { font-weight: 600; }
.aks-connectivity-trace__log { display: grid; justify-items: start; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border); }
.aks-connectivity-trace__log code { max-width: 100%; }
@media (max-width: 760px) { .aks-connectivity-trace__hops { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .aks-connectivity-trace__hops { grid-template-columns: 1fr; } }
</style>

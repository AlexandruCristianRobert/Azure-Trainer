<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { KNOWLEDGE_FIXTURES } from '../../data/fixtures/aks/knowledge.js'
import { configIncidentEvidenceForPhase, isConfigIncidentFileDraftClean, CONFIG_INCIDENT_PHASES } from '../../lib/kubernetes/config-incidents.js'
import { inspectConnectivity } from '../../lib/kubernetes/connectivity-inspection.js'

const run = useLabRunStore()
const choice = ref('')
const error = ref('')
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-request'))
const configCapable = computed(() => run.lab?.capabilities?.kubernetesConfiguration === true)
const configIncident = computed(() => run.behavioralRun?.runtime?.kubernetes?.configIncident ?? null)
const configIncidentMessage = computed(() => CONFIG_INCIDENT_PHASES.find(item => item.phase === configIncident.value?.phase)?.message ?? '')
const canContinueIncident = computed(() => !!configIncident.value && configIncident.value.phase !== 'stale'
  && isConfigIncidentFileDraftClean(run.behavioralRun)
  && !!configIncidentEvidenceForPhase(run.behavioralRun, run.lab, configIncident.value.phase))
const questionScenarios = computed(() => scenarios.value.filter(([, scenario]) => scenario.request?.method === 'POST' && scenario.request?.path === '/api/ask' && typeof scenario.request?.body?.question === 'string'))
const fixtureProfiles = computed(() => Object.entries(KNOWLEDGE_FIXTURES.profiles).map(([name, profile]) => ({ name, settings: Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'PGPASSWORD')) })))
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy)
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
const latestRequest = computed(() => connectivityView.value?.requests?.[0] ?? null)
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
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}`, () => { choice.value = scenarios.value[0]?.[0] ?? ''; error.value = ''; statusMessage.value = '' }, { immediate: true })
async function send(scenarioId = choice.value) {
  if (!scenarioId) return
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
async function copyLogCommand(command) {
  try { await navigator.clipboard.writeText(command); statusMessage.value = 'Supported log command copied.' }
  catch { statusMessage.value = 'Select and copy the displayed log command.' }
}
</script>

<template>
  <section class="experiment-tool" aria-label="AKS experiment controls">
    <header><h2>Verify a Kubernetes service</h2><p>Requests use the current Service and the Pods' captured image. Results transition immediately because this is a simulation.</p></header>
    <div class="experiment-tool__controls">
      <label>Declared verification<select v-model="choice" :disabled="locked || !scenarios.length"><option v-for="[id, scenario] in scenarios" :key="id" :value="id">{{ scenario.request?.method ?? 'GET' }} {{ scenario.request?.path ?? id }}</option></select></label>
      <button class="btn btn--primary" type="button" :disabled="locked || !choice" @click="send">Send simulated request</button>
    </div>
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
    <p v-if="!scenarios.length" class="experiment-tool__empty">This Lab has no declared Kubernetes verification scenarios.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="statusMessage" role="status" aria-live="polite">{{ statusMessage }}</p>
    <section class="experiment-tool__response"><h3>Latest result</h3><p v-if="!latestEvidence">No request has been recorded for this declared verification.</p><template v-else><p v-if="latestEvidence.measurements?.transport">Transport: {{ latestEvidence.measurements.transport.ok ? 'Succeeded' : `Failed (${latestEvidence.measurements.transport.reason})` }}</p><strong v-if="latestEvidence.measurements?.status != null">HTTP {{ latestEvidence.measurements?.status }}</strong><p v-else>No HTTP response was received.</p><p v-if="latestEvidence.measurements?.diagnosticCode" role="status">Diagnostic: {{ latestEvidence.measurements.diagnosticCode }}</p><pre>{{ JSON.stringify(latestEvidence.measurements?.body, null, 2) }}</pre><p>Evidence: {{ latestEvidence.id }} · {{ latestEvidence.outcome }}</p><template v-if="latestEvidence.measurements?.dependencyTrace?.length"><h4>Redacted operation trace</h4><pre>{{ JSON.stringify(latestEvidence.measurements.dependencyTrace, null, 2) }}</pre></template></template></section>
  </section>
</template>

<style scoped>
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

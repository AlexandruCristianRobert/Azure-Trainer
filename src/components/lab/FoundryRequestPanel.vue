<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { evaluateLab } from '../../lib/labEngine/evaluate.js'

const run = useLabRunStore()
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, item]) => item.kind === 'foundry'))
const choice = ref('')
const error = ref('')
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}`, () => {
  const records = Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  const latest = records.filter((record) => scenarios.value.some(([id]) => id === record.scenarioId))
    .sort((a, b) => b.sequence - a.sequence)[0]
  choice.value = latest?.scenarioId ?? scenarios.value[0]?.[0] ?? ''
  error.value = ''
}, { immediate: true })
const fixture = computed(() => run.lab?.scenarios?.[choice.value] ?? null)
const active = computed(() => run.behavioralRun?.runtime?.deploymentsByApp?.[fixture.value?.appId]?.active ?? null)
const contract = computed(() => active.value?.appSpec?.foundry ?? null)
const activeContract = computed(() => contract.value
  ? `${contract.value.method ?? 'POST'} ${contract.value.path} · ${contract.value.inputField} → ${contract.value.outputField}`
  : `${fixture.value?.request?.path === '/api/brief' ? 'Brief' : 'Foundry'} route is not active`)
const inputField = computed(() => contract.value?.inputField ?? Object.keys(fixture.value?.request?.body ?? {})[0] ?? '')
const inputValue = computed(() => fixture.value?.request?.body?.[inputField.value])
const formatMs = (value) => `${Number(value ?? 0).toLocaleString('en-US')} ms`
function faultDescription(scenario) {
  const attempts = scenario.faultProfile?.attempts ?? []
  if (!attempts.length) return scenario.request?.body?.[Object.keys(scenario.request?.body ?? {})[0]]?.trim()
    ? 'No upstream fault injected.' : 'Blank input is validated before inference. No upstream fault injected.'
  return attempts.map((attempt, index) => `Attempt ${index + 1}: upstream ${attempt.status}${attempt.durationMs ? ` over ${formatMs(attempt.durationMs)}` : ''}${attempt.retryAfterSeconds === undefined ? '' : `; Retry-After ${attempt.retryAfterSeconds} s`}`).join(' · ')
}
const account = computed(() => run.sandbox.foundryAccounts?.find((item) => item.id.toLowerCase() ===
  run.behavioralRun?.runtime?.deploymentsByApp?.[fixture.value?.appId]?.active?.foundry?.accountId?.toLowerCase())
  ?? run.sandbox.foundryAccounts?.[0] ?? null)
const caller = computed(() => run.sandbox.managedIdentities?.find((item) => item.id.toLowerCase() === active.value?.foundry?.identityId?.toLowerCase()) ?? null)
const selectedRecord = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter((record) => record.scenarioId === choice.value && record.measurements?.method === 'POST')
  .sort((a, b) => b.sequence - a.sequence)[0] ?? null)
const selectedTask = computed(() => evaluateLab(run.lab, run.behavioralRun).tasks.find((task) => task.verification?.scenarioId === choice.value))
const response = computed(() => selectedRecord.value?.measurements ?? null)
const elapsedMs = computed(() => selectedRecord.value ? selectedRecord.value.endedAtMs - selectedRecord.value.startedAtMs : 0)
const capturedBudgetMs = computed(() => (selectedRecord.value?.dependencyValues?.deployment?.foundry?.timeoutSeconds
  ?? active.value?.foundry?.timeoutSeconds ?? 10) * 1000)
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.behavioralRun?.completedAt || !!run.storageError || run.busy)
async function send() {
  error.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'request', scenarioId: choice.value })
    const diagnostics = result?.effects?.diagnostics ?? []
    if (diagnostics.length) error.value = diagnostics.map((item) => item.message).join(' ')
  } catch (reason) { error.value = reason.message }
}
</script>

<template>
  <section class="foundry-request" aria-label="Foundry Request Controls">
    <header><h3>Foundry Request Controls</h3><p>Local simulation. No Azure or model call is made.</p></header>
    <div class="foundry-request__config">
      <p class="foundry-request__contract"><strong>Active contract</strong> {{ activeContract }}</p>
      <p><strong>Account resource endpoint</strong> {{ active?.foundry?.endpoint || account?.endpoint || 'Not configured' }}</p>
      <p><strong>Project endpoint</strong> {{ account?.projects?.[0]?.endpoint || 'No project' }} <span>(management only)</span></p>
      <p><strong>Deployment</strong> {{ active?.foundry?.deployment || 'Not configured' }} <span>· simulated gpt-5-mini / 2025-08-07 / GlobalStandard</span></p>
      <p><strong>Caller identity</strong> {{ caller?.name || 'No matching identity' }} <span>· client {{ active?.foundry?.clientId || 'None' }} · principal {{ active?.foundry?.principalId || 'None' }}</span></p>
      <p><strong>Token scope</strong> {{ active?.foundry?.tokenScope || 'Not captured' }} <span>· SDK retries {{ active?.foundry?.sdkRetries ?? 'Not captured' }}</span></p>
      <p><strong>Active retry policy</strong> {{ active?.foundry?.maxAttempts ?? 'Not captured' }} total attempts <span>· {{ active?.foundry?.timeoutSeconds ?? '—' }} s overall · {{ active?.foundry?.attemptTimeoutSeconds ?? '—' }} s per attempt · honor Retry-After {{ active?.foundry?.honorRetryAfter === true ? 'on' : 'off' }}</span></p>
    </div>
    <div class="foundry-request__controls">
      <label>Named request<select v-model="choice"><option v-for="[id, scenario] in scenarios" :key="id" :value="id">{{ scenario.title }}</option></select></label>
      <button type="button" class="btn btn--primary" :disabled="locked || !fixture" @click="send">Send named POST</button>
    </div>
    <div class="foundry-request__fixtures" aria-label="Named local simulation fixtures">
      <p>Named fixtures have fixed input and faults. Task targets apply at the intended incident stage; the actual response depends on the active deployment. Select a fixture to send it.</p>
      <ul><li v-for="[id, scenario] in scenarios" :key="id" :class="{ 'foundry-request__fixture--selected': id === choice }">
        <strong>{{ scenario.title }}</strong><span>{{ faultDescription(scenario) }}</span>
        <span>Task target at its intended stage: HTTP {{ scenario.expected.status }}{{ scenario.expected.diagnosticCode ? ` · ${scenario.expected.diagnosticCode}` : '' }}</span>
      </li></ul>
    </div>
    <p v-if="fixture" class="foundry-request__input"><strong>Named request {{ fixture.request.method }} {{ fixture.request.path }}</strong> · Input {{ inputField }}: <code>{{ JSON.stringify(inputValue) }}</code></p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="foundry-request__result" aria-live="polite">
      <h4>Public response</h4>
      <p v-if="!response">No named request sent yet.</p>
      <template v-else><p><strong>HTTP {{ response.status }}</strong> · Local simulation · {{ response.observation === 'diagnostic' ? 'Diagnostic observation' : 'Response observation' }}</p>
        <p v-if="response.diagnosticCode"><strong>Diagnostic code</strong> <code>{{ response.diagnosticCode }}</code></p>
        <p class="foundry-request__payload-label">{{ response.status >= 400 ? 'Public error body' : 'Public body' }}</p>
        <pre>{{ JSON.stringify(response.body, null, 2) }}</pre></template>
      <p v-if="selectedRecord && !selectedTask?.done">Historical verification: the captured dependencies changed or this attempt did not pass.</p>
      <h4>Upstream attempts</h4>
      <p v-if="!response">Run the fixture to inspect the correlated trace.</p>
      <template v-else>
        <p class="foundry-request__trace-meta">Correlation <code>{{ response.upstream?.correlationId }}</code> · Caller principal <code>{{ response.upstream?.principalId || 'None' }}</code> · Deployment <code>{{ response.upstream?.deployment || 'None' }}</code></p>
        <p v-if="!response.upstream?.attempts?.length">Zero upstream invocations.</p>
        <template v-else>
        <p>Budget consumed {{ formatMs(elapsedMs) }} of {{ formatMs(capturedBudgetMs) }} · {{ response.upstream.attempts.length }} upstream attempt{{ response.upstream.attempts.length === 1 ? '' : 's' }}</p>
        <div class="foundry-request__trace" role="region" aria-label="Correlated upstream trace" tabindex="0">
          <table><thead><tr><th scope="col">Attempt</th><th scope="col">Upstream status</th><th scope="col">Account</th><th scope="col">Deployment</th><th scope="col">Caller principal</th><th scope="col">Duration</th><th scope="col">Retry-After fixture</th><th scope="col">Delay after</th></tr></thead>
            <tbody><tr v-for="attempt in response.upstream.attempts" :key="attempt.number"><td>{{ attempt.number }}</td><td>{{ attempt.status }}</td><td>{{ attempt.accountId }}</td><td>{{ attempt.deployment }}</td><td>{{ attempt.principalId }}</td><td>{{ formatMs(attempt.durationMs) }}</td><td>{{ fixture?.faultProfile?.attempts?.[attempt.number - 1]?.retryAfterSeconds === undefined ? '—' : `${fixture.faultProfile.attempts[attempt.number - 1].retryAfterSeconds} s` }}</td><td>{{ formatMs(attempt.delayAfterMs) }}</td></tr></tbody></table>
        </div>
        </template>
      </template>
    </div>
  </section>
</template>

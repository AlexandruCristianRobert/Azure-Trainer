<script setup>
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { skillAreaById } from '../../data/skillAreas.js'
import { SERVICES } from '../../data/services.js'
import { formatDuration } from '../../lib/format.js'
import FluentIcon from '../icons/FluentIcon.vue'
import TaskRow from './TaskRow.vue'
import LabCompletePanel from './LabCompletePanel.vue'
import { encodeRunExport } from '../../lib/labEngine/export.js'
import { evaluateLab } from '../../lib/labEngine/evaluate.js'
import { inspectAksCapstone } from '../../lib/kubernetes/capstone/inspection.js'

const run = useLabRunStore()
const portal = usePortalStore()
const briefOpen = ref(true)
const menuOpen = ref(false)
const menuWrapEl = ref(null)
const openNotes = ref(new Set())

function onDocClick(e) {
  if (menuWrapEl.value?.contains(e.target)) return
  menuOpen.value = false
}
function onDocKeydown(e) {
  if (e.key === 'Escape') menuOpen.value = false
}
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onDocKeydown)
  } else {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKeydown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onDocKeydown)
})
const area = computed(() => skillAreaById(run.lab.skillAreaId))
const service = computed(() => SERVICES[run.lab.service])
const pct = computed(() => (run.total ? (run.doneCount / run.total) * 100 : 0))

// When a Task ticks, open its Exam Note and collapse the others (design shows one open).
watch(() => run.taskStates.map((t) => t.done).join(','), (now, before) => {
  const nowArr = now.split(','), beforeArr = (before ?? '').split(',')
  const justDone = run.taskStates.filter((t, i) => nowArr[i] === 'true' && beforeArr[i] !== 'true')
  if (justDone.length) openNotes.value = new Set([justDone[justDone.length - 1].id])
})

function toggleNote(id) {
  const s = new Set(openNotes.value)
  s.has(id) ? s.delete(id) : s.add(id)
  openNotes.value = s
}
function stateOf(t, stage) { return t.done ? 'done' : isCapstone.value
  ? stage?.status === 'Active' && stage.tasks.find(task => !task.done)?.id === t.id ? 'current' : 'pending'
  : t.id === run.currentTaskId || t.status === 'needs-verification' ? 'current' : 'pending' }
const capstone = computed(() => run.lab?.capabilities?.acaCapstone === true ? run.behavioralRun : null)
const aksCapstone = computed(() => run.lab?.capabilities?.aksCapstone === true && run.behavioralRun
  ? inspectAksCapstone(toRaw(run.behavioralRun), run.lab) : null)
const isCapstone = computed(() => !!capstone.value || !!aksCapstone.value)
const sealed = computed(() => capstone.value?.stages?.sealedStages ?? [])
const panelTasks = computed(() => capstone.value ? evaluateLab(run.lab, capstone.value).tasks : run.taskStates)
const stages = computed(() => aksCapstone.value?.stages ?? (run.lab?.stages ?? []).map((stage, index) => ({ ...stage, index,
  tasks: panelTasks.value.filter((task) => stage.taskIds.includes(task.id)),
  seal: sealed.value[index] ?? null,
  status: !capstone.value ? 'Open' : sealed.value[index] ? 'Sealed'
    : capstone.value.stages?.activeStageId === stage.id ? 'Active' : 'Locked',
})))
const activeStage = computed(() => stages.value.find(stage => stage.status === 'Active'))
const canAdvance = computed(() => aksCapstone.value ? aksCapstone.value.canAdvance : !!activeStage.value && activeStage.value.tasks.every(task => task.done)
  && !run.behavioralRun?.runtime?.activeScenario)
const incident = computed(() => capstone.value?.runtime?.incident ?? null)
const incidentLog = computed(() => capstone.value?.runtime?.logs?.findLast(item => item.code === 'CAPSTONE_INCIDENT_INJECTED') ?? null)
const checkpoint = computed(() => capstone.value?.stages?.cleanupCheckpoint ?? null)
const ownedGroups = computed(() => capstone.value?.stages?.ownedGroups ?? [])
const latestBuild = computed(() => Object.values(capstone.value?.artifacts?.buildsById ?? {}).at(-1) ?? null)
const activeDeployment = computed(() => Object.values(capstone.value?.runtime?.deploymentsByApp ?? {})
  .find(item => item.active)?.active ?? null)
const errorMessage = ref('')
async function stageAction(type) {
  try {
    errorMessage.value = ''
    const settled = await run.dispatchBehavioral({ type })
    const diagnostics = settled?.effects?.diagnostics ?? []
    if (diagnostics.length) errorMessage.value = diagnostics.map(item => item.message).join(' ')
  } catch (error) { errorMessage.value = error.message }
}
async function verifyAksTask(task) {
  if (!aksCapstone.value || !activeStage.value?.taskIds.includes(task.id) || !task.verification?.scenarioId) return
  if (aksCapstone.value.cleanup.frozen && !['cleanup-app', 'cleanup-cloud'].includes(task.id)) return
  try {
    errorMessage.value = ''
    const settled = await run.dispatchBehavioral({ type: 'aks-request', scenarioId: task.verification.scenarioId })
    const diagnostics = settled?.effects?.diagnostics ?? []
    if (diagnostics.length) errorMessage.value = diagnostics.map(item => item.message).join(' ')
  } catch (error) { errorMessage.value = error.message }
}
async function assistance(method, taskId) { try { await run[method](taskId) } catch (error) { errorMessage.value = error.message } }
async function recovery(method) { try { errorMessage.value = ''; await run[method]() } catch (error) { errorMessage.value = error.message } }
async function reloadWithConfirm() {
  if (run.unsaved && !window.confirm('Reload this Lab and discard unsaved changes? Export data or retry saving first if you want to keep them.')) return
  await recovery('reload')
}
function exportData() {
  try {
    const data = encodeRunExport(run.exportRun())
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `${run.labId}-recovery.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (error) { errorMessage.value = error.message }
}
async function recoverRestart() {
  if (!window.confirm(`Restart only ${run.lab.title}? Existing Lab Results are kept.`)) return
  await recovery('recoverRestart')
}
async function restart() {
  menuOpen.value = false
  await nextTick()
  if (window.confirm('Restart this Lab? The Sandbox and the Cloud Shell history will be reset. Past Lab Results are kept.')) {
    try { await run.restart(); openNotes.value = new Set(); errorMessage.value = '' }
    catch (error) { errorMessage.value = error.message }
  }
}
</script>

<template>
  <aside class="lab-panel" :class="{ 'lab-panel--collapsed': portal.labPanelCollapsed }" aria-label="Lab Panel">
    <template v-if="portal.labPanelCollapsed">
      <button type="button" class="lab-panel__expand" aria-label="Expand Lab Panel" @click="portal.toggleLabPanel()"><FluentIcon name="chevron-right" :size="14" /></button>
      <div class="lab-panel__rail-label">Lab · {{ run.doneCount }}/{{ run.total }}</div>
    </template>
    <template v-else-if="run.isComplete"><LabCompletePanel :error="errorMessage" @restart="restart" /><section v-if="aksCapstone" class="lab-panel__capstone-result" aria-label="Capstone sealed stages"><h3>Sealed stages</h3><ol><li v-for="stage in stages" :key="stage.id">{{ stage.title }} · {{ stage.status }} · {{ stage.evidenceMode }} evidence</li></ol><p>Cleanup checkpoint {{ aksCapstone.cleanup.checkpoint ? 'sealed' : 'pending' }} · {{ aksCapstone.cleanup.remaining.length }} owned resources remaining</p><h3>Retained release and incident receipts</h3><ol><li v-for="stage in stages.filter(item => ['release', 'incident'].includes(item.id))" :key="stage.id"><strong>{{ stage.title }}</strong><ul><li v-for="proof in stage.proofs" :key="proof.id">{{ proof.evidenceId }} · {{ proof.observation.outcome }} · {{ proof.artifacts.length }} selected artifacts · {{ proof.targets.length }} captured targets</li></ul></li></ol></section><section v-else-if="capstone" class="lab-panel__capstone-result" aria-label="Capstone sealed stages"><h3>Sealed stages</h3><ol><li v-for="stage in stages" :key="stage.id">{{ stage.title }} · {{ stage.status }}</li></ol><p>Cleanup checkpoint {{ checkpoint ? 'sealed' : 'pending' }} · {{ ownedGroups.length }} owned {{ ownedGroups.length === 1 ? 'group' : 'groups' }} recorded</p></section></template>
    <template v-else>
      <div class="lab-panel__header">
        <div class="lab-panel__title-row">
          <div class="lab-panel__title">{{ run.lab.title }}</div>
          <div ref="menuWrapEl" class="lab-panel__menu-wrap">
            <button type="button" class="lab-panel__more" aria-label="Lab options" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><FluentIcon name="more-horizontal" :size="16" /></button>
            <div v-if="menuOpen" class="lab-panel__menu" role="menu">
              <button type="button" role="menuitem" @click="restart">Restart Lab</button>
              <button type="button" role="menuitem" @click="menuOpen = false; portal.toggleLabPanel()">Collapse panel</button>
            </div>
          </div>
        </div>
        <div class="lab-panel__chips">
          <span class="pill pill--accent pill--small">{{ area.name }} ({{ area.weight }})</span>
          <span class="pill pill--muted pill--small">{{ service.label }}</span>
        </div>
        <div class="lab-panel__progress-row"><span class="lab-panel__count">{{ run.doneCount }} of {{ run.total }} tasks</span><span class="lab-panel__timer">{{ formatDuration(run.elapsedMs) }} elapsed</span></div>
        <div class="bar"><div class="bar__fill" :style="{ width: pct + '%' }" /></div>
      </div>
      <div class="lab-panel__brief">
        <button type="button" class="lab-panel__brief-toggle" :aria-expanded="briefOpen" @click="briefOpen = !briefOpen">BRIEF <FluentIcon :name="briefOpen ? 'chevron-up' : 'chevron-down'" :size="10" /></button>
        <p v-if="briefOpen" class="lab-panel__brief-text">{{ run.lab.brief }}</p>
      </div>
      <div v-if="run.loading" class="lab-panel__recovery" role="status">Loading Lab progress…</div>
      <div v-if="run.storageError" class="lab-panel__recovery" role="alert"><strong>Lab progress unavailable</strong><p>{{ run.storageError.message }}</p><div class="lab-panel__recovery-actions"><button type="button" class="btn btn--secondary" @click="exportData">Export data</button><button v-if="run.unsaved" type="button" class="btn btn--secondary" :disabled="run.busy" @click="recovery('retrySave')">Retry save</button><button v-if="['INCOMPATIBLE_CONTENT', 'UNSUPPORTED_SCHEMA', 'INVALID_RUN'].includes(run.storageError.code)" type="button" class="btn btn--secondary" @click="recoverRestart">Restart this Lab</button><button v-else type="button" class="btn btn--secondary" @click="reloadWithConfirm">Reload</button></div></div>
      <p v-if="errorMessage" class="lab-panel__recovery" role="alert">{{ errorMessage }}</p>
      <section v-if="aksCapstone" class="lab-panel__capstone" aria-label="Capstone status">
        <h3>Operational state</h3>
        <p>Selected artifact: <code>{{ aksCapstone.artifact.selected.at(-1)?.buildId ?? 'None yet' }}</code></p>
        <p>Deployed artifacts: <template v-if="aksCapstone.artifact.deployed.length"><code v-for="pod in aksCapstone.artifact.deployed" :key="pod.uid">{{ pod.name }}: {{ pod.artifactId ?? 'none' }} </code></template><span v-else>None yet</span></p>
        <p>Active deployment: <template v-if="aksCapstone.deployment.length"><code v-for="item in aksCapstone.deployment" :key="`${item.clusterId}/${item.namespace}/${item.name}`">{{ item.namespace }}/{{ item.name }} · {{ item.image }} · {{ item.pods.length }}/{{ item.desiredReplicas }} Pods </code></template><span v-else>None yet</span></p>
        <p>Cleanup checkpoint: {{ aksCapstone.cleanup.checkpoint ? 'frozen' : 'pending' }}. <template v-if="aksCapstone.cleanup.frozen">Only reads, deletes, and cleanup verification are permitted.</template></p>
        <p>Owned resources: <template v-if="aksCapstone.cleanup.remaining.length"><code v-for="item in aksCapstone.cleanup.remaining" :key="item.resourceId">{{ item.type }} {{ item.resourceId }} </code></template><span v-else>None remaining</span></p>
        <p>Supplied prerequisites: <code v-for="item in aksCapstone.cleanup.protected" :key="item.resourceId">{{ item.type }} {{ item.resourceId }} </code></p>
        <div v-if="activeStage?.id === 'incident' || aksCapstone.incident.current || aksCapstone.incident.history.length" class="lab-panel__incident"><p>Incident progress: {{ aksCapstone.incident.current?.phaseId ?? (aksCapstone.incident.history.length ? 'historical receipts retained' : 'not started') }}</p><ol v-if="aksCapstone.incident.history.length"><li v-for="item in aksCapstone.incident.history" :key="item.id">{{ item.evidenceId }} · {{ item.outcome }}</li></ol></div>
        <div v-if="activeStage?.index === 7 && !aksCapstone.cleanup.frozen"><p>Freeze after all final requests pass. Cleanup then permits only reads, deletes, and cleanup verification.</p><button type="button" class="btn btn--secondary" :disabled="!aksCapstone.cleanup.eligible || run.loading || run.readOnly || run.busy || !!run.storageError" @click="stageAction('aks-freeze-cleanup')">Freeze cleanup checkpoint</button><p v-if="aksCapstone.cleanup.diagnostics.length">{{ aksCapstone.cleanup.diagnostics.map(item => item.message).join(' ') }}</p></div>
      </section>
      <section v-if="capstone" class="lab-panel__capstone" aria-label="Capstone status">
        <h3>Operational state</h3>
        <p>Saved source: {{ Object.keys(capstone.project?.savedFiles ?? {}).length }} files · edits require a new build.</p>
        <p>Published artifact: <code>{{ latestBuild?.id ?? 'None' }}</code><template v-if="latestBuild"> · digest <code>{{ latestBuild.digest }}</code></template></p>
        <p>Active application: <code>{{ activeDeployment?.generation ?? 'None' }}</code><template v-if="activeDeployment"> · image <code>{{ activeDeployment.image ?? 'Unknown' }}</code></template></p>
        <p>Checkpoint {{ checkpoint ? 'sealed' : 'pending' }}<template v-if="checkpoint"> · sequence {{ checkpoint.sequence }}</template></p>
        <p>Owned groups: <template v-if="ownedGroups.length"><code v-for="name in ownedGroups" :key="name">{{ name }} </code></template><span v-else>None yet</span></p>
        <div v-if="activeStage?.id === 'incident' || incident" class="lab-panel__incident">
          <p>Simulated incident: {{ incident ? `${incident.id} · ${incident.status}` : 'Not injected' }}</p>
          <p v-if="incident?.status === 'active'">Saved desired Foundry deployment: <code>{{ incident.desiredDeployment }}</code> · live effective deployment: <code>missing-deployment</code></p>
          <p v-if="incidentLog">Diagnostic log: <code>{{ incidentLog.code }}</code> · {{ incidentLog.message }}</p>
          <button v-if="!incident" type="button" class="btn btn--secondary" :disabled="run.loading || run.readOnly || run.busy || !!run.storageError || !!run.completedAt" @click="stageAction('inject-incident')">Inject simulated incident</button>
        </div>
      </section>
      <template v-if="stages.length">
        <section v-for="stage in stages" :key="stage.id" class="lab-panel__stage" :class="isCapstone ? `lab-panel__stage--${stage.status.toLowerCase()}` : ''" :aria-label="isCapstone ? `${stage.status} stage: ${stage.title}` : stage.title">
          <h3><span>{{ isCapstone ? `${stage.index + 1}. ` : '' }}{{ stage.title }}</span><span>{{ isCapstone ? `${stage.status} stage · ` : '' }}{{ stage.tasks.filter((task) => task.done).length }}/{{ stage.tasks.length }}</span></h3>
          <p v-if="stage.seal" class="lab-panel__stage-meta">Sealed at sequence {{ stage.seal.sequence }} · {{ stage.seal.evidenceIds.length }} evidence records</p>
          <p v-if="aksCapstone" class="lab-panel__stage-meta">{{ stage.evidenceMode === 'historical' ? 'Historical sealed evidence' : 'Current evidence' }} · {{ stage.proofs.length }} durable receipts</p>
          <ol class="lab-panel__tasks"><TaskRow v-for="t in stage.tasks" :key="t.id" :task="t" :state="stateOf(t, stage)" :hints-revealed="run.hintsRevealed[t.id] ?? 0" :solution-revealed="!!run.solutionsRevealed[t.id]" :exam-note-open="openNotes.has(t.id)" :help-disabled="run.readOnly || run.loading || !!run.storageError || run.busy || (isCapstone && stage.status !== 'Active')" @toggle-exam-note="toggleNote(t.id)" @reveal-hint="assistance('revealHint', t.id)" @reveal-solution="assistance('revealSolution', t.id)" /></ol>
          <div v-if="aksCapstone && stage.status === 'Active'" class="lab-panel__recovery-actions" aria-label="AKS checkpoint verification"><button v-for="task in stage.tasks" :key="task.id" type="button" class="btn btn--secondary" :aria-label="`Verify ${task.title ?? task.id}`" :disabled="!task.verification?.scenarioId || run.loading || run.readOnly || run.busy || !!run.storageError || !!run.completedAt || (aksCapstone.cleanup.frozen && !['cleanup-app', 'cleanup-cloud'].includes(task.id))" @click="verifyAksTask(task)">Verify {{ task.title ?? task.id }}</button></div>
          <button v-if="isCapstone && stage.status === 'Active'" type="button" class="btn btn--primary lab-panel__advance" :disabled="!canAdvance || run.loading || run.readOnly || run.busy || !!run.storageError || !!run.completedAt" @click="stageAction(aksCapstone ? 'aks-advance-stage' : 'advance-stage')">{{ stages[stage.index + 1] ? `Advance to ${stages[stage.index + 1].title}` : 'Seal cleanup and complete Lab' }}</button>
        </section>
      </template>
      <ol v-else class="lab-panel__tasks"><TaskRow v-for="t in run.taskStates" :key="t.id" :task="t" :state="t.done ? 'done' : t.id === run.currentTaskId ? 'current' : 'pending'" :hints-revealed="run.hintsRevealed[t.id] ?? 0" :solution-revealed="!!run.solutionsRevealed[t.id]" :exam-note-open="openNotes.has(t.id)" @toggle-exam-note="toggleNote(t.id)" @reveal-hint="run.revealHint(t.id)" @reveal-solution="run.revealSolution(t.id)" /></ol>
      <div class="lab-panel__footer"><button type="button" class="btn btn--secondary" @click="restart">Restart Lab</button></div>
    </template>
  </aside>
</template>

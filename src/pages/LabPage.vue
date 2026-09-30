<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLabRunStore } from '../stores/labRun.js'
import { usePortalStore } from '../stores/portal.js'
import { labById } from '../data/labs/index.js'
import BladeHost from '../components/blade/BladeHost.vue'
import CloudShell from '../components/shell/CloudShell.vue'
import LabPanel from '../components/lab/LabPanel.vue'
import ProjectEditor from '../components/lab/ProjectEditor.vue'
import ExperimentPanel from '../components/lab/ExperimentPanel.vue'
import BicepDeploymentPanel from '../components/lab/BicepDeploymentPanel.vue'
import { toolDestination } from '../lib/toolNavigation.js'

const props = defineProps({ labId: { type: String, required: true } })
const router = useRouter()
const run = useLabRunStore()
const portal = usePortalStore()
let timer = null
let bootId = 0
const tool = ref('resources')
const toolNames = computed(() => run.lab?.capabilities?.bicepDeployment
  ? ['resources', 'files', 'deployments', 'experiments'] : ['resources', 'files', 'experiments'])
const toolButtons = []
const behavioral = computed(() => run.lab?.engineVersion === 2)
async function onToolKeydown(event, index) {
  const destination = toolDestination(toolNames.value, index, event.key)
  if (!destination) return
  event.preventDefault()
  tool.value = destination.name
  await nextTick()
  toolButtons[destination.index]?.focus()
}

async function boot() {
  const ticket = ++bootId
  const lab = labById(props.labId)
  if (!lab || lab.status !== 'available') { router.replace('/'); return }
  clearInterval(timer)
  tool.value = 'resources'
  try { await run.load(props.labId) } catch { /* Lab Panel offers recovery. */ }
  if (ticket !== bootId) return
  run.tick(Date.now())
  timer = setInterval(() => run.tick(Date.now()), 1000)
}
function pause() { run.pauseTimer() }

onMounted(() => { boot(); window.addEventListener('beforeunload', pause) })
watch(() => props.labId, boot)
onBeforeUnmount(() => { clearInterval(timer); pause(); window.removeEventListener('beforeunload', pause) })
</script>

<template>
  <main v-if="run.lab" class="lab" @click="portal.closePanes()">
    <div class="lab__main">
      <div v-show="!portal.shell.maximized" class="lab__blade" :class="{ 'lab__blade--tools': behavioral }">
        <div v-if="behavioral" class="lab-tools" role="tablist" aria-label="Lab tools">
          <button v-for="(item, index) in toolNames" :key="item" :ref="el => toolButtons[index] = el" type="button" role="tab" :aria-selected="tool === item" :tabindex="tool === item ? 0 : -1" @click="tool = item" @keydown="onToolKeydown($event, index)">{{ item === 'resources' ? 'Resources' : item === 'files' ? 'Files' : item === 'deployments' ? 'Deployments' : 'Experiments' }}</button>
        </div>
        <BladeHost v-show="!behavioral || tool === 'resources'" />
        <ProjectEditor v-if="behavioral" v-show="tool === 'files'" />
        <BicepDeploymentPanel v-if="run.lab?.capabilities?.bicepDeployment" v-show="tool === 'deployments'" />
        <ExperimentPanel v-if="behavioral" v-show="tool === 'experiments'" />
      </div>
      <CloudShell v-if="portal.shell.visible" />
      <button v-else type="button" class="lab__shell-restore" @click="portal.openShell()">Open Cloud Shell</button>
    </div>
    <LabPanel />
  </main>
</template>

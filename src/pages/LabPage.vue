<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLabRunStore } from '../stores/labRun.js'
import { usePortalStore } from '../stores/portal.js'
import { labById } from '../data/labs/index.js'
import BladeHost from '../components/blade/BladeHost.vue'
import CloudShell from '../components/shell/CloudShell.vue'
import LabPanel from '../components/lab/LabPanel.vue'

const props = defineProps({ labId: { type: String, required: true } })
const router = useRouter()
const run = useLabRunStore()
const portal = usePortalStore()
let timer = null

function boot() {
  const lab = labById(props.labId)
  if (!lab || lab.status !== 'available') { router.replace('/'); return }
  run.load(props.labId)
  run.tick(Date.now())
  clearInterval(timer)
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
      <div v-show="!portal.shell.maximized" class="lab__blade"><BladeHost /></div>
      <CloudShell v-if="portal.shell.visible" />
      <button v-else type="button" class="lab__shell-restore" @click="portal.openShell()">Open Cloud Shell</button>
    </div>
    <LabPanel />
  </main>
</template>

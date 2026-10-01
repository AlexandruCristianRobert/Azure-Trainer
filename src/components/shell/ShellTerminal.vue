<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'

const run = useLabRunStore()
const input = ref('')
const inputEl = ref(null)
const bodyEl = ref(null)
const histIndex = ref(-1)
const draft = ref('')
const frames = ['-', '\\', '|', '/']
const frame = ref(0)
let spinner = null

watch(() => run.running, (r) => {
  clearInterval(spinner)
  if (r) spinner = setInterval(() => { frame.value = (frame.value + 1) % frames.length }, 120)
  else if (run.lab?.engineVersion !== 2) nextTick(focus)
})

const spinnerText = computed(() => `${frames[frame.value]} Running ..`)

async function scrollToBottom() {
  await nextTick()
  if (bodyEl.value) bodyEl.value.scrollTop = bodyEl.value.scrollHeight
}
watch(() => [run.scrollback.length, run.running], scrollToBottom)

async function submit() {
  if (run.busy || (run.lab?.engineVersion === 2 && (run.readOnly || run.completedAt || run.storageError))) return
  const line = input.value
  input.value = ''
  histIndex.value = -1
  draft.value = ''
  try { await run.execute(line) } catch { /* Lab Panel shows the session error. */ }
  await scrollToBottom()
  focus()
}

function onKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); submit(); return }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!run.history.length) return
    if (histIndex.value === -1) { draft.value = input.value; histIndex.value = run.history.length - 1 } else if (histIndex.value > 0) histIndex.value--
    input.value = run.history[histIndex.value]
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histIndex.value === -1) return
    if (histIndex.value < run.history.length - 1) { histIndex.value++; input.value = run.history[histIndex.value] } else { histIndex.value = -1; input.value = draft.value }
    return
  }
  if (e.key === 'Tab') { if (run.lab?.engineVersion !== 2) e.preventDefault(); return }
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); if (!run.readOnly && !run.completedAt && !run.storageError) void run.clearScrollback(); return }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); if (run.lab?.engineVersion !== 2) run.pushLine({ kind: 'cmd', text: `${input.value}^C` }); input.value = ''; histIndex.value = -1 }
}

function focus() { inputEl.value?.focus() }
// A click that ends a text-drag selection (e.g. to copy a Task's example command out of
// the scrollback) must not collapse it by refocusing the input.
function onBodyClick() {
  if (window.getSelection?.()?.isCollapsed !== false) focus()
}
onMounted(() => { focus(); scrollToBottom() })
onBeforeUnmount(() => clearInterval(spinner))
</script>

<template>
  <div ref="bodyEl" class="terminal" @click="onBodyClick">
    <pre class="terminal__pre"><template v-for="(line, i) in run.scrollback" :key="i"><template v-if="line.kind === 'cmd'"><span class="terminal__user">user@sandbox</span>:<span class="terminal__path">~</span>$ {{ line.text }}
</template><span v-else-if="line.kind === 'err'" class="terminal__err">{{ line.text }}
</span><template v-else>{{ line.text }}
</template></template><span v-if="run.running" class="terminal__spinner">{{ spinnerText }}</span></pre>
    <form v-if="!run.running && !(run.lab?.engineVersion === 2 && (run.readOnly || run.completedAt || run.storageError || run.loading))" class="terminal__input-row" @submit.prevent="submit">
      <span><span class="terminal__user">user@sandbox</span>:<span class="terminal__path">~</span>$&nbsp;</span>
      <input ref="inputEl" v-model="input" class="terminal__input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Cloud Shell command input" @keydown="onKeydown" />
    </form>
  </div>
</template>

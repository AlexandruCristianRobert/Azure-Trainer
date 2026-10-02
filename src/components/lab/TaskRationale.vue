<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { buildExplanationPrompt, copyExplanationPrompt } from '../../lib/labEngine/explanationPrompt.js'

const props = defineProps({
  labTitle: { type: String, required: true },
  taskText: { type: String, required: true },
  rationale: { type: Object, required: true },
})
const open = ref(false)
const status = ref('')
const fallback = ref(null)
const copying = ref(false)
let generation = 0

watch(() => [props.labTitle, props.taskText, props.rationale], () => {
  generation++
  open.value = false
  status.value = ''
  fallback.value = null
  copying.value = false
}, { deep: true, flush: 'sync' })
onBeforeUnmount(() => { generation++ })

async function copyPrompt() {
  const request = ++generation
  status.value = ''
  fallback.value = null
  copying.value = true
  const result = await copyExplanationPrompt(buildExplanationPrompt(props), globalThis.navigator?.clipboard)
  if (request !== generation) return
  copying.value = false
  fallback.value = result.fallback
  status.value = result.copied ? 'Explanation prompt copied.' : 'Copy unavailable. Select and copy the prompt below.'
}
</script>

<template>
  <div class="task-rationale">
    <button type="button" class="task-rationale__toggle" :aria-expanded="open" @click="open = !open">ℹ Why this?</button>
    <section v-if="open" class="task-rationale__body" aria-label="Task rationale">
      <p>{{ rationale.what }}</p>
      <p>{{ rationale.why }}</p>
      <p>{{ rationale.without }}</p>
      <p v-if="rationale.csharp">{{ rationale.csharp }}</p>
      <button type="button" class="task-rationale__copy" :disabled="copying" @click="copyPrompt">Copy explanation prompt</button>
      <p role="status" aria-live="polite">{{ status }}</p>
      <textarea v-if="fallback" class="task-rationale__fallback" readonly :value="fallback" aria-label="Explanation prompt" />
    </section>
  </div>
</template>

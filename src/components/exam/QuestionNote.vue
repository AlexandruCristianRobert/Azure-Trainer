<script setup>
import { computed, ref, watch } from 'vue'
import { byteLength } from '../../lib/exam/contracts.js'
const props = defineProps({ store: { type: Object, required: true }, sessionId: String, questionId: String, allowed: Boolean })
const note = ref(null), message = ref(''), saving = ref(false)
let epoch = 0
watch(() => [props.store, props.sessionId, props.questionId], () => {
  epoch++; note.value = null; message.value = ''; saving.value = false
}, { immediate: true, flush: 'sync' })
watch(() => [props.allowed, props.questionId, props.store.snapshot], () => {
  if (props.allowed && props.questionId && !note.value) {
    const saved = props.store.snapshot.notes.find(n => n.target.kind === 'question' && n.target.id === props.questionId)
    note.value = saved ? JSON.parse(JSON.stringify(saved)) : props.store.makeNote({ target: { kind: 'question', id: props.questionId } })
  }
}, { immediate: true })
const bytes = computed(() => note.value ? byteLength(JSON.stringify(note.value)) : 0)
async function save() {
  if (!props.allowed || !note.value || note.value.target.id !== props.questionId || props.store.session?.id !== props.sessionId || props.store.session.mode !== 'study') return
  const captured = epoch, sessionId = props.sessionId, questionId = props.questionId
  const payload = { ...note.value, target: { ...note.value.target }, updatedAt: props.store.observedAt }
  saving.value = true; message.value = ''
  try {
    await props.store.saveNote(payload)
    if (captured === epoch && sessionId === props.sessionId && questionId === props.questionId) {
      message.value = note.value.text === payload.text ? 'Note saved. Scores are unchanged.' : 'Earlier note saved. New edits are not saved.'
    }
  } catch (error) { if (captured === epoch) message.value = error.message }
  finally { if (captured === epoch) saving.value = false }
}
</script>
<template>
  <section v-if="note && allowed" class="exam-note exam-question-note">
    <h3>Question note</h3>
    <label class="exam-field">Your personal note<textarea v-model="note.text" rows="4" @input="message = ''" /></label>
    <p>{{ bytes }} / 8192 UTF-8 bytes for the whole saved note. Notes never change scores or copied concept prompts.</p>
    <button :disabled="saving || store.saving || !!store.error || bytes > 8192" @click="save">Save question note</button>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

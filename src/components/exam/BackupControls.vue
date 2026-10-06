<script setup>
import { ref } from 'vue'
import { EXAM_LIMITS } from '../../lib/exam/contracts.js'
const props = defineProps({ store: { type: Object, required: true } })
const message = ref(''), preview = ref(null), replacements = ref([]), confirmReset = ref(false), confirmReload = ref(false)
function download(text, name) { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url) }
async function attempt(work) { message.value = ''; try { await work() } catch (error) { message.value = error.message } }
async function choose(event) {
  preview.value = null; replacements.value = []
  const file = event.target.files?.[0]; if (!file) return
  await attempt(async () => { if (file.size > EXAM_LIMITS.backupBytes) throw new Error('Backup exceeds the 32 MiB input limit.'); preview.value = await props.store.previewImport(await file.text()) })
}
async function apply() { await attempt(async () => { await props.store.applyImport(preview.value, { replaceIds: replacements.value }); preview.value = null; message.value = 'Backup imported.' }) }
</script>
<template>
  <section class="exam-save" aria-label="Save and recovery">
    <p role="status">{{ store.saveStatus === 'saved' ? 'Saved on this browser' : store.saveStatus === 'saving' ? 'Saving — input changes are pending' : store.saveStatus === 'loading' ? 'Loading saved exam data' : 'Not saved — changes are frozen' }}</p>
    <div v-if="store.error" role="alert"><p>{{ store.error.message }}</p><p v-if="store.error.code === 'REVISION_CONFLICT'">Another tab changed saved data. Export pending changes, then explicitly reload. Pending answers will not be replayed into a different section.</p><p v-else>Keep this page open. Export recovery before discarding pending changes. If storage is full, export, reload and deliberately remove older attempts.</p>
      <div class="exam-actions"><button v-if="store.error.code === 'STORAGE_FAILED'" @click="attempt(() => store.retry())">Retry save</button><button @click="attempt(() => download(store.exportMemory(), 'exam-recovery.json'))">Export pending recovery</button><button @click="confirmReload = true">Reload saved data</button></div>
      <p>Recovery is unencrypted and contains private answer keys and unsaved changes. It is a recovery record, not an importable exam backup. Its separate 96 MiB limit accommodates the saved snapshot and pending import preview; normal backup input remains 32 MiB and stored data remains 24 MiB.</p>
      <div v-if="confirmReload"><p>Discard all pending changes and load the saved database?</p><button @click="attempt(async () => { await store.reload({ discardPending: true }); confirmReload = false })">Confirm reload and discard pending</button><button @click="confirmReload = false">Cancel</button></div>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
  <details class="exam-backup"><summary>Backups and local data</summary>
    <p>Data stays in this browser and origin. Private browsing, clearing site data or changing browser can remove access. Backups are unencrypted and contain saved answers, answer keys and notes. Keep a copy in a trusted location.</p>
    <p>Limits: 200 saved attempts and 24 MiB total data. Nothing is automatically evicted. Backup input is limited to 32 MiB.</p>
    <div class="exam-actions"><button :disabled="!store.ready || store.saving || !!store.error" @click="attempt(async () => download(await store.exportBackup(), 'azure-trainer-exam.json'))">Export backup</button><label class="exam-file">Preview backup<input type="file" accept=".json,application/json" :disabled="!store.ready || store.saving || !!store.error" @change="choose"></label><button :disabled="!store.ready || store.saving || !!store.error" @click="confirmReset = true">Reset exam data</button></div>
    <section v-if="preview" aria-label="Import preview"><h3>Import preview</h3><p>{{ preview.counts.incoming.sessions }} sessions, {{ preview.counts.incoming.attempts }} attempts and {{ preview.counts.incoming.notes }} notes.</p><p v-if="preview.conflicts.length">Explicitly approve every replacement. Store-qualified IDs distinguish sessions, attempts and notes with the same ID.</p>
      <label v-for="conflict in preview.conflicts" :key="conflict.key" class="exam-choice"><input v-model="replacements" type="checkbox" :value="conflict.key">Replace {{ conflict.key }}</label>
      <div v-if="preview.modeConflicts.length" role="alert"><p v-for="conflict in preview.modeConflicts" :key="conflict.mode">An unfinished {{ conflict.mode }} session conflicts with this backup.</p><p>Finish the existing same-mode session, or export then deliberately reset exam data and preview again. You can also choose another backup. Import will not discard a different session.</p></div>
      <button :disabled="preview.modeConflicts.length > 0 || replacements.length !== preview.conflicts.length || store.saving" @click="apply">Confirm import</button><button @click="preview = null">Cancel import</button>
    </section>
    <section v-if="confirmReset"><p>Reset removes all exam sessions, attempts, notes and practice preferences. Lab data is unaffected. Export a backup first if you want to restore it later.</p><button @click="attempt(async () => { await store.reset(); confirmReset = false; preview = null })">Confirm reset of exam data</button><button @click="confirmReset = false">Cancel reset</button></section>
  </details>
</template>

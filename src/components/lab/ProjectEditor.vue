<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { getProjectManifest } from '../../lib/project/manifests.js'
import { parseKubernetesYaml } from '../../lib/kubernetes/yaml.js'
import { kubeJson } from '../../lib/kubernetes/format.js'
import { editProjectText } from '../../lib/project/editor-keyboard.js'

const run = useLabRunStore()
const path = ref('src/Trainer.Api/Program.cs')
const text = ref('')
const message = ref('')
let leaveEditorOnTab = false
const current = computed(() => run.behavioralRun?.project)
const manifest = computed(() => getProjectManifest(current.value?.manifestId ?? run.lab?.manifestId))
const files = computed(() => manifest.value.files)
const fixed = computed(() => Object.hasOwn(manifest.value.fixedFiles ?? {}, path.value))
const frozenCleanup = computed(() => (run.lab?.capabilities?.aksCapstone === true || run.lab?.capabilities?.dataCapstone === true) && !!run.behavioralRun?.stages?.cleanupCheckpoint)
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy || frozenCleanup.value)
const saved = computed(() => current.value?.savedFiles?.[path.value] ?? '')
const dirty = computed(() => text.value !== saved.value)
const version = computed(() => current.value?.fileVersions?.[path.value] ?? 0)
const published = computed(() => Object.values(run.behavioralRun?.artifacts?.buildsById ?? {}).at(-1))
const isKubernetes = computed(() => manifest.value?.runtimeFamily === 'aks' || manifest.value?.language === 'python')
const integrationProject = computed(() => manifest.value?.integration === true)
function semanticManifest(value, defaultNamespace = '') {
  const namespace = value.kind === 'Namespace' ? '' : value.metadata?.namespace ?? defaultNamespace
  const metadata = { name: value.metadata?.name, ...(namespace ? { namespace } : {}), ...(value.metadata?.labels ? { labels: value.metadata.labels } : {}) }
  if (value.kind === 'ConfigMap' || value.kind === 'Secret') {
    const data = { ...(value.data ?? {}) }
    if (value.kind === 'Secret') for (const [key, content] of Object.entries(value.stringData ?? {})) {
      const bytes = new TextEncoder().encode(content); let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      data[key] = btoa(binary)
    }
    return { apiVersion: value.apiVersion, kind: value.kind, metadata, ...(value.kind === 'Secret' ? { type: value.type ?? 'Opaque' } : {}), data }
  }
  return { apiVersion: value.apiVersion, kind: value.kind, metadata, ...(value.spec ? { spec: value.spec } : {}) }
}
const applied = computed(() => {
  if (!isKubernetes.value || !path.value.startsWith('k8s/')) return 'Not a Kubernetes manifest.'
  const parsed = parseKubernetesYaml(saved.value, path.value)
  if (parsed.diagnostics.length) return 'Not applied: saved YAML has diagnostics.'
  const context = run.behavioralRun?.runtime?.kubernetes?.contexts?.[run.behavioralRun?.runtime?.kubernetes?.currentContext]
  const resources = context && run.behavioralRun?.runtime?.kubernetes?.clusters?.[context.clusterId]?.resources
  if (!resources) return 'Not applied to a current cluster.'
  const current = parsed.documents.every(document => Object.values(resources).some(resource => kubeJson(semanticManifest(resource, context.namespace)) === kubeJson(semanticManifest(document, context.namespace))))
  return current ? 'Applied to the current cluster.' : 'Not applied to the current cluster.'
})

function selectFile(next) {
  leaveEditorOnTab = false
  path.value = next
  text.value = current.value?.draftFiles?.[next] ?? ''
  message.value = ''
}
function openDiagnostic(item) {
  if (!files.value.includes(item.path)) return
  selectFile(item.path)
  message.value = item.line ? `Showing ${item.path}, reported near line ${item.line}.` : `Showing ${item.path}.`
}
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}:${current.value?.manifestId ?? ''}`, () => {
  selectFile(files.value.includes(path.value) ? path.value : files.value[0])
}, { immediate: true })
function edit(event) {
  text.value = event.target.value
  message.value = ''
  void run.dispatchBehavioral({ type: 'draft', path: path.value, text: text.value }).catch((error) => { message.value = error.message })
}
function editorKeydown(event) {
  if (locked.value || fixed.value || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return
  if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(event.key)) return
  if (event.key === 'Escape') {
    leaveEditorOnTab = true
    return
  }
  if (leaveEditorOnTab && event.key === 'Tab') {
    leaveEditorOnTab = false
    return
  }
  leaveEditorOnTab = false
  const textarea = event.target
  const result = editProjectText({ text: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd, key: event.key, shiftKey: event.shiftKey, path: path.value })
  if (!result) return
  event.preventDefault()
  const editedPath = path.value
  const attemptId = run.behavioralRun?.attemptId
  const labId = run.labId
  const direction = textarea.selectionDirection
  textarea.value = result.text
  edit({ target: textarea })
  void nextTick(() => {
    if (path.value !== editedPath || run.labId !== labId || run.behavioralRun?.attemptId !== attemptId || locked.value || fixed.value || text.value !== result.text || textarea.ownerDocument.activeElement !== textarea) return
    textarea.setSelectionRange(result.start, result.end, direction)
  })
}
async function save() {
  message.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'save-file', path: path.value, text: text.value })
    message.value = result?.effects?.diagnostics?.length ? 'Save rejected. Review diagnostics below.' : 'Saved.'
  } catch (error) { message.value = error.message }
}
</script>

<template>
  <section class="project-tool" aria-label="Project files">
    <header class="project-tool__head"><div><h2>Project files</h2><p v-if="frozenCleanup">Cleanup checkpoint frozen. Project files are read-only; only reads, deletes, and cleanup verification are permitted.</p><p v-else-if="run.lab?.capabilities?.bicepDeployment">Edit the modular Bicep project and save each file. Validate, preview, and deploy saved versions in Cloud Shell.</p><p v-else-if="isKubernetes">Python source and ordinary YAML are editable. Save source before building an image; save YAML before applying it to the simulated cluster.</p><p v-else>Simulated .NET 10 project. Builds capture saved C# files.</p><p v-if="run.lab?.capabilities?.healthProbes">Use supported health expressions in Program.cs: HealthState.StartupComplete, HealthState.Ready, and HealthState.Responsive. The helper is fixed and read-only. Edit containerapp.yaml in JSON form; general block YAML is outside this trainer's supported format. Save C# → build image → deploy. Save probe YAML → deploy; no image build is needed.</p></div><span class="project-tool__build">{{ isKubernetes ? (published ? `Built ${published.id}` : 'No image built') : (published ? `Published ${published.id}` : 'No image published') }}</span></header>
    <div class="project-tool__body">
      <nav class="project-tool__files" aria-label="Project file list">
        <button v-for="item in files" :key="item" type="button" :aria-current="path === item ? 'page' : undefined" @click="selectFile(item)">{{ item }}</button>
      </nav>
      <div class="project-tool__editor">
        <div class="project-tool__file-head"><strong>{{ path }}</strong><span>{{ dirty ? 'Draft differs from saved' : 'Saved version' }} {{ version }}</span></div>
        <p v-if="isKubernetes" class="project-tool__state">Saved: edits become build/apply input only after Save. Built: {{ published ? published.id : 'no image yet' }}. Applied: {{ applied }}</p>
        <aside v-if="integrationProject && ['app.py', 'retrieval.sql'].includes(path)" class="project-tool__syntax" aria-label="Integration fixture adapter and supported syntax">
          <strong>Local fixture adapter · integration-fixture-v1</strong>
          <p>Python supports the taught request handlers, input checks, client construction, named calls, dictionaries, loops, guards, and returns shown in this project. SQL supports the declared documents table, equality metadata filters, cosine distance cutoff, ordering, and LIMIT with named parameters. Requests use deterministic local fixtures; no Python SDK or database connects.</p>
        </aside>
        <label class="project-tool__label" for="project-source">File contents</label>
        <p id="project-source-shortcuts" class="project-tool__state">Tab / Shift+Tab: indent / unindent. Enter: keep indentation. Escape then Tab: leave editor.</p>
        <textarea id="project-source" :value="text" :disabled="locked || fixed" :readonly="fixed" aria-describedby="project-source-shortcuts" spellcheck="false" @input="edit" @keydown="editorKeydown" @blur="leaveEditorOnTab = false" />
        <div class="project-tool__actions"><span role="status">{{ fixed ? 'Fixed helper · read-only' : message || (run.unsaved ? 'Saving draft…' : dirty ? 'Unsaved draft' : 'Saved source') }}</span><button type="button" class="btn btn--primary" :disabled="locked || fixed || run.busy || !dirty" @click="save">Save file</button></div>
        <ul v-if="run.diagnostics?.length" class="project-tool__diagnostics" aria-label="Diagnostics"><li v-for="(item, i) in run.diagnostics" :key="i"><button v-if="files.includes(item.path)" type="button" class="project-tool__diagnostic-link" @click="openDiagnostic(item)">{{ item.path }}{{ item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '' }}</button><span v-else>{{ item.path || path }}{{ item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '' }}</span>: {{ item.code }} — {{ item.message }}</li></ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.project-tool__syntax { margin: 10px 0; padding: 12px; border-left: 3px solid var(--accent); background: var(--surface-subtle, var(--surface)); }
.project-tool__syntax p { max-width: 80ch; margin: 6px 0 0; color: var(--text-2); line-height: 1.5; }
.project-tool__diagnostic-link { padding: 0; border: 0; background: transparent; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
</style>

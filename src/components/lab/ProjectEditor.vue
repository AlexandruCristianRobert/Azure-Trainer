<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { getProjectManifest } from '../../lib/project/manifests.js'
import { parseKubernetesYaml } from '../../lib/kubernetes/yaml.js'
import { kubeJson } from '../../lib/kubernetes/format.js'

const run = useLabRunStore()
const path = ref('src/Trainer.Api/Program.cs')
const text = ref('')
const message = ref('')
const current = computed(() => run.behavioralRun?.project)
const manifest = computed(() => getProjectManifest(current.value?.manifestId ?? run.lab?.manifestId))
const files = computed(() => manifest.value.files)
const fixed = computed(() => Object.hasOwn(manifest.value.fixedFiles ?? {}, path.value))
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError)
const saved = computed(() => current.value?.savedFiles?.[path.value] ?? '')
const dirty = computed(() => text.value !== saved.value)
const version = computed(() => current.value?.fileVersions?.[path.value] ?? 0)
const published = computed(() => Object.values(run.behavioralRun?.artifacts?.buildsById ?? {}).at(-1))
const isKubernetes = computed(() => manifest.value?.runtimeFamily === 'aks' || manifest.value?.language === 'python')
function semanticManifest(value) {
  return { apiVersion: value.apiVersion, kind: value.kind, metadata: { name: value.metadata?.name, ...(value.metadata?.namespace ? { namespace: value.metadata.namespace } : {}), ...(value.metadata?.labels ? { labels: value.metadata.labels } : {}) }, ...(value.spec ? { spec: value.spec } : {}) }
}
const applied = computed(() => {
  if (!isKubernetes.value || !path.value.startsWith('k8s/')) return 'Not a Kubernetes manifest.'
  const parsed = parseKubernetesYaml(saved.value, path.value)
  if (parsed.diagnostics.length) return 'Not applied: saved YAML has diagnostics.'
  const context = run.behavioralRun?.runtime?.kubernetes?.contexts?.[run.behavioralRun?.runtime?.kubernetes?.currentContext]
  const resources = context && run.behavioralRun?.runtime?.kubernetes?.clusters?.[context.clusterId]?.resources
  if (!resources) return 'Not applied to a current cluster.'
  const current = parsed.documents.every(document => Object.values(resources).some(resource => kubeJson(semanticManifest(resource)) === kubeJson(semanticManifest(document))))
  return current ? 'Applied to the current cluster.' : 'Not applied to the current cluster.'
})

function selectFile(next) {
  path.value = next
  text.value = current.value?.draftFiles?.[next] ?? ''
  message.value = ''
}
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}:${current.value?.manifestId ?? ''}`, () => {
  selectFile(files.value.includes(path.value) ? path.value : files.value[0])
}, { immediate: true })
function edit(event) {
  text.value = event.target.value
  message.value = ''
  void run.dispatchBehavioral({ type: 'draft', path: path.value, text: text.value }).catch((error) => { message.value = error.message })
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
    <header class="project-tool__head"><div><h2>Project files</h2><p v-if="run.lab?.capabilities?.bicepDeployment">Edit the modular Bicep project and save each file. Validate, preview, and deploy saved versions in Cloud Shell.</p><p v-else-if="isKubernetes">Python source and ordinary YAML are editable. Save source before building an image; save YAML before applying it to the simulated cluster.</p><p v-else>Simulated .NET 10 project. Builds capture saved C# files.</p><p v-if="run.lab?.capabilities?.healthProbes">Use supported health expressions in Program.cs: HealthState.StartupComplete, HealthState.Ready, and HealthState.Responsive. The helper is fixed and read-only. Edit containerapp.yaml in JSON form; general block YAML is outside this trainer's supported format. Save C# → build image → deploy. Save probe YAML → deploy; no image build is needed.</p></div><span class="project-tool__build">{{ isKubernetes ? (published ? `Built ${published.id}` : 'No image built') : (published ? `Published ${published.id}` : 'No image published') }}</span></header>
    <div class="project-tool__body">
      <nav class="project-tool__files" aria-label="Project file list">
        <button v-for="item in files" :key="item" type="button" :aria-current="path === item ? 'page' : undefined" @click="selectFile(item)">{{ item }}</button>
      </nav>
      <div class="project-tool__editor">
        <div class="project-tool__file-head"><strong>{{ path }}</strong><span>{{ dirty ? 'Draft differs from saved' : 'Saved version' }} {{ version }}</span></div>
        <p v-if="isKubernetes" class="project-tool__state">Saved: edits become build/apply input only after Save. Built: {{ published ? published.id : 'no image yet' }}. Applied: {{ applied }}</p>
        <label class="project-tool__label" for="project-source">File contents</label>
        <textarea id="project-source" :value="text" :disabled="locked || fixed" :readonly="fixed" spellcheck="false" @input="edit" />
        <div class="project-tool__actions"><span role="status">{{ fixed ? 'Fixed helper · read-only' : message || (run.unsaved ? 'Saving draft…' : dirty ? 'Unsaved draft' : 'Saved source') }}</span><button type="button" class="btn btn--primary" :disabled="locked || fixed || run.busy || !dirty" @click="save">Save file</button></div>
        <ul v-if="run.diagnostics?.length" class="project-tool__diagnostics" aria-label="Diagnostics"><li v-for="(item, i) in run.diagnostics" :key="i">{{ item.path || path }}{{ item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '' }}: {{ item.code }} — {{ item.message }}</li></ul>
      </div>
    </div>
  </section>
</template>

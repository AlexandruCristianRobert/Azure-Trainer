<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { getProjectManifest } from '../../lib/project/manifests.js'
import { bicepCommandSource } from '../../lib/az/commands/deployment.js'
import { bicepTargetKey } from '../../lib/bicep/provenance.js'

const store = useLabRunStore()
const run = computed(() => store.behavioralRun)
const targets = computed(() => store.lab?.bicepTargets ?? null)
const selectedTargetIndex = ref(0)
const target = computed(() => targets.value?.[selectedTargetIndex.value] ?? store.lab?.bicepInspect ?? {})
const project = computed(() => run.value?.project)
const capstone = computed(() => store.lab?.capabilities?.acaCapstone === true)
const source = computed(() => project.value ? bicepCommandSource({ project: project.value }, target.value.parameterPath) : null)
const paths = computed(() => {
  if (!project.value) return []
  const listed = getProjectManifest(project.value.manifestId).bicepFiles ?? []
  if (capstone.value) return listed.filter(path => Object.hasOwn(source.value?.fileVersions ?? {}, path))
  return targets.value ? listed.filter(path => path.endsWith('.bicep') || path === target.value.parameterPath) : listed
})
const key = computed(() => bicepTargetKey(target.value.resourceGroup ?? '', target.value.deploymentName ?? ''))
const history = computed(() => run.value?.runtime?.bicep?.currentByTarget?.[key.value] ?? {})
const preview = computed(() => history.value.preview ?? null)
const incidentPreview = computed(() => store.lab?.capabilities?.bicepIdentityFault
  ? run.value?.runtime?.bicep?.incidentPreview ?? null : null)
const attempt = computed(() => history.value.latest ?? null)
const draftPaths = computed(() => paths.value.filter(path => project.value?.draftFiles?.[path] !== project.value?.savedFiles?.[path]))
const diagnostics = computed(() => store.diagnostics?.filter(item => item.path && Number.isInteger(item.line) && Number.isInteger(item.column)) ?? [])
const previewCurrent = computed(() => !!preview.value && !!source.value
  && preview.value.sourceHash === source.value.sourceHash
  && preview.value.parameterHash === source.value.parameterHash
  && preview.value.key === key.value
  && paths.value.every(path => preview.value.fileVersions[path] === source.value.fileVersions[path]))
const attemptCurrent = computed(() => !!attempt.value && !!source.value
  && attempt.value.status === 'succeeded'
  && attempt.value.sourceHash === source.value.sourceHash
  && attempt.value.parameterHash === source.value.parameterHash
  && attempt.value.key === key.value
  && (!targets.value || attempt.value.parameterPath === target.value.parameterPath)
  && paths.value.every(path => attempt.value.fileVersions?.[path] === source.value.fileVersions[path]))
const operationLabel = { create: 'Create', modify: 'Modify', 'no-change': 'No change', 'ignored-existing': 'Ignored existing' }
const outputs = computed(() => Object.entries(attempt.value?.outputs ?? {}))
const outputText = value => typeof value === 'string' ? value : JSON.stringify(value)
const incident = computed(() => capstone.value && target.value.templatePath === 'infra/main.bicep'
  ? run.value?.runtime?.incident ?? null : null)
const targetLabel = choice => capstone.value
  ? choice.templatePath === 'infra/bootstrap.bicep' ? 'Bootstrap' : 'Main application'
  : choice.deploymentName === 'primary' ? 'Primary' : 'Staging'
</script>

<template>
  <section class="bicep-panel" aria-label="Bicep deployment">
    <header class="bicep-panel__head">
      <div><h2>Deployment review</h2><p>Commands run in Cloud Shell. This view reads saved files and recorded results.</p></div>
      <span v-if="store.readOnly || store.completedAt" class="bicep-panel__readonly">Read-only result</span>
    </header>
    <p class="bicep-panel__notice">This is a local simulation of a supported Bicep deployment. No Azure resources are created.</p>
    <div v-if="targets" class="bicep-panel__target-picker" role="group" aria-label="Deployment review target">
      <span>Review target</span>
      <div class="bicep-panel__target-options">
        <button v-for="(choice, index) in targets" :key="choice.parameterPath" type="button"
          :aria-pressed="selectedTargetIndex === index" @click="selectedTargetIndex = index">{{ targetLabel(choice) }}</button>
      </div>
    </div>
    <div class="bicep-panel__context">
      <div><h3>Saved Bicep project</h3><p>{{ paths.length }} Bicep files · saved versions drive commands</p><ul class="bicep-panel__files"><li v-for="path in paths" :key="path"><code>{{ path }}</code><span>version {{ project.fileVersions[path] ?? 0 }}<template v-if="targets && project.draftFiles[path] !== project.savedFiles[path]"> · unsaved draft</template></span></li></ul></div>
      <div><h3>Selected target</h3><p><strong>{{ target.resourceGroup }}</strong> / <strong>{{ target.deploymentName }}</strong></p><p>Resource group / deployment name</p><p v-if="targets">Parameter file: <code>{{ target.parameterPath }}</code></p><p v-if="targets && source">Parameter hash: <code>{{ source.parameterHash }}</code></p></div>
    </div>
    <p v-if="draftPaths.length" class="bicep-panel__draft">{{ draftPaths.length }} unsaved draft {{ draftPaths.length === 1 ? 'file' : 'files' }}. Save before validating or previewing; commands use saved versions.</p>
    <section v-if="incident" class="bicep-panel__drift" aria-label="Simulated incident drift">
      <h3>Simulated incident · {{ incident.status }}</h3>
      <p>Saved desired Foundry deployment: <code>{{ incident.desiredDeployment }}</code></p>
      <p>Live effective deployment: <code>{{ incident.status === 'active' ? 'missing-deployment' : incident.desiredDeployment }}</code></p>
      <p v-if="incident.status === 'active'">The saved main source is still correct. Preview this target in Cloud Shell to see the app modification, then reapply it to restore the live setting.</p>
      <p v-else>Saved main Bicep was reapplied to restore the live setting.</p>
    </section>

    <section class="bicep-panel__section" aria-labelledby="bicep-validation-heading">
      <h3 id="bicep-validation-heading">Validation diagnostics</h3>
      <p v-if="!diagnostics.length" class="bicep-panel__muted">No current located diagnostics. Run validate in Cloud Shell to check saved files.</p>
      <ul v-else class="bicep-panel__diagnostics" role="alert"><li v-for="(item, index) in diagnostics" :key="index"><code>{{ item.path }}:{{ item.line }}:{{ item.column }}</code> <strong>{{ item.code }}</strong> {{ item.message }}</li></ul>
    </section>

    <section class="bicep-panel__section" aria-labelledby="bicep-preview-heading">
      <div class="bicep-panel__section-head"><h3 id="bicep-preview-heading">What-if preview</h3><span v-if="preview" class="bicep-panel__state" :class="previewCurrent ? 'bicep-panel__state--current' : 'bicep-panel__state--stale'">{{ previewCurrent ? 'Current preview' : 'Stale preview' }}</span></div>
      <div class="bicep-panel__previews" :class="{ 'bicep-panel__previews--incident': incidentPreview }">
        <section v-if="incidentPreview" class="bicep-panel__preview-card bicep-panel__preview-card--historical" aria-labelledby="bicep-historical-heading">
          <div class="bicep-panel__section-head"><h4 id="bicep-historical-heading">Historical preview</h4><span class="bicep-panel__state bicep-panel__state--stale">Earlier saved files</span></div>
          <p class="bicep-panel__muted">The first wrong-target what-if is kept for comparison. It did not create resources.</p>
          <p class="bicep-panel__meta">{{ incidentPreview.name }} in {{ incidentPreview.target }} · {{ incidentPreview.id }}</p>
          <ul class="bicep-panel__operations"><li v-for="(item, index) in incidentPreview.operations" :key="`${item.id}-${index}`"><span class="bicep-panel__change" :class="`bicep-panel__change--${item.changeType}`">{{ operationLabel[item.changeType] }}</span><span><strong>{{ item.name }}</strong><small>{{ item.type }}</small><code>{{ item.id }}</code></span></li></ul>
        </section>
        <section class="bicep-panel__preview-card" :aria-labelledby="incidentPreview ? 'bicep-current-heading' : 'bicep-preview-heading'">
          <h4 v-if="incidentPreview" id="bicep-current-heading">{{ !preview ? 'Saved-file preview' : previewCurrent ? 'Current saved-file preview' : 'Latest recorded preview' }}</h4>
          <p v-if="!preview" class="bicep-panel__muted">No what-if preview yet. Run what-if in Cloud Shell after validation.</p>
          <template v-else>
            <p v-if="!previewCurrent" class="bicep-panel__stale">Saved files or target changed since this preview. Run what-if again before deployment.</p>
            <p class="bicep-panel__meta">{{ preview.name }} in {{ preview.target }} · {{ preview.id }}</p>
            <ul class="bicep-panel__operations"><li v-for="(item, index) in preview.operations" :key="`${item.id}-${index}`"><span class="bicep-panel__change" :class="`bicep-panel__change--${item.changeType}`">{{ operationLabel[item.changeType] }}</span><span><strong>{{ item.name }}</strong><small>{{ item.type }}</small><code>{{ item.id }}</code></span></li></ul>
          </template>
        </section>
      </div>
    </section>

    <section class="bicep-panel__section" aria-labelledby="bicep-attempt-heading">
      <div class="bicep-panel__section-head"><h3 id="bicep-attempt-heading">Last deployment</h3><span v-if="attempt" class="bicep-panel__state" :class="(targets ? attemptCurrent : attempt.status === 'succeeded') ? 'bicep-panel__state--current' : 'bicep-panel__state--stale'">{{ attempt.status === 'failed' ? 'Failed' : targets ? attemptCurrent ? 'Current deployment' : 'Stale deployment' : 'Succeeded' }}</span></div>
      <p v-if="!attempt" class="bicep-panel__muted">No deployment attempt yet. Run create in Cloud Shell when the preview is ready.</p>
      <template v-else>
        <p v-if="targets && attempt.status === 'succeeded' && !attemptCurrent" class="bicep-panel__stale">Saved files or target changed since this deployment. Outputs below are from the recorded deployment.</p>
        <p class="bicep-panel__meta">{{ attempt.name }} in {{ attempt.target }} · {{ attempt.id }}</p>
        <h4>{{ attempt.status === 'failed' ? 'Applied before failure' : 'Applied operations' }}</h4>
        <p v-if="!attempt.operations.length" class="bicep-panel__muted">No resource operations were applied.</p>
        <ul v-else class="bicep-panel__operations"><li v-for="(item, index) in attempt.operations" :key="`${item.id}-${index}`"><span class="bicep-panel__change" :class="`bicep-panel__change--${item.changeType}`">{{ operationLabel[item.changeType] }}</span><span><strong>{{ item.name }}</strong><small>{{ item.type }}</small><code>{{ item.id }}</code></span></li></ul>
        <ul v-if="attempt.diagnostics?.length" class="bicep-panel__diagnostics" role="alert"><li v-for="(item, index) in attempt.diagnostics" :key="index"><code v-if="item.path">{{ item.path }}:{{ item.line }}:{{ item.column }}</code> <strong>{{ item.code }}</strong> {{ item.message }}</li></ul>
        <div v-if="attempt.status === 'succeeded' && outputs.length" class="bicep-panel__outputs"><h4>{{ targets && !attemptCurrent ? 'Recorded deployment outputs (stale)' : 'Deployment outputs' }}</h4><dl><div v-for="([name, value]) in outputs" :key="name"><dt>{{ name }}</dt><dd><code>{{ outputText(value) }}</code></dd></div></dl></div>
      </template>
    </section>
  </section>
</template>

<script setup>
import { usePortalStore } from '../../stores/portal.js'
import { useLabRunStore } from '../../stores/labRun.js'
import FluentIcon from '../icons/FluentIcon.vue'
import ShellTerminal from './ShellTerminal.vue'

const portal = usePortalStore()
const run = useLabRunStore()
</script>

<template>
  <section class="shell" :class="{ 'shell--minimized': portal.shell.minimized, 'shell--maximized': portal.shell.maximized }" aria-label="Cloud Shell">
    <div class="shell__header">
      <div class="shell__handle" aria-hidden="true" />
      <button type="button" class="shell__bash" aria-label="Shell type">Bash <FluentIcon name="chevron-down" :size="10" /></button>
      <div class="shell__spacer" />
      <div class="shell__tools">
        <button type="button" aria-label="Restart Cloud Shell" title="Restart" :disabled="run.lab?.engineVersion === 2 && (run.readOnly || run.completedAt || run.busy || run.storageError)" @click="run.clearScrollback()"><FluentIcon name="arrow-counterclockwise" :size="14" /></button>
        <button type="button" aria-label="Upload/Download files" title="Upload/Download files"><FluentIcon name="arrow-sort" :size="14" /></button>
        <button type="button" aria-label="Open new session" title="Open new session"><FluentIcon name="add" :size="14" /></button>
        <button type="button" aria-label="Open editor" title="Open editor"><FluentIcon name="code" :size="14" /></button>
        <button type="button" aria-label="Web preview" title="Web preview"><FluentIcon name="open" :size="14" /></button>
        <button type="button" aria-label="More" title="More"><FluentIcon name="more-horizontal" :size="14" /></button>
        <button type="button" aria-label="Help" title="Help" :disabled="run.lab?.engineVersion === 2 && (run.readOnly || run.completedAt || run.busy || run.storageError)" @click="run.execute('az --help')"><FluentIcon name="question-circle" :size="14" /></button>
        <button type="button" aria-label="Minimize" title="Minimize" @click="portal.toggleShellMinimized()"><FluentIcon name="subtract" :size="14" /></button>
        <button type="button" aria-label="Maximize" title="Maximize" @click="portal.toggleShellMaximized()"><FluentIcon name="maximize" :size="14" /></button>
        <button type="button" aria-label="Close Cloud Shell" title="Close" @click="portal.closeShell()"><FluentIcon name="dismiss" :size="14" /></button>
      </div>
    </div>
    <ShellTerminal v-if="!portal.shell.minimized" />
  </section>
</template>

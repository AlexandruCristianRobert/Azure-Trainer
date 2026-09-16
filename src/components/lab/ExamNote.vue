<script setup>
import { renderInline } from '../../lib/inlineCode.js'
defineProps({ text: { type: String, required: true } })
</script>

<template>
  <div class="exam-note">
    <div class="exam-note__label">EXAM NOTE</div>
    <div class="exam-note__text" v-html="renderInline(text)" />
  </div>
</template>

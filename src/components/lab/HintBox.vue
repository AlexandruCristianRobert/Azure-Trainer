<script setup>
import { renderInline } from '../../lib/inlineCode.js'
defineProps({ index: { type: Number, required: true }, total: { type: Number, required: true }, text: { type: String, required: true } })
</script>

<template>
  <div class="hint-box">
    <div class="hint-box__label">HINT {{ index }} OF {{ total }}</div>
    <div class="hint-box__text" v-html="renderInline(text)" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { fluentIcon } from '../../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 },
})
const svg = computed(() => fluentIcon(props.name))
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="icon icon--fluent" :style="style" aria-hidden="true" v-html="svg" />
</template>

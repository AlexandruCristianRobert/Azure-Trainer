<script setup>
import { computed } from 'vue'
import { azureIcon } from '../../lib/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 20 },
})
const svg = computed(() => azureIcon(props.name))
const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="icon icon--azure" :style="style" aria-hidden="true" v-html="svg" />
</template>

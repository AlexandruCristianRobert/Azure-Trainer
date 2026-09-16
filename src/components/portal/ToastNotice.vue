<script setup>
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'

const portal = usePortalStore()
const route = useRoute()
const style = computed(() => ({ right: route.name === 'lab' && !portal.labPanelCollapsed ? '372px' : '24px' }))

let timer = null
watch(() => portal.toast, (t) => {
  if (timer) clearTimeout(timer)
  if (t) timer = setTimeout(() => portal.dismissToast(), 8000)
})
</script>

<template>
  <div v-if="portal.toast" class="toast" role="status" :style="style">
    <span class="toast__dot" aria-hidden="true"><FluentIcon name="checkmark" :size="10" /></span>
    <div class="toast__body">
      <div class="toast__title">{{ portal.toast.title }}</div>
      <div class="toast__text">{{ portal.toast.text }}</div>
    </div>
    <button type="button" class="toast__close" aria-label="Dismiss" @click="portal.dismissToast()"><FluentIcon name="dismiss" :size="12" /></button>
  </div>
</template>

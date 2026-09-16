<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'

defineProps({ items: { type: Array, required: true } })
const emit = defineEmits(['navigate'])
const open = ref(true)
</script>

<template>
  <div class="essentials">
    <div class="essentials__head">
      <button type="button" class="essentials__toggle" :aria-expanded="open" @click="open = !open">Essentials <FluentIcon :name="open ? 'chevron-up' : 'chevron-down'" :size="11" /></button>
      <a href="#" @click.prevent>JSON View</a>
    </div>
    <div v-if="open" class="essentials__grid">
      <div v-for="item in items" :key="item.label" class="essentials__row" :class="{ 'essentials__row--ellipsis': item.ellipsis }">
        <div class="essentials__label">{{ item.label }}</div>
        <a v-if="item.blade" href="#" @click.prevent="emit('navigate', item.blade)">{{ item.value }}</a>
        <a v-else-if="item.link" href="#" @click.prevent>{{ item.value }}</a>
        <div v-else class="essentials__value">{{ item.value }}</div>
      </div>
    </div>
  </div>
</template>

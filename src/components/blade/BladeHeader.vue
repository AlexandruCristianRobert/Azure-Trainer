<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'
import AzureIcon from '../icons/AzureIcon.vue'

defineProps({
  crumbs: { type: Array, required: true },
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  icon: { type: String, default: '' },
  iconTint: { type: String, default: 'var(--tint-blue)' },
  commands: { type: Array, default: () => [] },
})
const emit = defineEmits(['navigate', 'command'])
const notice = ref('')
let timer = null
function onCommand(cmd) {
  emit('command', cmd.label)
  if (cmd.readOnlyHint) {
    notice.value = cmd.readOnlyHint
    clearTimeout(timer)
    timer = setTimeout(() => { notice.value = '' }, 5000)
  }
}
</script>

<template>
  <div class="blade-header">
    <div class="blade-header__crumbs">
      <template v-for="(c, i) in crumbs" :key="i">
        <RouterLink v-if="c.route" :to="c.route">{{ c.label }}</RouterLink>
        <a v-else-if="c.blade" href="#" @click.prevent="emit('navigate', c.blade)">{{ c.label }}</a>
        <span v-else>{{ c.label }}</span>
        <span v-if="i < crumbs.length - 1" class="blade-header__sep">&gt;</span>
      </template>
    </div>
    <div class="blade-header__title-row">
      <div v-if="icon" class="blade-header__icon" :style="{ background: iconTint }"><AzureIcon :name="icon" :size="20" /></div>
      <div class="blade-header__titles">
        <h1 class="blade-header__title">{{ title }}</h1>
        <div v-if="subtitle" class="blade-header__subtitle">{{ subtitle }}</div>
      </div>
      <div class="blade-header__tools">
        <button type="button" aria-label="Add to favorites"><FluentIcon name="star" :size="15" /></button>
        <button type="button" aria-label="Pin to dashboard"><FluentIcon name="pin" :size="14" /></button>
        <button type="button" aria-label="Close" @click="emit('navigate', { kind: 'resource-groups' })"><FluentIcon name="dismiss" :size="13" /></button>
      </div>
    </div>
    <div v-if="commands.length" class="command-bar">
      <template v-for="(cmd, i) in commands" :key="i">
        <span v-if="cmd.divider" class="command-bar__divider" />
        <button v-else type="button" class="command-bar__btn" @click="onCommand(cmd)">
          <FluentIcon :name="cmd.icon" :size="14" />{{ cmd.label }}
        </button>
      </template>
    </div>
    <div v-if="notice" class="blade-header__notice" role="status">{{ notice }}</div>
  </div>
</template>

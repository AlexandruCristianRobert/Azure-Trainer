<script setup>
import { ref } from 'vue'
import FluentIcon from '../icons/FluentIcon.vue'

const props = defineProps({
  sections: { type: Array, required: true },
  activeId: { type: String, default: 'overview' },
})
const emit = defineEmits(['select'])
const collapsed = ref(Object.fromEntries(props.sections.filter((s) => s.label).map((s) => [s.label, !!s.collapsed])))
function toggle(label) { collapsed.value[label] = !collapsed.value[label] }
</script>

<template>
  <nav class="resource-menu" aria-label="Resource menu">
    <label class="resource-menu__search"><FluentIcon name="search" :size="13" /><input type="search" placeholder="Search" aria-label="Search resource menu" /></label>
    <template v-for="section in sections" :key="section.label ?? 'root'">
      <button v-if="section.label" type="button" class="resource-menu__group" :aria-expanded="!collapsed[section.label]" @click="toggle(section.label)">
        {{ section.label }}<FluentIcon :name="collapsed[section.label] ? 'chevron-right' : 'chevron-down'" :size="12" />
      </button>
      <template v-if="!section.label || !collapsed[section.label]">
        <button v-for="item in section.items" :key="item.id" type="button" class="resource-menu__item" :class="{ 'resource-menu__item--active': item.id === activeId, 'resource-menu__item--nested': !!section.label }" @click="emit('select', item.id)">
          {{ item.label }}
        </button>
      </template>
    </template>
  </nav>
</template>

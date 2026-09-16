<script setup>
defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, required: true },
  emptyText: { type: String, default: 'No items to display' },
  nameKey: { type: String, default: 'name' },
})
const emit = defineEmits(['open'])
</script>

<template>
  <div class="entity-table" :style="{ '--cols': columns.map((c) => `${c.grow ?? 1}fr`).join(' ') }">
    <div class="entity-table__head">
      <div v-for="c in columns" :key="c.key">{{ c.label }}</div>
    </div>
    <div v-if="!rows.length" class="entity-table__empty">{{ emptyText }}</div>
    <div v-for="row in rows" :key="row[nameKey]" class="entity-table__row">
      <template v-for="c in columns" :key="c.key">
        <a v-if="c.key === nameKey" href="#" @click.prevent="emit('open', row)">{{ row[c.key] }}</a>
        <div v-else-if="c.key === 'status'" class="entity-table__status"><span class="entity-table__dot" :class="{ 'entity-table__dot--off': row.status !== 'Active' }" />{{ row[c.key] }}</div>
        <div v-else>{{ row[c.key] }}</div>
      </template>
    </div>
  </div>
</template>

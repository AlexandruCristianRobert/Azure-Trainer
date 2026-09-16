<script setup>
defineProps({ labId: { type: String, required: true } })
</script>

<template>
  <main class="lab">Lab {{ labId }}</main>
</template>

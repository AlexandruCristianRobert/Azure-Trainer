<script setup>
defineProps({ record: { type: Object, default: null } })
</script>

<template>
  <section class="evidence-details" aria-label="Request evidence">
    <h3>Verification evidence</h3>
    <p v-if="!record">No request evidence yet. Send a request to observe the running deployment.</p>
    <template v-else>
      <dl><dt>Outcome</dt><dd>{{ record.outcome }}</dd><dt>HTTP status</dt><dd>{{ record.measurements?.status }}</dd><dt>Request</dt><dd>{{ record.measurements?.method }} {{ record.measurements?.path }}</dd><dt>Evidence ID</dt><dd>{{ record.id }}</dd><dt>Attempt</dt><dd>{{ record.attemptId }}</dd></dl>
      <pre>{{ JSON.stringify(record.measurements?.body, null, 2) }}</pre>
    </template>
  </section>
</template>

<script setup>
import { SERVICES, HOME_SERVICES } from '../../data/services.js'
import AzureIcon from '../icons/AzureIcon.vue'
</script>

<template>
  <div class="svc-row">
    <div class="svc-tile">
      <div class="svc-tile__icon svc-tile__icon--create" style="background: var(--tint-blue)">+</div>
      <div class="svc-tile__label">Create a resource</div>
    </div>
    <div v-for="key in HOME_SERVICES" :key="key" class="svc-tile">
      <div class="svc-tile__icon" :style="{ background: SERVICES[key].tint }"><AzureIcon :name="SERVICES[key].icon" :size="22" /></div>
      <div class="svc-tile__label">{{ SERVICES[key].label }}</div>
    </div>
    <div class="svc-tile">
      <div class="svc-tile__icon svc-tile__icon--more" style="background: var(--tint-grey)">···</div>
      <div class="svc-tile__label">More services</div>
    </div>
  </div>
</template>

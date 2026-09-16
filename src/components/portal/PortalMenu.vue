<script setup>
import { usePortalStore } from '../../stores/portal.js'
import AzureIcon from '../icons/AzureIcon.vue'

const portal = usePortalStore()
</script>

<template>
  <div v-if="portal.menuOpen" class="pane pane--menu" role="menu">
    <RouterLink class="pane__item" to="/" role="menuitem" @click="portal.closePanes()"><AzureIcon name="dashboard" :size="16" /> Home</RouterLink>
    <RouterLink class="pane__item" to="/#labs" role="menuitem" @click="portal.closePanes()"><AzureIcon name="all-resources" :size="16" /> Labs</RouterLink>
    <div class="pane__section">Favorites</div>
    <div class="pane__item pane__item--static"><AzureIcon name="resource-group" :size="16" /> Resource groups</div>
    <div class="pane__item pane__item--static"><AzureIcon name="service-bus" :size="16" /> Service Bus</div>
    <div class="pane__item pane__item--static"><AzureIcon name="subscription" :size="16" /> Subscriptions</div>
  </div>
</template>

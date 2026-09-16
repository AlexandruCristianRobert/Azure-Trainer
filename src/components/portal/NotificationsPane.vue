<script setup>
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'
import { relativeTime } from '../../lib/format.js'

const portal = usePortalStore()
</script>

<template>
  <aside v-if="portal.notificationsOpen" class="pane pane--notifications" aria-label="Notifications">
    <div class="pane__header">
      <span>Notifications</span>
      <button type="button" class="pane__link" @click="portal.dismissNotifications()">Dismiss all</button>
      <button type="button" class="pane__close" aria-label="Close" @click="portal.toggleNotifications()"><FluentIcon name="dismiss" :size="14" /></button>
    </div>
    <div v-if="!portal.notifications.length" class="pane__empty">No new notifications</div>
    <ul v-else class="pane__list">
      <li v-for="n in portal.notifications" :key="n.id" class="notice">
        <span class="notice__dot" aria-hidden="true"><FluentIcon name="checkmark" :size="10" /></span>
        <div class="notice__body">
          <div class="notice__title">{{ n.title }}</div>
          <div class="notice__text">{{ n.text }}</div>
          <div class="notice__time">{{ relativeTime(n.at) }}</div>
        </div>
      </li>
    </ul>
  </aside>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { usePortalStore } from '../../stores/portal.js'
import FluentIcon from '../icons/FluentIcon.vue'
import AzureIcon from '../icons/AzureIcon.vue'

const portal = usePortalStore()
const router = useRouter()
const route = useRoute()

function onShellClick() {
  if (route.name === 'lab') portal.toggleShell()
  else portal.openShell()
}
</script>

<template>
  <header class="portal-header">
    <button class="portal-header__icon-btn" type="button" aria-label="Show portal menu" :aria-expanded="portal.menuOpen" @click="portal.toggleMenu()">
      <FluentIcon name="navigation" :size="20" />
    </button>
    <RouterLink class="portal-header__brand" to="/" @click="portal.closePanes()">
      <AzureIcon name="azure-logo" :size="18" />
      <span>Azure-Trainer</span>
    </RouterLink>
    <div class="portal-header__search-wrap">
      <label class="portal-header__search">
        <FluentIcon name="search" :size="14" />
        <input type="search" placeholder="Search resources, services, and labs  ( / )" aria-label="Search resources, services, and labs" />
      </label>
    </div>
    <nav class="portal-header__actions" aria-label="Portal actions">
      <button class="portal-header__icon-btn" type="button" aria-label="Cloud Shell" :aria-pressed="portal.shell.visible" @click="onShellClick"><FluentIcon name="window-console" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Notifications" :aria-expanded="portal.notificationsOpen" @click="portal.toggleNotifications()">
        <FluentIcon name="alert" :size="18" />
        <span v-if="portal.unread" class="portal-header__badge">{{ portal.unread }}</span>
      </button>
      <button class="portal-header__icon-btn" type="button" aria-label="Settings"><FluentIcon name="settings" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Help + support"><FluentIcon name="question-circle" :size="18" /></button>
      <button class="portal-header__icon-btn" type="button" aria-label="Feedback"><FluentIcon name="person-feedback" :size="18" /></button>
    </nav>
    <div class="portal-header__account">
      <div class="portal-header__account-text">
        <div class="portal-header__account-name">Sam Learner</div>
        <div class="portal-header__account-dir">Sandbox directory</div>
      </div>
      <div class="portal-header__avatar" aria-hidden="true">SL</div>
    </div>
  </header>
</template>

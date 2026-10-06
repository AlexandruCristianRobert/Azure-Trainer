<script setup>
import PortalHeader from './components/portal/PortalHeader.vue'
import NotificationsPane from './components/portal/NotificationsPane.vue'
import PortalMenu from './components/portal/PortalMenu.vue'
import ToastNotice from './components/portal/ToastNotice.vue'
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <div class="at-root" :class="{ 'at-root--exam': route.meta.exam }">
    <PortalHeader />
    <PortalMenu />
    <NotificationsPane />
    <ToastNotice />
    <RouterView />
  </div>
</template>

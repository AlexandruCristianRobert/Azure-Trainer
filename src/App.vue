<script setup>
import PortalHeader from './components/portal/PortalHeader.vue'
import NotificationsPane from './components/portal/NotificationsPane.vue'
import PortalMenu from './components/portal/PortalMenu.vue'
import ToastNotice from './components/portal/ToastNotice.vue'
</script>

<template>
  <div class="at-root">
    <PortalHeader />
    <PortalMenu />
    <NotificationsPane />
    <ToastNotice />
    <RouterView />
  </div>
</template>

import { defineStore } from 'pinia'

export const DEFAULT_BLADE = { kind: 'resource-groups' }

const TYPE_LABEL = { resourceGroup: 'resource group', namespace: 'Service Bus namespace', queue: 'queue', topic: 'topic', subscription: 'subscription', rule: 'rule' }
const VERB = { created: 'Created', updated: 'Updated', deleted: 'Deleted' }
const TITLE = { created: 'Deployment succeeded', updated: 'Update succeeded', deleted: 'Deleted' }

export function notificationForEvent(e) {
  let where = ''
  if (e.resourceType === 'queue' || e.resourceType === 'topic') where = ` in ${e.namespace}`
  else if (e.resourceType === 'subscription') where = ` on ${e.topic}`
  else if (e.resourceType === 'rule') where = ` on ${e.subscription}`
  return { title: TITLE[e.type], text: `${VERB[e.type]} ${TYPE_LABEL[e.resourceType]} '${e.name}'${where}.` }
}

function namespaceBlade(e, tab) {
  return { kind: 'servicebus-namespace', resourceGroup: e.resourceGroup, name: e.namespace ?? e.name, tab }
}

export function bladeForEvent(e, current) {
  if (e.type === 'created' || e.type === 'updated') {
    switch (e.resourceType) {
      case 'resourceGroup': return { kind: 'resource-group', name: e.name }
      case 'namespace': return namespaceBlade(e, 'queues')
      case 'queue': return namespaceBlade(e, 'queues')
      default: return namespaceBlade(e, 'topics')
    }
  }
  // deleted
  if (e.resourceType === 'resourceGroup') {
    const affected = (current.kind === 'resource-group' && current.name === e.name) || (current.kind === 'servicebus-namespace' && current.resourceGroup === e.name)
    return affected ? DEFAULT_BLADE : current
  }
  if (e.resourceType === 'namespace') {
    const affected = current.kind === 'servicebus-namespace' && current.name === e.name && current.resourceGroup === e.resourceGroup
    return affected ? { kind: 'resource-group', name: e.resourceGroup } : current
  }
  return current
}

let seq = 0

export const usePortalStore = defineStore('portal', {
  state: () => ({
    notifications: [],
    unread: 0,
    notificationsOpen: false,
    menuOpen: false,
    toast: null,
    shell: { visible: true, minimized: false, maximized: false },
    labPanelCollapsed: false,
    blade: { ...DEFAULT_BLADE },
  }),
  actions: {
    notify(title, text) {
      this.notifications.unshift({ id: `n_${Date.now()}_${seq++}`, title, text, at: new Date().toISOString() })
      if (this.notifications.length > 50) this.notifications.length = 50
      if (!this.notificationsOpen) this.unread++
    },
    toggleNotifications() {
      this.notificationsOpen = !this.notificationsOpen
      this.menuOpen = false
      if (this.notificationsOpen) this.unread = 0
    },
    toggleMenu() {
      this.menuOpen = !this.menuOpen
      this.notificationsOpen = false
    },
    closePanes() {
      this.notificationsOpen = false
      this.menuOpen = false
    },
    dismissNotifications() {
      this.notifications = []
      this.unread = 0
    },
    showToast(title, text) {
      this.toast = { title, text }
    },
    dismissToast() {
      this.toast = null
    },
    toggleShell() {
      if (this.shell.visible) this.shell = { visible: false, minimized: false, maximized: false }
      else this.shell = { visible: true, minimized: false, maximized: false }
    },
    openShell() {
      this.shell = { visible: true, minimized: false, maximized: this.shell.maximized }
    },
    closeShell() {
      this.shell = { visible: false, minimized: false, maximized: false }
    },
    toggleShellMinimized() {
      this.shell = { visible: true, minimized: !this.shell.minimized, maximized: false }
    },
    toggleShellMaximized() {
      this.shell = { visible: true, minimized: false, maximized: !this.shell.maximized }
    },
    toggleLabPanel() {
      this.labPanelCollapsed = !this.labPanelCollapsed
    },
    showBlade(blade) {
      this.blade = blade
    },
    applyEvent(e) {
      this.blade = bladeForEvent(e, this.blade)
      const n = notificationForEvent(e)
      this.notify(n.title, n.text)
    },
    resetForLab() {
      this.blade = { ...DEFAULT_BLADE }
      this.toast = null
      this.notifications = []
      this.unread = 0
      this.notificationsOpen = false
      this.menuOpen = false
    },
  },
})

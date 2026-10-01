import { defineStore } from 'pinia'

export const DEFAULT_BLADE = { kind: 'resource-groups' }

const TYPE_LABEL = { resourceGroup: 'resource group', namespace: 'Service Bus namespace', queue: 'queue', topic: 'topic', subscription: 'subscription', rule: 'rule', containerAppEnvironment: 'Container Apps environment', containerApp: 'Container App', containerRegistry: 'container registry', managedIdentity: 'managed identity', aksCluster: 'Kubernetes service', registryRoleAssignment: 'registry role assignment', imageBuild: 'image build', cosmosAccount: 'Cosmos DB account', cosmosDatabase: 'Cosmos DB database', cosmosContainer: 'Cosmos DB container', keyVault: 'Key Vault', keyVaultRoleAssignment: 'Key Vault role assignment', keyVaultSecret: 'Key Vault secret', storageAccount: 'storage account', functionApp: 'Function App', eventGridTopic: 'Event Grid topic', eventGridSubscription: 'Event Grid subscription' }
const VERB = { created: 'Created', updated: 'Updated', deleted: 'Deleted' }
TYPE_LABEL.postgresServer = 'PostgreSQL flexible server'
TYPE_LABEL.postgresDatabase = 'PostgreSQL database'
const TITLE = { created: 'Deployment succeeded', updated: 'Update succeeded', deleted: 'Deleted' }

export function notificationForEvent(e) {
  let where = ''
  if (e.resourceType === 'queue' || e.resourceType === 'topic') where = ` in ${e.namespace}`
  else if (e.resourceType === 'subscription') where = ` on ${e.topic}`
  else if (e.resourceType === 'rule') where = ` on ${e.subscription}`
  else if (e.resourceType === 'cosmosDatabase') where = ` in ${e.account}`
  else if (e.resourceType === 'postgresDatabase') where = ` in ${e.server}`
  else if (e.resourceType === 'cosmosContainer') where = ` in ${e.database}`
  else if (e.resourceType === 'keyVaultRoleAssignment') where = ` on ${e.vault}`
  else if (e.resourceType === 'keyVaultSecret') where = ` in ${e.vault}`
  else if (e.resourceType === 'eventGridSubscription') where = ` on ${e.topic}`
  const verb = VERB[e.type] ?? 'Changed'
  return { title: TITLE[e.type] ?? 'Resource changed', text: `${verb} ${TYPE_LABEL[e.resourceType] ?? 'resource'} '${e.name}'${where}.` }
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
      case 'topic':
      case 'subscription':
      case 'rule': return namespaceBlade(e, 'topics')
      case 'containerAppEnvironment': return { kind: 'containerapp-environment', resourceGroup: e.resourceGroup, name: e.name }
      case 'containerApp': return { kind: 'containerapp', resourceGroup: e.resourceGroup, name: e.name }
      case 'containerRegistry': return { kind: 'container-registry', resourceGroup: e.resourceGroup, name: e.name }
      case 'managedIdentity': return { kind: 'managed-identity', resourceGroup: e.resourceGroup, name: e.name }
      case 'aksCluster': return { kind: 'aks-cluster', resourceGroup: e.resourceGroup, name: e.name }
      case 'registryRoleAssignment': return { kind: 'container-registry', resourceGroup: e.resourceGroup, name: e.registry }
      case 'imageBuild': return current
      case 'cosmosAccount': return { kind: 'cosmos-account', resourceGroup: e.resourceGroup, name: e.name }
      case 'postgresServer': return { kind: 'postgres-server', resourceGroup: e.resourceGroup, name: e.name }
      case 'postgresDatabase': return { kind: 'postgres-server', resourceGroup: e.resourceGroup, name: e.server }
      case 'cosmosDatabase': return { kind: 'cosmos-database', resourceGroup: e.resourceGroup, account: e.account, name: e.name }
      case 'cosmosContainer': return { kind: 'cosmos-container', resourceGroup: e.resourceGroup, account: e.account, database: e.database, name: e.name }
      case 'keyVault': return { kind: 'key-vault', resourceGroup: e.resourceGroup, name: e.name }
      case 'keyVaultRoleAssignment': return { kind: 'key-vault', resourceGroup: e.resourceGroup, name: e.vault }
      case 'keyVaultSecret': return { kind: 'key-vault-secret', resourceGroup: e.resourceGroup, vault: e.vault, name: e.name }
      case 'storageAccount': return { kind: 'storage-account', resourceGroup: e.resourceGroup, name: e.name }
      case 'functionApp': return { kind: 'function-app', resourceGroup: e.resourceGroup, name: e.name }
      case 'eventGridTopic': return { kind: 'eventgrid-topic', resourceGroup: e.resourceGroup, name: e.name }
      case 'eventGridSubscription': return { kind: 'eventgrid-subscription', resourceGroup: e.resourceGroup, topic: e.topic, name: e.name }
      default: return current
    }
  }
  if (e.type !== 'deleted') return current
  // deleted
  if (e.resourceType === 'resourceGroup') {
    const affected = (current.kind === 'resource-group' && same(current.name, e.name)) || ('resourceGroup' in current && same(current.resourceGroup, e.name))
    return affected ? { ...DEFAULT_BLADE } : current
  }
  if (e.resourceType === 'namespace') {
    const affected = current.kind === 'servicebus-namespace' && same(current.name, e.name) && same(current.resourceGroup, e.resourceGroup)
    return affected ? { kind: 'resource-group', name: e.resourceGroup } : current
  }
  if (e.resourceType === 'containerAppEnvironment' || e.resourceType === 'containerApp') {
    const kind = e.resourceType === 'containerAppEnvironment' ? 'containerapp-environment' : 'containerapp'
    const affected = current.kind === kind && same(current.name, e.name) && same(current.resourceGroup, e.resourceGroup)
    return affected ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  if (e.resourceType === 'containerRegistry' || e.resourceType === 'managedIdentity') {
    const kind = e.resourceType === 'containerRegistry' ? 'container-registry' : 'managed-identity'
    return current.kind === kind && same(current.name, e.name) && same(current.resourceGroup, e.resourceGroup)
      ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  if (e.resourceType === 'aksCluster') return current.kind === 'aks-cluster' && same(current.name, e.name) && same(current.resourceGroup, e.resourceGroup)
    ? { kind: 'resource-group', name: current.resourceGroup } : current
  if (e.resourceType === 'storageAccount' || e.resourceType === 'functionApp') {
    const kind = e.resourceType === 'storageAccount' ? 'storage-account' : 'function-app'
    const affected = current.kind === kind && same(current.name, e.name) && same(current.resourceGroup, e.resourceGroup)
    return affected ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  if (e.resourceType === 'eventGridSubscription') {
    const affected = current.kind === 'eventgrid-subscription' && same(current.resourceGroup, e.resourceGroup) && same(current.topic, e.topic) && same(current.name, e.name)
    return affected ? { kind: 'eventgrid-topic', resourceGroup: current.resourceGroup, name: current.topic } : current
  }
  if (e.resourceType === 'eventGridTopic') {
    const affected = (current.kind === 'eventgrid-topic' || current.kind === 'eventgrid-subscription') && same(current.resourceGroup, e.resourceGroup) && same(current.kind === 'eventgrid-topic' ? current.name : current.topic, e.name)
    return affected ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  if (e.resourceType === 'cosmosContainer') {
    const affected = current.kind === 'cosmos-container' && same(current.resourceGroup, e.resourceGroup) && same(current.account, e.account) && current.database === e.database && current.name === e.name
    return affected ? { kind: 'cosmos-database', resourceGroup: current.resourceGroup, account: current.account, name: current.database } : current
  }
  if (e.resourceType === 'cosmosDatabase') {
    const affected = (current.kind === 'cosmos-database' || current.kind === 'cosmos-container') && same(current.resourceGroup, e.resourceGroup) && same(current.account, e.account) && (current.kind === 'cosmos-database' ? current.name : current.database) === e.name
    return affected ? { kind: 'cosmos-account', resourceGroup: current.resourceGroup, name: current.account } : current
  }
  if (e.resourceType === 'cosmosAccount') {
    const affected = (current.kind === 'cosmos-account' || current.kind === 'cosmos-database' || current.kind === 'cosmos-container') && same(current.resourceGroup, e.resourceGroup) && same(current.kind === 'cosmos-account' ? current.name : current.account, e.name)
    return affected ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  if (e.resourceType === 'postgresServer') {
    return current.kind === 'postgres-server' && same(current.resourceGroup, e.resourceGroup) && same(current.name, e.name)
      ? { kind: 'resource-group', name: current.resourceGroup } : current
  }
  return current
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase()
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

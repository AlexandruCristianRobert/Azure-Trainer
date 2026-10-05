import { appConfigurationId } from '../sandbox/appconfiguration.js'

export function presentAppConfiguration(store) {
  return { id: appConfigurationId(store), name: store.name, resourceGroup: store.resourceGroup, location: store.location,
    type: 'Microsoft.AppConfiguration/configurationStores', sku: { name: store.sku }, endpoint: store.endpoint,
    provisioningState: 'Succeeded', tags: store.tags ?? {} }
}
export function presentAppConfigurationValue(setting) {
  return { key: setting.key, label: setting.label, value: setting.value, contentType: setting.contentType, revision: setting.revision }
}

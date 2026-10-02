import { securityExact, securityText } from './state.js'

export const notificationChannels = ['email', 'sms', 'console']
export function validAcceptedKeys(keys) {
  return Array.isArray(keys) && keys.length >= 1 && keys.length <= 4
    && keys.every(key => securityExact(key, 'id,value') && securityText(key.id, 128) && securityText(key.value, 1024))
    && new Set(keys.map(key => key.id)).size === keys.length && new Set(keys.map(key => key.value)).size === keys.length
}
export function authorizeNotification({ token, acceptedKeys, records }) {
  if (!token || token.type !== 'secretvalue') return null
  const read = records.find(record => record.id === token.readId && record.kind === 'secret-read')
  if (!read || read.version !== token.version || read.principalId !== token.principalId) return null
  return acceptedKeys.find(key => key.value === token.value)?.id ?? null
}

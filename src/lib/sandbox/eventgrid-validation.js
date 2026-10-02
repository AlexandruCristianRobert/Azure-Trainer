function authorityOf(endpoint) {
  const afterScheme = endpoint.slice('https://'.length)
  const end = afterScheme.search(/[/?#]/)
  return end === -1 ? afterScheme : afterScheme.slice(0, end)
}

// The raw checks intentionally inspect delimiters before URL normalisation:
// URL exposes empty query, fragment, and userinfo components as empty strings.
export function isValidEventGridWebhookEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !/^https:\/\//i.test(endpoint) || /[\s\\]/.test(endpoint)) return false
  const authority = authorityOf(endpoint)
  if (endpoint.includes('?') || endpoint.includes('#') || !authority || authority.includes('@')) return false
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password
  } catch { return false }
}

export const validBlobContainer = name => typeof name === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(name) && !name.includes('--')
export const validRetryValue = (value, maximum) => Number.isSafeInteger(value) && value >= 1 && value <= maximum
export function parseEventGridFunctionEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return null
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft.Web\/sites\/([^/]+)\/functions\/([A-Za-z][A-Za-z0-9_]*)$/i.exec(endpoint)
  return match ? { subscriptionId: match[1], resourceGroup: match[2], app: match[3], functionName: match[4] } : null
}
export function parseEventGridDeadLetterDestination(endpoint) {
  if (typeof endpoint !== 'string') return null
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft.Storage\/storageAccounts\/([^/]+)\/blobServices\/default\/containers\/([^/]+)$/i.exec(endpoint)
  return match && validBlobContainer(match[4]) ? { subscriptionId: match[1], resourceGroup: match[2], account: match[3], container: match[4], resourceId: endpoint.slice(0, endpoint.toLowerCase().indexOf('/blobservices/')) } : null
}
export function resolveEventGridFunction(sandbox, endpoint, subscriptionId) {
  const target = parseEventGridFunctionEndpoint(endpoint)
  return target && target.subscriptionId.toLowerCase() === subscriptionId.toLowerCase()
    && (sandbox.functionApps ?? []).find(app => app.name.toLowerCase() === target.app.toLowerCase() && app.resourceGroup.toLowerCase() === target.resourceGroup.toLowerCase())
}
export function resolveEventGridDeadLetter(sandbox, endpoint, subscriptionId) {
  const target = parseEventGridDeadLetterDestination(endpoint)
  const account = target && target.subscriptionId.toLowerCase() === subscriptionId.toLowerCase()
    && (sandbox.storageAccounts ?? []).find(account => account.name.toLowerCase() === target.account.toLowerCase() && account.resourceGroup.toLowerCase() === target.resourceGroup.toLowerCase())
  return account?.blobContainers?.includes(target.container) ? target : null
}

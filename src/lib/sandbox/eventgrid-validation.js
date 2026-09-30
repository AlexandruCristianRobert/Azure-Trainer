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

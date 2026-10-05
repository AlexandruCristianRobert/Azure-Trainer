import { sensitiveTelemetry, sensitiveTelemetryName } from '../observability/privacy.js'

// Scalar provenance is private to the VM WeakMap. JSON values never receive proof keys.
export function createHttpValues({ handle, info, fail, protectedValues = [] }) {
  const secrets = protectedValues.filter(value => typeof value === 'string' && value.length)
  const scalar = (value, readId, field) => handle('httpvalue', { value, links: [{ readId, field }] })
  const unbox = value => info(value)?.type === 'httpvalue' ? info(value).value : value
  function collect(value, links = [], seen = new Set(), depth = 0) {
    if (depth > 100 || seen.has(value)) fail('HTTP value nesting exceeded.', null, 'HTTP_LIMIT')
    const token = info(value)
    if (token?.type === 'httpvalue') { links.push(...token.links); return links }
    if (value && typeof value === 'object' && !token) {
      seen.add(value); for (const item of Object.values(value)) collect(item, links, seen, depth + 1); seen.delete(value)
    }
    return links
  }
  function guard(value, loc, seen = new Set(), depth = 0) {
    if (depth > 100 || seen.has(value)) fail('HTTP data nesting exceeded.', loc, 'HTTP_LIMIT')
    const token = info(value)
    if (token?.type === 'httpvalue' || token?.type === 'bodytext' || token?.type === 'bytes') value = token.value
    else if (token) fail('Private handles cannot cross the HTTP data boundary.', loc, 'HTTP_PRIVACY')
    if (typeof value === 'string') {
      if (secrets.some(secret => value.includes(secret)) || sensitiveTelemetry(value)) fail('Protected values cannot cross a public boundary.', loc, 'HTTP_PRIVACY')
      // Guard structured data even when a learner supplied the JSON string literally.
      if (/^\s*[\[{]/.test(value)) {
        let parsed; try { parsed = JSON.parse(value) } catch { return }
        guard(parsed, loc, seen, depth + 1)
      }
    } else if (value && typeof value === 'object') {
      seen.add(value)
      for (const [key, item] of Object.entries(value)) {
        if (sensitiveTelemetryName(key) || key.toLowerCase() === 'x-functions-key') fail('Sensitive fields cannot cross a public boundary.', loc, 'HTTP_PRIVACY')
        guard(key, loc, seen, depth + 1); guard(item, loc, seen, depth + 1)
      }
      seen.delete(value)
    }
  }
  function serialize(value, jsonValue, loc) {
    guard(value, loc)
    const links = collect(value), text = JSON.stringify(jsonValue(value, loc))
    return links.length ? handle('httpvalue', { value: text, links }) : text
  }
  const sanitize = diagnostics => diagnostics.map(row => {
    try { guard(row.message, null); return row } catch { return { ...row, message: 'Protected diagnostic content was redacted.' } }
  })
  return { scalar, unbox, collect, guard, serialize, sanitize }
}

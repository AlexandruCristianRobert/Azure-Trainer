// A bounded teaching policy, intentionally rejecting sensitive payload fields.
const sensitiveName = /(?:secret|password|credential|authorization|api.?key|token|email|phone|address|customer|ssn|card|payload)/i
const sensitiveText = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b/
export function sensitiveTelemetry(value, info = () => undefined, seen = new Set()) {
  if (typeof value === 'string') return !/^00-(?!0{32}-)[a-f0-9]{32}-(?!0{16}-)[a-f0-9]{16}-(00|01)$/.test(value) && sensitiveText.test(value)
  if (!value || typeof value !== 'object') return false
  if (info(value)) return true
  if (seen.has(value)) return true
  seen.add(value)
  const invalid = Object.entries(value).some(([key, item]) => sensitiveName.test(key) || sensitiveTelemetry(item, info, seen))
  seen.delete(value)
  return invalid
}
export const sensitiveTelemetryName = name => sensitiveName.test(name)

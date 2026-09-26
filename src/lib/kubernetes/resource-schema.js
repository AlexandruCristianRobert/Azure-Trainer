import { parseCpuQuantity, parseMemoryQuantity } from './quantities.js'

const diagnostic = (code, message) => ({ code, message })
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export function normalizeContainerResources(resources = {}) {
  const diagnostics = []
  if (resources === null || typeof resources !== 'object' || Array.isArray(resources)) return { authored: null, effective: null, diagnostics: [diagnostic('INVALID_RESOURCES', 'Container resources must be an object.')] }
  const unknown = Object.keys(resources).find(key => !['requests', 'limits'].includes(key))
  if (unknown) diagnostics.push(diagnostic('UNSUPPORTED_FIELD', `The resource field '${unknown}' is outside the supported subset.`))
  const map = (name) => {
    const value = resources[name]
    if (value === undefined) return {}
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { diagnostics.push(diagnostic('INVALID_RESOURCES', `${name} must be a resource map.`)); return {} }
    const invalid = Object.keys(value).find(key => !['cpu', 'memory'].includes(key))
    if (invalid) diagnostics.push(diagnostic('UNSUPPORTED_FIELD', `The resource '${invalid}' is outside the supported subset.`))
    return value
  }
  const requests = map('requests'); const limits = map('limits')
  const authored = { cpuRequest: own(requests, 'cpu') ? requests.cpu : null, cpuLimit: own(limits, 'cpu') ? limits.cpu : null,
    memoryRequest: own(requests, 'memory') ? requests.memory : null, memoryLimit: own(limits, 'memory') ? limits.memory : null }
  const cpuRequest = own(requests, 'cpu') ? parseCpuQuantity(authored.cpuRequest) : null
  const cpuLimit = own(limits, 'cpu') ? parseCpuQuantity(authored.cpuLimit) : null
  const memoryRequest = own(requests, 'memory') ? parseMemoryQuantity(authored.memoryRequest) : null
  const memoryLimit = own(limits, 'memory') ? parseMemoryQuantity(authored.memoryLimit) : null
  for (const item of [cpuRequest, cpuLimit, memoryRequest, memoryLimit]) if (item?.diagnostics.length) diagnostics.push(...item.diagnostics)
  const effective = {
    cpuRequestM: cpuRequest?.millicores ?? cpuLimit?.millicores ?? null,
    cpuLimitM: cpuLimit?.millicores ?? null,
    memoryRequestBytes: memoryRequest?.bytes ?? memoryLimit?.bytes ?? null,
    memoryLimitBytes: memoryLimit?.bytes ?? null,
  }
  if (authored.cpuLimit !== null && cpuLimit?.millicores === 0) diagnostics.push(diagnostic('INVALID_RESOURCE_LIMIT', 'CPU limits must be greater than zero.'))
  if ((authored.memoryRequest !== null && memoryRequest?.bytes < 1) || (authored.memoryLimit !== null && memoryLimit?.bytes < 1)) diagnostics.push(diagnostic('INVALID_RESOURCE_REQUEST', 'Memory requests and limits must be at least one byte.'))
  if (cpuRequest && cpuLimit && cpuRequest.millicores > cpuLimit.millicores) diagnostics.push(diagnostic('RESOURCE_REQUEST_EXCEEDS_LIMIT', 'CPU requests must not exceed CPU limits.'))
  if (memoryRequest && memoryLimit && memoryRequest.bytes > memoryLimit.bytes) diagnostics.push(diagnostic('RESOURCE_REQUEST_EXCEEDS_LIMIT', 'Memory requests must not exceed memory limits.'))
  return { authored, effective, diagnostics }
}

const issue = (code, message) => ({ code, message, path: 'containerapp.yaml', line: 1, column: 1 })
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (value, allowed) => plain(value) && Object.keys(value).every((key) => allowed.includes(key))
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

function reject(message, code = 'UNSUPPORTED_PROBE_CONFIG') { throw issue(code, message) }
function object(value, allowed, name) {
  if (!keys(value, allowed)) reject(`${name} must contain only supported fields.`)
}
function bounded(value, min, max, name) {
  if (!integer(value, min, max)) reject(`${name} must be an integer from ${min} to ${max}.`, 'INVALID_PROBE_CONFIG')
  return value
}

export function parseProbeConfiguration(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 32 * 1024) return { config: null, diagnostics: [issue('INVALID_PROBE_CONFIG', 'A bounded JSON-form YAML file is required.')] }
  try {
    let document
    try { document = JSON.parse(text) } catch { reject('Only JSON-form YAML is supported; the file must contain valid JSON.') }
    object(document, ['properties'], 'Document')
    object(document.properties, ['template'], 'properties')
    const template = document.properties.template
    object(template, ['containers', 'scale'], 'template')
    if (!Array.isArray(template.containers) || template.containers.length !== 1) reject('Exactly one container is supported.')
    const container = template.containers[0]
    object(container, ['name', 'image', 'env', 'resources', 'probes'], 'Container')
    if (container.name !== 'api' || typeof container.image !== 'string' || !container.image) reject('The supported api container and an explicit image are required.', 'INVALID_PROBE_CONFIG')
    if (!Array.isArray(container.env)) reject('Container env must be an array of string name/value pairs.', 'INVALID_PROBE_CONFIG')
    const envEntries = []
    const envNames = new Set()
    for (const entry of container.env) {
      object(entry, ['name', 'value'], 'Environment variable')
      if (typeof entry.name !== 'string' || !entry.name || typeof entry.value !== 'string' || envNames.has(entry.name)) reject('Environment names must be unique nonempty strings with string values.', 'INVALID_PROBE_CONFIG')
      envNames.add(entry.name)
      envEntries.push([entry.name, entry.value])
    }
    const envVars = Object.fromEntries(envEntries)
    object(container.resources, ['cpu', 'memory'], 'resources')
    if (container.resources.cpu !== 0.5 || container.resources.memory !== '1Gi') reject('Only 0.5 CPU with 1Gi memory is supported.')
    object(template.scale, ['minReplicas', 'maxReplicas'], 'scale')
    const minReplicas = bounded(template.scale.minReplicas, 1, 5, 'minReplicas')
    const maxReplicas = bounded(template.scale.maxReplicas, 1, 5, 'maxReplicas')
    if (minReplicas > maxReplicas) reject('minReplicas cannot exceed maxReplicas.', 'INVALID_PROBE_CONFIG')
    const configuredProbes = container.probes === undefined ? [] : container.probes
    if (!Array.isArray(configuredProbes) || configuredProbes.length > 3) reject('probes must be an array with at most three entries.', 'INVALID_PROBE_CONFIG')
    const seen = new Set()
    const probes = configuredProbes.map((probe) => {
      object(probe, ['type', 'httpGet', 'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold', 'successThreshold'], 'Probe')
      if (!['Startup', 'Readiness', 'Liveness'].includes(probe.type) || seen.has(probe.type)) reject('Probe types must be distinct Startup, Readiness or Liveness.', 'INVALID_PROBE_CONFIG')
      seen.add(probe.type)
      object(probe.httpGet, ['path', 'port', 'scheme'], 'httpGet')
      if (typeof probe.httpGet.path !== 'string' || !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(probe.httpGet.path)) reject('HTTP probe path must be a local absolute path.', 'INVALID_PROBE_CONFIG')
      const httpGet = { path: probe.httpGet.path, port: bounded(probe.httpGet.port, 1, 65535, 'port'), scheme: probe.httpGet.scheme === undefined ? 'HTTP' : probe.httpGet.scheme }
      if (httpGet.scheme !== 'HTTP') reject('Only HTTP probes are supported.')
      const normalized = { type: probe.type, httpGet,
        initialDelaySeconds: bounded(probe.initialDelaySeconds, 1, 60, 'initialDelaySeconds'),
        periodSeconds: bounded(probe.periodSeconds, 1, 240, 'periodSeconds'),
        timeoutSeconds: bounded(probe.timeoutSeconds, 1, 240, 'timeoutSeconds'),
        failureThreshold: bounded(probe.failureThreshold, 1, 10, 'failureThreshold'),
        successThreshold: bounded(probe.successThreshold, 1, 10, 'successThreshold') }
      if (probe.type !== 'Readiness' && normalized.successThreshold !== 1) reject('Startup and Liveness successThreshold must be 1.', 'INVALID_PROBE_CONFIG')
      return normalized
    })
    return { config: { image: container.image, envVars, cpu: 0.5, memory: '1Gi', minReplicas, maxReplicas, probes }, diagnostics: [] }
  } catch (error) {
    if (error?.code && error?.path) return { config: null, diagnostics: [error] }
    throw error
  }
}

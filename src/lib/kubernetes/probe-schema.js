const namedPort = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

function location(path) {
  return typeof path === 'string'
    ? { path, line: 1, column: 1 }
    : { path: path?.path ?? '', line: path?.line ?? 1, column: path?.column ?? 1 }
}

function diagnostic(code, message, path) {
  return { code, message, ...location(path) }
}

function unsupported(value, fields, code, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return diagnostic(code, 'An object is required.', path)
  }
  const field = Object.keys(value).find(key => !fields.has(key))
  return field === undefined ? null : diagnostic(code, `The field '${field}' is outside the supported Kubernetes probe subset.`, path)
}

function integer(value, min, max, name, path) {
  if (!Number.isInteger(value) || value < min || value > max) {
    const code = {
      initialDelay: 'INITIAL_DELAY', period: 'PERIOD', timeout: 'TIMEOUT',
      failureThreshold: 'FAILURE_THRESHOLD', successThreshold: 'SUCCESS_THRESHOLD',
    }[name]
    return diagnostic(`INVALID_PROBE_${code}`, `${name} must be an integer from ${min} to ${max}.`, path)
  }
  return null
}

/**
 * Parses the Kubernetes HTTP probe subset used by the AKS health labs.
 * Missing timing fields use Kubernetes defaults; named ports are resolved by
 * the runtime so an absent named container port remains an observable failure.
 */
export function parseHttpProbe(value, type, path) {
  if (!['startup', 'readiness', 'liveness'].includes(type)) {
    return { probe: null, diagnostics: [diagnostic('INVALID_PROBE_TYPE', 'Probe type must be startup, readiness, or liveness.', path)] }
  }
  let issue = unsupported(value, new Set(['httpGet', 'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold', 'successThreshold']), 'UNSUPPORTED_PROBE_FIELD', path)
  if (issue) return { probe: null, diagnostics: [issue] }
  issue = unsupported(value.httpGet, new Set(['path', 'port', 'scheme']), 'UNSUPPORTED_HTTP_PROBE_FIELD', path)
  if (issue) return { probe: null, diagnostics: [issue] }

  const httpGet = value.httpGet
  if (typeof httpGet.path !== 'string' || !httpGet.path.startsWith('/')) {
    return { probe: null, diagnostics: [diagnostic('INVALID_PROBE_PATH', 'HTTP probe paths must be absolute.', path)] }
  }
  const validPort = Number.isInteger(httpGet.port) && httpGet.port >= 1 && httpGet.port <= 65535
    || typeof httpGet.port === 'string' && namedPort.test(httpGet.port) && httpGet.port.length <= 63
  if (!validPort) return { probe: null, diagnostics: [diagnostic('INVALID_PROBE_PORT', 'HTTP probe ports must be an integer from 1 to 65535 or a named container port.', path)] }
  const scheme = httpGet.scheme ?? 'HTTP'
  if (scheme !== 'HTTP') return { probe: null, diagnostics: [diagnostic('UNSUPPORTED_PROBE_SCHEME', 'Only HTTP probe scheme is supported.', path)] }

  const normalized = {
    httpGet: { path: httpGet.path, port: httpGet.port, scheme },
    initialDelaySeconds: value.initialDelaySeconds ?? 0,
    periodSeconds: value.periodSeconds ?? 10,
    timeoutSeconds: value.timeoutSeconds ?? 1,
    failureThreshold: value.failureThreshold ?? 3,
    successThreshold: value.successThreshold ?? 1,
  }
  issue = integer(normalized.initialDelaySeconds, 0, 120, 'initialDelay', path)
    ?? integer(normalized.periodSeconds, 1, 30, 'period', path)
    ?? integer(normalized.timeoutSeconds, 1, 10, 'timeout', path)
    ?? integer(normalized.failureThreshold, 1, 30, 'failureThreshold', path)
    ?? integer(normalized.successThreshold, 1, type === 'readiness' ? 3 : 1, 'successThreshold', path)
  if (issue) return { probe: null, diagnostics: [issue] }
  return { probe: normalized, diagnostics: [] }
}

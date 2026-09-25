import { routeServiceRequest, resolveServiceDns } from './connectivity.js'

const error = (code, message) => ({ code, message, path: null, line: null, column: null })
const clean = value => JSON.stringify(value)

export function runDiagnosticCommand(input, rawTokens, lab) {
  const tokens = rawTokens[0] === 'kubectl' ? rawTokens.slice(1) : rawTokens
  const fail = (message, code = 'DIAGNOSTIC_SYNTAX') => ({ run: input, lines: [], diagnostics: [error(code, message)] })
  if (lab?.capabilities?.kubernetesConnectivity !== true || tokens[0] !== 'exec') return fail('Only the supplied connectivity diagnostic commands are supported.', 'DIAGNOSTIC_UNSUPPORTED')
  let i = 1, podName = null
  let namespace = null, contextName = null
  while (i < tokens.length && tokens[i] !== '--') {
    if (tokens[i] === '-n' || tokens[i] === '--namespace') {
      if (namespace !== null || !tokens[i + 1]) return fail('exec accepts one namespace value.')
      namespace = tokens[i + 1]; i += 2; continue
    }
    if (tokens[i] === '--context') {
      if (contextName !== null || !tokens[i + 1]) return fail('exec accepts one context value.')
      contextName = tokens[i + 1]; i += 2; continue
    }
    if (tokens[i].startsWith('--context=')) {
      if (contextName !== null || !tokens[i].slice(10)) return fail('exec accepts one context value.')
      contextName = tokens[i].slice(10); i++; continue
    }
    if (podName === null && !tokens[i].startsWith('-')) {
      podName = tokens[i++]
      if (podName.startsWith('pod/')) podName = podName.slice(4)
      continue
    }
    return fail(`exec option '${tokens[i]}' is not supported.`, 'DIAGNOSTIC_UNSUPPORTED')
  }
  const kubernetes = input.runtime.kubernetes
  const selectedContextName = contextName ?? kubernetes.currentContext
  const context = kubernetes.contexts[selectedContextName]
  const clusterId = context?.clusterId
  const effectiveNamespace = namespace ?? context?.namespace
  if (!context || podName !== 'diagnostics' || effectiveNamespace !== 'diagnostics') return fail('exec is available only on the supplied Pod diagnostics in namespace diagnostics.', 'DIAGNOSTIC_ORIGIN')
  if (tokens[i++] !== '--') return fail('exec requires -- before the diagnostic command.')
  const command = tokens[i++]
  const cluster = kubernetes.clusters[clusterId]
  const diagnosticUid = `diagnostic/${clusterId}`
  if (!cluster?.connectivity?.diagnosticPodUids.includes(diagnosticUid)) return fail('The supplied diagnostic Pod is unavailable in the selected cluster.', 'DIAGNOSTIC_ORIGIN')
  if (command === 'nslookup') {
    if (tokens.length !== i + 1) return fail('nslookup accepts exactly one Service name.')
    const resolved = resolveServiceDns(input, { clusterId, clientNamespace: 'diagnostics', hostname: tokens[i] })
    return resolved.ok ? { run: input, lines: [`Name: ${resolved.canonicalName}`, `Address: ${resolved.address}`], diagnostics: [] }
      : fail(`DNS lookup failed: ${resolved.reason}.`, resolved.reason)
  }
  if (command !== 'curl') return fail(`'${command ?? ''}' is not available in the diagnostic Pod.`, 'DIAGNOSTIC_UNSUPPORTED')
  let method = 'GET', body = null, url = null, seenMethod = false, seenData = false, seenHeader = false
  for (; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '-sS') continue
    if (token === '-X' && !seenMethod && ['GET', 'POST'].includes(tokens[i + 1])) { method = tokens[++i]; seenMethod = true; continue }
    if (token === '-H' && !seenHeader && tokens[i + 1] === 'Content-Type: application/json') { i++; seenHeader = true; continue }
    if (token === '-d' && !seenData && tokens[i + 1]) { try { body = JSON.parse(tokens[++i]) } catch { return fail('curl -d requires valid JSON.') }; seenData = true; continue }
    if (token.startsWith('http://') || token.startsWith('https://')) { if (url) return fail('curl accepts one URL only.'); url = token; continue }
    return fail(`curl flag or argument '${token}' is not supported.`, 'DIAGNOSTIC_UNSUPPORTED')
  }
  if (!url) return fail('curl requires an HTTP URL.')
  let match = /^(https?):\/\/([^/:@?#]+)(?::(\d+))?(\/[^?#]*)$/.exec(url)
  if (!match) return fail('curl URL must use a host, optional port and a simple path; userinfo, query strings and fragments are unsupported.')
  if (match[1] === 'https') return fail('HTTPS/TLS is not modeled by this trainer.', 'TLS_UNSUPPORTED')
  const path = match[4]
  if (!['/api/info', '/api/ask'].includes(path)) return fail('curl path is not supported.')
  if (method === 'POST' && (!seenData || !seenHeader || path !== '/api/ask')) return fail('POST requires the JSON header, a question body and /api/ask.')
  if (seenData && (method !== 'POST' || path !== '/api/ask' || typeof body?.question !== 'string')) return fail('curl JSON body is supported only for a question sent to /api/ask.')
  if (method === 'GET' && (seenData || seenHeader)) return fail('GET does not accept a request body or JSON header.')
  const pod = Object.values(cluster.resources).find(item => item.kind === 'Pod' && item.metadata.uid === diagnosticUid)
  if (!pod) return fail('The supplied diagnostic Pod is unavailable.', 'DIAGNOSTIC_ORIGIN')
  const routed = routeServiceRequest(input, { origin: { kind: 'pod', clusterId, podUid: pod.metadata.uid }, hostname: match[2], port: Number(match[3] ?? (match[1] === 'https' ? 443 : 80)), method, path, body }, lab)
  const outcome = routed.outcome
  const lines = outcome.transport.ok ? [`HTTP ${outcome.status}`, clean(outcome.body)] : [`curl: ${outcome.transport.reason}`]
  const diagnostics = outcome.transport.ok ? [] : [error(outcome.transport.reason, `Request could not reach the application: ${outcome.transport.reason}.`)]
  return { run: routed.run, lines, diagnostics, outcome }
}

import { routeServiceRequest, resolveServiceDns } from './connectivity.js'

const error = (code, message) => ({ code, message, path: null, line: null, column: null })
const clean = value => JSON.stringify(value)

export function runDiagnosticCommand(input, rawTokens, lab) {
  const tokens = rawTokens[0] === 'kubectl' ? rawTokens.slice(1) : rawTokens
  const fail = (message, code = 'DIAGNOSTIC_SYNTAX') => ({ run: input, lines: [], diagnostics: [error(code, message)] })
  if (lab?.capabilities?.kubernetesConnectivity !== true || tokens[0] !== 'exec') return fail('Only the supplied connectivity diagnostic commands are supported.', 'DIAGNOSTIC_UNSUPPORTED')
  let i = 1, podName = tokens[i++]
  if (podName?.startsWith('pod/')) podName = podName.slice(4)
  let namespace = null
  if (tokens[i] === '-n' || tokens[i] === '--namespace') { namespace = tokens[i + 1]; i += 2 }
  if (tokens[i++] !== '--' || podName !== 'diagnostics' || namespace !== 'diagnostics') return fail('exec is available only on the supplied Pod diagnostics in namespace diagnostics.', 'DIAGNOSTIC_ORIGIN')
  const command = tokens[i++]
  // The UID itself is authoritative; derive its owning cluster without trusting the caller.
  const originEntry = Object.entries(input.runtime.kubernetes.clusters).find(([clusterId, state]) => state.connectivity?.diagnosticPodUids.includes(`diagnostic/${clusterId}`))
  if (!originEntry) return fail('The supplied diagnostic Pod is unavailable.', 'DIAGNOSTIC_ORIGIN')
  const [clusterId] = originEntry
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
  const pod = Object.values(originEntry[1].resources).find(item => item.kind === 'Pod' && item.metadata.uid === `diagnostic/${clusterId}`)
  if (!pod) return fail('The supplied diagnostic Pod is unavailable.', 'DIAGNOSTIC_ORIGIN')
  const routed = routeServiceRequest(input, { origin: { kind: 'pod', clusterId, podUid: pod.metadata.uid }, hostname: match[2], port: Number(match[3] ?? (match[1] === 'https' ? 443 : 80)), method, path, body }, lab)
  const outcome = routed.outcome
  const lines = outcome.transport.ok ? [`HTTP ${outcome.status}`, clean(outcome.body)] : [`curl: ${outcome.transport.reason}`]
  const diagnostics = outcome.transport.ok ? [] : [error(outcome.transport.reason, `Request could not reach the application: ${outcome.transport.reason}.`)]
  return { run: routed.run, lines, diagnostics, outcome }
}

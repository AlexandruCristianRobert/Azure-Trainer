import { describe, expect, it } from 'vitest'
import { runDiagnosticCommand } from '../src/lib/kubernetes/diagnostics.js'
import { seedConnectivityTest } from './helpers/aks.js'
import { tokenize } from '../src/lib/az/tokenize.js'
import { runKubectl } from '../src/lib/kubernetes/kubectl.js'
import { describeObject } from '../src/lib/kubernetes/format.js'

describe('AKS diagnostic commands', () => {
  it('executes nslookup and a supported curl through the bounded router', () => {
    const seed = seedConnectivityTest()
    const lookup = runDiagnosticCommand(seed.run, ['kubectl', 'exec', 'diagnostics', '-n', 'diagnostics', '--', 'nslookup', 'assistant-internal.assistant'], seed.lab)
    expect(lookup.diagnostics).toEqual([])
    expect(lookup.lines.join('\n')).toContain('10.96.')
    const curl = runDiagnosticCommand(seed.run, ['kubectl', 'exec', 'pod/diagnostics', '-n', 'diagnostics', '--', 'curl', '-sS', 'http://assistant-internal.assistant:80/api/info'], seed.lab)
    expect(curl.diagnostics).toEqual([])
    expect(curl.lines.join('\n')).toContain('knowledge-assistant')
    expect(curl.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs).toHaveLength(1)
  })

  it('rejects unsupported exec syntax without changing request or log state', () => {
    const seed = seedConnectivityTest()
    const result = runDiagnosticCommand(seed.run, ['kubectl', 'exec', 'diagnostics', '-n', 'diagnostics', '--', 'sh', '-c', 'curl http://x'], seed.lab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run).toEqual(seed.run)
  })

  it('tokenizes a single-quoted JSON question as one curl argument and records only safe dependency fields', () => {
    const seed = seedConnectivityTest()
    const line = `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant:80/api/ask`
    const tokens = tokenize(line).tokens
    const result = runDiagnosticCommand(seed.run, tokens, seed.lab)
    expect(result.diagnostics).toEqual([])
    expect(result.lines.join('\n')).toContain('Training backups are kept for 30 days.')
    const log = result.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs[0]
    expect(log.dependencySummary.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    expect(JSON.stringify(log)).not.toContain('training-only-password')
  })

  it('leaves the run unchanged for malformed JSON or extra URL query syntax', () => {
    const seed = seedConnectivityTest()
    const malformed = runDiagnosticCommand(seed.run, ['exec', 'diagnostics', '-n', 'diagnostics', '--', 'curl', '-d', '{broken', 'http://assistant-internal.assistant/api/ask'], seed.lab)
    expect(malformed.diagnostics.length).toBeGreaterThan(0)
    expect(malformed.run).toBe(seed.run)
    const query = runDiagnosticCommand(seed.run, ['exec', 'diagnostics', '-n', 'diagnostics', '--', 'curl', 'http://assistant-internal.assistant/api/info?q=x'], seed.lab)
    expect(query.diagnostics.length).toBeGreaterThan(0)
    expect(query.run).toBe(seed.run)
  })

  it('accepts the EndpointSlice service-name equality selector', () => {
    const seed = seedConnectivityTest()
    const response = runKubectl(seed.run.sandbox, ['get', 'endpointslices', '-n', 'assistant', '-l', 'kubernetes.io/service-name=assistant-internal', '-o', 'yaml'], { run: seed.run, lab: seed.lab })
    expect(response.lines.map(line => line.text).join('\n')).toContain('kind: EndpointSlice')
    expect(response.lines[0].kind).toBe('out')
  })

  it('describes derived endpoints even when a numeric target port differs from the declared container port', () => {
    const seed = seedConnectivityTest()
    const state = seed.run.runtime.kubernetes.clusters[seed.clusterId]
    const service = state.resources['Service/assistant/assistant-internal']
    service.spec.ports[0].targetPort = 8081
    const description = describeObject(service, state)
    const selectedNames = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant' && item.metadata.labels.app === 'assistant').map(item => item.metadata.name)
    expect(description).toContain(selectedNames[0])
    expect(description).toContain(selectedNames[1])
  })

  it('uses the selected context cluster and its namespace to find the diagnostic Pod', () => {
    const seed = seedConnectivityTest()
    const run = structuredClone(seed.run)
    const secondId = 'cluster-secondary'
    const second = structuredClone(run.runtime.kubernetes.clusters[seed.clusterId])
    second.connectivity.diagnosticPodUids = [`diagnostic/${secondId}`]
    second.resources['Pod/diagnostics/diagnostics'].metadata.uid = `diagnostic/${secondId}`
    second.resources['Service/assistant/assistant-internal'].spec.clusterIP = '10.96.15.200'
    run.runtime.kubernetes.clusters[secondId] = second
    run.runtime.kubernetes.contexts.secondary = { clusterId: secondId, namespace: 'diagnostics' }
    const lookup = runDiagnosticCommand(run, ['exec', '--context', 'secondary', '-n', 'diagnostics', 'diagnostics', '--', 'nslookup', 'assistant-internal.assistant'], seed.lab)
    expect(lookup.diagnostics).toEqual([])
    expect(lookup.lines.join('\n')).toContain('10.96.15.200')
  })
})

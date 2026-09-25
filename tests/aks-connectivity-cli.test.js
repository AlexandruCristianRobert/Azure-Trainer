import { describe, expect, it } from 'vitest'
import { runDiagnosticCommand } from '../src/lib/kubernetes/diagnostics.js'
import { seedConnectivityTest } from './helpers/aks.js'
import { tokenize } from '../src/lib/az/tokenize.js'

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
})

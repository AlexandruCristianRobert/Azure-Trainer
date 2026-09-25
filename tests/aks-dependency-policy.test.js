import { describe, expect, it } from 'vitest'
import { runDependencyOperation } from '../src/lib/kubernetes/dependency-policy.js'

const policy = {
  maxAttempts: 3,
  retryableCodes: ['THROTTLED', 'UNAVAILABLE', 'TIMEOUT'],
  baseDelayMs: 100,
  maxDelayMs: 200,
  attemptTimeoutMs: 200,
}

const profile = (stages) => ({ stages })
const success = (latencyMs) => ({ latencyMs, result: 'success' })
const failure = (latencyMs, code, retryAfterMs = 0) => ({ latencyMs, code, retryAfterMs })
const run = (operation, script, budget = { totalMs: 1000, elapsedMs: 0 }, invoke = () => 'ok', customPolicy = policy) =>
  runDependencyOperation({ operation, policy: customPolicy, budget, script, invoke })

describe('runDependencyOperation', () => {
  it('runs the healthy profile once per stage and accounts for request-local durations', () => {
    const budget = { totalMs: 1000, elapsedMs: 0 }
    const result = ['embedding', 'postgres-query', 'answer'].map((operation, i) =>
      run(operation, profile({ embedding: [success(40)], postgres: [success(30)], answer: [success(50)] }), budget, () => `v${i}`))

    expect(result.map(x => x.value)).toEqual(['v0', 'v1', 'v2'])
    expect(budget.elapsedMs).toBe(120)
    expect(result.map(x => x.attempts[0].durationMs)).toEqual([40, 30, 50])
    expect(result.every(x => x.error === null)).toBe(true)
  })

  it('retries one embedding throttle and includes its Retry-After wait', () => {
    const budget = { totalMs: 1000, elapsedMs: 0 }
    const result = run('embedding', profile({ embedding: [failure(40, 'THROTTLED', 150), success(40)] }), budget)

    expect(result.value).toBe('ok')
    expect(budget.elapsedMs).toBe(230)
    expect(result.attempts).toMatchObject([
      { operation: 'embedding', attemptNumber: 1, startMs: 0, durationMs: 40, timeoutMs: 200, errorCode: 'THROTTLED', delayBeforeNextMs: 150 },
      { operation: 'embedding', attemptNumber: 2, startMs: 190, durationMs: 40, timeoutMs: 200, errorCode: null, delayBeforeNextMs: 0 },
    ])
  })

  it('retries PostgreSQL locally without restarting an earlier embedding stage', () => {
    const budget = { totalMs: 1000, elapsedMs: 40 }
    const result = run('postgres-query', profile({ postgres: [failure(30, 'UNAVAILABLE'), success(30)] }), budget)
    expect(budget.elapsedMs).toBe(200)
    expect(result.attempts.map(a => a.operation)).toEqual(['postgres-query', 'postgres-query'])
    expect(result.attempts[1].startMs).toBe(170)
  })

  it('returns the mapped unavailable error after exhausting three answer attempts', () => {
    const result = run('answer', profile({ answer: [failure(50, 'UNAVAILABLE')] }))
    expect(result.value).toBeUndefined()
    expect(result.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 })
    expect(result.attempts).toHaveLength(3)
  })

  it('turns three timed out attempts into a safe dependency timeout', () => {
    const result = run('embedding', profile({ embedding: [success(500)] }))
    expect(result.error).toMatchObject({ code: 'DEPENDENCY_TIMEOUT', status: 504 })
    expect(result.attempts.map(a => a.durationMs)).toEqual([200, 200, 200])
  })

  it('refuses a Retry-After that cannot fit and does not start another attempt', () => {
    const budget = { totalMs: 1000, elapsedMs: 0 }
    const result = run('embedding', profile({ embedding: [failure(40, 'THROTTLED', 1500), success(40)] }), budget)
    expect(result.error).toMatchObject({ code: 'DEADLINE_EXCEEDED', status: 504 })
    expect(result.attempts).toHaveLength(1)
    expect(budget.elapsedMs).toBe(40)
  })

  it('caps each attempt to the remaining shared budget and never exceeds it', () => {
    const budget = { totalMs: 100, elapsedMs: 80 }
    const result = run('answer', profile({ answer: [success(500)] }), budget)
    expect(result.error).toMatchObject({ code: 'DEADLINE_EXCEEDED', status: 504 })
    expect(result.attempts[0]).toMatchObject({ startMs: 80, timeoutMs: 20, durationMs: 20 })
    expect(budget.elapsedMs).toBe(100)
  })

  it('stops after the first permanent error even when retries remain', () => {
    let calls = 0
    const result = run('embedding', profile({ embedding: [success(10)] }), { totalMs: 1000, elapsedMs: 0 }, () => {
      calls += 1
      throw Object.assign(new Error('secret endpoint details'), { code: 'AI_ENDPOINT' })
    })
    expect(calls).toBe(1)
    expect(result.error).toMatchObject({ code: 'AI_ENDPOINT', status: 502, message: 'The configured AI endpoint is not available in this trainer.' })
    expect(JSON.stringify(result)).not.toContain('secret endpoint details')
  })

  it('stops when maxAttempts is one despite a transient error', () => {
    const result = run('embedding', profile({ embedding: [failure(40, 'THROTTLED')] }), undefined, undefined, { ...policy, maxAttempts: 1 })
    expect(result.error.code).toBe('THROTTLED')
    expect(result.attempts).toHaveLength(1)
  })

  it('does not call invoke when the incoming request budget is already exhausted', () => {
    let calls = 0
    const budget = { totalMs: 100, elapsedMs: 100 }
    const result = run('answer', profile({ answer: [success(10)] }), budget, () => { calls += 1 })
    expect(result.error.code).toBe('DEADLINE_EXCEEDED')
    expect(result.attempts).toEqual([])
    expect(calls).toBe(0)
  })
})

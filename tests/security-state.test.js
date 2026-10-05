import { describe, it, expect } from 'vitest'
const path = '../src/lib/security/state.js'
const security = await import(/* @vite-ignore */ path).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
describe('security public state admission', () => {
  // Break: accepting leaked, untyped, duplicate, unsafe or oversized persisted records.
  it('rejects secret fields, unsafe keys, invalid lineage and state overflow', () => {
    expect(typeof security.validateSecurityObservabilityState).toBe('function')
    const empty = security.emptySecurityObservabilityState()
    expect(security.validateSecurityObservabilityState(empty)).toBe(true)
    for (const records of [[{ kind: 'secret-read', value: 'leak' }], Array(501).fill({}), [JSON.parse('{"id":"so-1","kind":"privacy-violation","timeMs":0,"category":"output","__proto__":{}}')]]) {
      expect(security.validateSecurityObservabilityState({ ...empty, records })).toBe(false)
    }
    expect(security.validateSecurityObservabilityState({ ...empty, extra: 'x' })).toBe(false)
    expect(security.validateSecurityObservabilityState({ ...empty, nextId: Infinity })).toBe(false)
    expect(security.validateSecurityObservabilityState({ ...empty, telemetry: [{ value: 'x'.repeat(128 * 1024) }] })).toBe(false)
    let nested = null
    for (let index = 0; index < 10000; index++) nested = [nested]
    expect(security.validateSecurityObservabilityState({ ...empty, records: [nested] })).toBe(false)
  })
})

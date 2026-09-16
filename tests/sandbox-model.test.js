import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape } from '../src/lib/sandbox/model.js'

describe('isSandboxShape', () => {
  it('accepts a well-formed sandbox', () => {
    expect(isSandboxShape(createSandbox())).toBe(true)
    expect(isSandboxShape({ resourceGroups: [], namespaces: [], defaults: { group: null, location: null } })).toBe(true)
  })
  it('rejects missing/malformed pieces', () => {
    expect(isSandboxShape(null)).toBe(false)
    expect(isSandboxShape(undefined)).toBe(false)
    expect(isSandboxShape('sandbox')).toBe(false)
    expect(isSandboxShape({})).toBe(false)
    expect(isSandboxShape({ resourceGroups: [], namespaces: [] })).toBe(false)
    expect(isSandboxShape({ resourceGroups: [], defaults: {} })).toBe(false)
    expect(isSandboxShape({ namespaces: [], defaults: {} })).toBe(false)
    expect(isSandboxShape({ resourceGroups: 'x', namespaces: [], defaults: {} })).toBe(false)
    expect(isSandboxShape({ resourceGroups: [], namespaces: [], defaults: null })).toBe(false)
    expect(isSandboxShape({ resourceGroups: [], namespaces: [], defaults: 'x' })).toBe(false)
  })
})

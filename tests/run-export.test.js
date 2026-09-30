import { describe, expect, it } from 'vitest'
import { encodeRunExport } from '../src/lib/labEngine/export.js'

describe('run export', () => {
  it('preserves finite JSON data', () => {
    const source = { run: { a: [1, true, null, 'x'] }, raw: null }
    expect(JSON.parse(encodeRunExport(source))).toEqual(source)
  })
  it('marks cyclic and non-JSON raw data without throwing', () => {
    const raw = { invalid: Infinity, absent: undefined, date: new Date('2026-01-01T00:00:00Z') }
    raw.self = raw
    const result = JSON.parse(encodeRunExport({ raw }))
    expect(result.raw.invalid).toContain('non-finite')
    expect(result.raw.absent).toContain('undefined')
    expect(result.raw.self).toContain('reference')
    expect(result.raw.date).toContain('Date')
  })
})

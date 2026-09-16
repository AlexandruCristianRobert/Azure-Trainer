import { describe, expect, it } from 'vitest'
import { formatDuration, formatClock, relativeTime } from '../src/lib/format.js'

describe('format', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(492000)).toBe('08:12')
    expect(formatDuration(877000)).toBe('14:37')
    expect(formatDuration(3723000)).toBe('1:02:03')
  })
  it('formatClock uses local HH:MM', () => {
    const d = new Date(2026, 8, 16, 16, 42)
    expect(formatClock(d.toISOString())).toBe('16:42')
  })
  it('relativeTime', () => {
    const now = Date.parse('2026-09-16T16:42:00Z')
    expect(relativeTime('2026-09-16T16:41:40Z', now)).toBe('just now')
    expect(relativeTime('2026-09-16T16:30:00Z', now)).toBe('12 min ago')
    expect(relativeTime('2026-09-16T13:42:00Z', now)).toBe('3 h ago')
  })
})

import { describe, expect, it } from 'vitest'
import { toAzJson } from '../src/lib/az/format.js'

describe('toAzJson', () => {
  it('sorts keys recursively and indents with two spaces', () => {
    const out = toAzJson({ name: 'orders', countDetails: { deadLetterMessageCount: 0, activeMessageCount: 0 }, id: '/x' })
    expect(out).toBe(['{', '  "countDetails": {', '    "activeMessageCount": 0,', '    "deadLetterMessageCount": 0', '  },', '  "id": "/x",', '  "name": "orders"', '}'].join('\n'))
  })
  it('keeps array order and handles null', () => {
    expect(toAzJson([{ b: 1, a: null }])).toBe('[\n  {\n    "a": null,\n    "b": 1\n  }\n]')
  })
})

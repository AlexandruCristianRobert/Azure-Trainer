import { describe, expect, it } from 'vitest'
import { fluentIcon, azureIcon, toCurrentColor, stripSize, FLUENT_ICONS, AZURE_ICONS } from '../src/lib/icons.js'

describe('icon registries', () => {
  it('loads the fluent set with currentColor fills and no fixed size', () => {
    const svg = fluentIcon('alert')
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).not.toContain('#212121')
    expect(svg).not.toMatch(/<svg[^>]*\swidth="/)
    expect(Object.keys(FLUENT_ICONS).length).toBeGreaterThanOrEqual(30)
  })

  it('loads the azure set keeping colours but dropping fixed size', () => {
    const svg = azureIcon('service-bus')
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox="0 0 18 18"')
    expect(svg).not.toMatch(/<svg[^>]*\swidth="/)
    expect(Object.keys(AZURE_ICONS)).toEqual(expect.arrayContaining(['azure-logo', 'resource-group', 'cloud-shell']))
  })

  it('returns an empty string for unknown names', () => {
    expect(fluentIcon('nope')).toBe('')
    expect(azureIcon('nope')).toBe('')
  })

  it('helpers are pure string transforms', () => {
    expect(toCurrentColor('<svg width="20" height="20"><path fill="#212121"/></svg>')).toBe('<svg><path fill="currentColor"/></svg>')
    expect(stripSize('<svg xmlns="x" width="18" height="18" viewBox="0 0 18 18"></svg>')).toBe('<svg xmlns="x" viewBox="0 0 18 18"></svg>')
  })
})

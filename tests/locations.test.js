import { describe, expect, it } from 'vitest'
import { normalizeLocation, displayLocation } from '../src/lib/sandbox/locations.js'

describe('locations', () => {
  it('normalises codes and display names', () => {
    expect(normalizeLocation('westeurope')).toBe('westeurope')
    expect(normalizeLocation('WestEurope')).toBe('westeurope')
    expect(normalizeLocation('West Europe')).toBe('westeurope')
    expect(normalizeLocation('  east us 2 ')).toBe('eastus2')
    expect(normalizeLocation('marsnorth')).toBeNull()
  })
  it('displays codes', () => {
    expect(displayLocation('westeurope')).toBe('West Europe')
    expect(displayLocation('unknown')).toBe('unknown')
  })
})

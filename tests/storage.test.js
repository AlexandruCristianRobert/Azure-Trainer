import { beforeEach, describe, expect, it } from 'vitest'
import { loadJSON, saveJSON, removeJSON } from '../src/lib/storage.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

describe('storage', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
  })

  it('round-trips a value', () => {
    saveJSON('at_x', { a: 1 })
    expect(loadJSON('at_x', null)).toEqual({ a: 1 })
  })

  it('returns fallback for missing key', () => {
    expect(loadJSON('at_missing', [])).toEqual([])
  })

  it('returns fallback for corrupt JSON', () => {
    globalThis.localStorage.setItem('at_bad', '{nope')
    expect(loadJSON('at_bad', 42)).toBe(42)
  })

  it('removeJSON deletes the key', () => {
    saveJSON('at_x', 1)
    removeJSON('at_x')
    expect(loadJSON('at_x', 'gone')).toBe('gone')
  })
})

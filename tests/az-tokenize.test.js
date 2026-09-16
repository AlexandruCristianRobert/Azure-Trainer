import { describe, expect, it } from 'vitest'
import { tokenize } from '../src/lib/az/tokenize.js'

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('az group create -n rg -l westeurope').tokens).toEqual(['az', 'group', 'create', '-n', 'rg', '-l', 'westeurope'])
  })
  it('handles single and double quotes', () => {
    expect(tokenize(`--filter-sql-expression "region = 'EU'"`).tokens).toEqual(['--filter-sql-expression', "region = 'EU'"])
    expect(tokenize(`--name '$Default'`).tokens).toEqual(['--name', '$Default'])
    expect(tokenize(`--location "West Europe"`).tokens).toEqual(['--location', 'West Europe'])
  })
  it('expands unknown $VARS to empty outside single quotes (bash behaviour)', () => {
    expect(tokenize('--name $Default').tokens).toEqual(['--name', ''])
    expect(tokenize('--name "$Default"').tokens).toEqual(['--name', ''])
  })
  it('supports backslash escapes and --key=value stays one token', () => {
    expect(tokenize('a\\ b --k=v').tokens).toEqual(['a b', '--k=v'])
  })
  it('reports unterminated quotes', () => {
    const r = tokenize(`--name "oops`)
    expect(r.tokens).toBeNull()
    expect(r.error).toBe("unexpected EOF while looking for matching `\"'")
  })
  it('returns an empty list for blank input', () => {
    expect(tokenize('   ').tokens).toEqual([])
  })
})

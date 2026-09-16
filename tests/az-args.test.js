import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/lib/az/args.js'

const SPECS = [
  { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name.' },
  { name: '--resource-group', aliases: ['-g'], required: true, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Group.' },
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Max.' },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'DLQ.' },
  { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['Basic', 'Standard', 'Premium'], dest: 'sku', help: 'Sku.' },
  { name: '--yes', aliases: ['-y'], required: false, kind: 'flag', dest: 'yes', help: 'Confirm.' },
  { name: '--tags', aliases: [], required: false, kind: 'list', dest: 'tags', help: 'Tags.' },
]
const NO_DEFAULTS = { group: null, location: null }

describe('parseArgs', () => {
  it('parses values, aliases, --k=v, ints, bools, flags, lists', () => {
    const r = parseArgs(SPECS, ['-n', 'orders', '--resource-group=rg', '--max-delivery-count', '5', '--enable-dead-lettering-on-message-expiration', 'true', '--yes', '--tags', 'a=1', 'b=2'], NO_DEFAULTS)
    expect(r.error).toBeNull()
    expect(r.values).toEqual({ name: 'orders', resourceGroup: 'rg', maxDeliveryCount: 5, deadLetteringOnMessageExpiration: true, yes: true, tags: { a: '1', b: '2' } })
  })
  it('reports missing required args with aliases, argparse style', () => {
    const r = parseArgs(SPECS, [], NO_DEFAULTS)
    expect(r.error).toBe('the following arguments are required: --name/-n, --resource-group/-g')
  })
  it('fills --resource-group from az configure defaults', () => {
    const r = parseArgs(SPECS, ['-n', 'x'], { group: 'rg-orders', location: null })
    expect(r.error).toBeNull()
    expect(r.values.resourceGroup).toBe('rg-orders')
  })
  it('rejects unrecognized arguments (with their values)', () => {
    const r = parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--foo', 'bar', '--baz'], NO_DEFAULTS)
    expect(r.error).toBe('unrecognized arguments: --foo bar --baz')
  })
  it('validates ints, bools and choices', () => {
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--max-delivery-count', 'five'], NO_DEFAULTS).error).toBe("argument --max-delivery-count: invalid int value: 'five'")
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--enable-dead-lettering-on-message-expiration', 'yes'], NO_DEFAULTS).error).toBe("argument --enable-dead-lettering-on-message-expiration: invalid choice: 'yes' (choose from 'false', 'true')")
    expect(parseArgs(SPECS, ['-n', 'x', '-g', 'rg', '--sku', 'Gold'], NO_DEFAULTS).error).toBe("argument --sku: invalid choice: 'Gold' (choose from 'Basic', 'Standard', 'Premium')")
  })
  it('reports a missing value', () => {
    expect(parseArgs(SPECS, ['-g', 'rg', '-n'], NO_DEFAULTS).error).toBe('argument --name/-n: expected one argument')
    expect(parseArgs(SPECS, ['-n', '', '-g', 'rg'], NO_DEFAULTS).error).toBe('argument --name/-n: expected one argument')
  })
  it('detects --help anywhere', () => {
    expect(parseArgs(SPECS, ['-h'], NO_DEFAULTS).wantsHelp).toBe(true)
    expect(parseArgs(SPECS, ['-n', 'x', '--help'], NO_DEFAULTS).wantsHelp).toBe(true)
  })
})

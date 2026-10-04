// argparse-flavoured parsing of az arguments.
import { SUBSCRIPTION_ID, SUBSCRIPTION_NAME } from '../sandbox/model.js'

export const HELP_FLAGS = ['--help', '-h']

// The `--help` renderer (help.js) advertises these on every command (Controller Ruling AA).
// Recognised centrally here so every command gets them without touching per-command `args`.
const GLOBAL_ARG_SPECS = [
  { name: '--verbose', aliases: [], kind: 'flag', dest: 'globalVerbose' },
  { name: '--debug', aliases: [], kind: 'flag', dest: 'globalDebug' },
  { name: '--only-show-errors', aliases: [], kind: 'flag', dest: 'globalOnlyShowErrors' },
  { name: '--output', aliases: ['-o'], kind: 'global-output', dest: 'globalOutput' },
  { name: '--query', aliases: [], kind: 'global-query', dest: 'globalQuery' },
  { name: '--subscription', aliases: [], kind: 'global-subscription', dest: 'globalSubscription' },
]

export function displayName(spec) {
  return [spec.name, ...(spec.aliases ?? [])].join('/')
}

function findSpec(specs, token) {
  return specs.find((s) => s.name === token || (s.aliases ?? []).includes(token))
}

export function parseArgs(specs, tokens, defaults = { group: null, location: null }) {
  const values = {}
  const unrecognized = []
  const allSpecs = specs.concat(GLOBAL_ARG_SPECS)
  let wantsHelp = false
  let error = null

  const fail = (msg) => { if (!error) error = msg }

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i]
    if (HELP_FLAGS.includes(tok)) { wantsHelp = true; continue }
    let inlineValue = null
    if (tok.startsWith('--') && tok.includes('=')) {
      const eq = tok.indexOf('=')
      inlineValue = tok.slice(eq + 1)
      tok = tok.slice(0, eq)
    }
    if (!tok.startsWith('-')) {
      const positional = specs.find((spec) => spec.kind === 'positional' && values[spec.dest] === undefined)
      if (positional) values[positional.dest] = tok
      else unrecognized.push(tok)
      continue
    }
    const spec = findSpec(allSpecs, tok)
    if (!spec) {
      unrecognized.push(tokens[i])
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) unrecognized.push(tokens[++i])
      continue
    }
    if (spec.kind === 'flag') {
      if (inlineValue !== null) { fail(`argument ${displayName(spec)}: ignored explicit argument '${inlineValue}'`); continue }
      values[spec.dest] = true
      continue
    }
    if (spec.kind === 'list' || spec.kind === 'pairs') {
      const items = inlineValue !== null ? [inlineValue] : []
      while (inlineValue === null && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) items.push(tokens[++i])
      const pairs = items.map((kv) => { const j = kv.indexOf('='); return j === -1 ? [kv, ''] : [kv.slice(0, j), kv.slice(j + 1)] })
      values[spec.dest] = spec.kind === 'pairs' ? [...(values[spec.dest] ?? []), ...pairs] : Object.fromEntries(pairs)
      continue
    }
    if (spec.kind === 'raw') {
      const items = inlineValue !== null ? [inlineValue] : []
      while (inlineValue === null && i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) items.push(tokens[++i])
      values[spec.dest] = [...(values[spec.dest] ?? []), ...items]
      continue
    }
    let raw = inlineValue
    if (raw === null) {
      if (i + 1 >= tokens.length || (tokens[i + 1].startsWith('-') && tokens[i + 1].length > 1 && !/^-\d/.test(tokens[i + 1]))) {
        fail(`argument ${displayName(spec)}: expected one argument`)
        continue
      }
      raw = tokens[++i]
    }
    if (raw === '' && !spec.allowEmpty) { fail(`argument ${displayName(spec)}: expected one argument`); continue }
    if (spec.kind === 'global-output') {
      if (!['json', 'jsonc', 'none'].includes(raw)) fail(`argument ${displayName(spec)}: only 'json', 'jsonc' and 'none' are available in the Sandbox Cloud Shell.`)
      else values[spec.dest] = raw
      continue
    }
    if (spec.kind === 'global-query') {
      fail('--query is not available in the Sandbox Cloud Shell.')
      continue
    }
    if (spec.kind === 'global-subscription') {
      if (raw !== SUBSCRIPTION_ID && raw !== SUBSCRIPTION_NAME) fail(`The subscription of '${raw}' doesn't exist in cloud 'AzureCloud'.`)
      continue
    }
    if (spec.kind === 'int') {
      if (!/^-?\d+$/.test(raw)) { fail(`argument ${spec.name}: invalid int value: '${raw}'`); continue }
      values[spec.dest] = parseInt(raw, 10)
      continue
    }
    if (spec.kind === 'bool') {
      const v = raw.toLowerCase()
      if (v !== 'true' && v !== 'false') { fail(`argument ${spec.name}: invalid choice: '${raw}' (choose from 'false', 'true')`); continue }
      values[spec.dest] = v === 'true'
      continue
    }
    if (spec.choices && !spec.choices.includes(raw)) {
      fail(`argument ${spec.name}: invalid choice: '${raw}' (choose from ${spec.choices.map((c) => `'${c}'`).join(', ')})`)
      continue
    }
    values[spec.dest] = raw
  }

  if (wantsHelp) return { values, error: null, wantsHelp: true }

  for (const spec of specs) {
    if (values[spec.dest] === undefined && spec.defaultsKey && defaults?.[spec.defaultsKey]) values[spec.dest] = defaults[spec.defaultsKey]
  }
  const missing = specs.filter((s) => s.required && values[s.dest] === undefined)
  if (!error && missing.length) error = `the following arguments are required: ${missing.map(displayName).join(', ')}`
  if (!error && unrecognized.length) error = `unrecognized arguments: ${unrecognized.join(' ')}`
  return { values, error, wantsHelp: false }
}

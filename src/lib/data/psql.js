import { executePg, loadCorpus } from './pg-engine.js'
import { SUPPORT_V3_CORPUS } from '../../data/fixtures/data/corpus-v3.js'
import { POSTGRES_INDEPENDENT_MANIFEST, POSTGRES_V3_LOAD } from '../../data/templates/data-python/postgres-independent.js'

const out = text => ({ text, kind: 'out' })
const err = text => ({ text, kind: 'err' })
const response = (sandbox, lines = [], results = [], session = { settings: {} }) => ({ sandbox, lines, results, session, events: [], latencyMs: 0 })
const unsupported = message => ({ code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: ${message}` })

function parseConnection(text) {
  const values = {}
  // This parses libpq connection fields only; SQL always goes through pg-sql.
  const field = /\s*([a-zA-Z_]+)\s*=\s*(?:'((?:\\.|[^'])*)'|([^\s]+))/y
  let offset = 0
  while (offset < text.length) {
    if (!text.slice(offset).trim()) break
    field.lastIndex = offset
    const match = field.exec(text)
    if (!match) return { error: unsupported('psql connection string syntax.') }
    if (!['host', 'port', 'dbname', 'user', 'password', 'sslmode'].includes(match[1])) return { error: unsupported(`connection field "${match[1]}".`) }
    values[match[1]] = (match[2] ?? match[3]).replace(/\\(.)/g, '$1')
    offset = field.lastIndex
  }
  return { values }
}
function parseArgs(tokens) {
  const fields = { '-h': 'host', '--host': 'host', '-p': 'port', '--port': 'port', '-d': 'dbname', '--dbname': 'dbname', '-U': 'user', '--username': 'user' }
  const actions = { '-c': 'command', '--command': 'command', '-f': 'file', '--file': 'file' }
  let values = {}, positional = false
  const commands = []
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], inline
    if (token.startsWith('--') && token.includes('=')) { const index = token.indexOf('='); inline = token.slice(index + 1); token = token.slice(0, index) }
    const key = fields[token] ?? actions[token]
    if (key) {
      const value = inline ?? tokens[++i]
      if (value === undefined || inline === undefined && value.startsWith('-')) return { error: unsupported(`psql option ${token} requires a value.`) }
      if (actions[token]) commands.push({ kind: key, value })
      else if (key === 'dbname' && value.includes('=')) {
        const parsed = parseConnection(value)
        if (parsed.error) return parsed
        values = { ...values, ...parsed.values }
      } else values[key] = value
    } else if (token.startsWith('-')) return { error: unsupported(`psql option ${token}.`) }
    else {
      if (positional) return { error: unsupported('multiple psql connection arguments.') }
      positional = true
      const parsed = parseConnection(token)
      if (parsed.error) return parsed
      values = { ...values, ...parsed.values }
    }
  }
  if (!commands.length) return { error: unsupported('interactive psql; use -c or -f.') }
  return { values, commands }
}
const display = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
function tableLines(result) {
  const names = result.columns.map(column => column.name)
  const rows = (result.rowValues ?? result.rows.map(row => names.map(name => row[name]))).map(row => row.map(display))
  const widths = names.map((name, index) => Math.max(name.length, ...rows.map(row => row[index].length)))
  const render = row => ` ${row.map((value, index) => value.padEnd(widths[index])).join(' | ')} `
  return [out(render(names)), out(widths.map(width => '-'.repeat(width + 2)).join('+')), ...rows.map(row => out(render(row))), out(`(${rows.length} row${rows.length === 1 ? '' : 's'})`)]
}
function resultLines(result) {
  if (result.error) return [err(result.error.message), ...(result.error.hint ? [err(`HINT: ${result.error.hint}`)] : [])]
  const lines = result.notice ? [out(`NOTICE: ${result.notice}`)] : []
  if (result.kind === 'select') return [...lines, ...tableLines(result)]
  if (result.kind === 'explain') return [...lines, ...result.plan.text.map(out)]
  const tag = { 'create-extension': 'CREATE EXTENSION', 'create-table': 'CREATE TABLE', 'create-index': 'CREATE INDEX', 'drop-index': 'DROP INDEX', set: 'SET', insert: `INSERT 0 ${result.rowCount}`, 'load-corpus': `COPY ${result.rowCount}` }[result.kind]
  return [...lines, ...(tag ? [out(tag)] : [])]
}

export function runPsql(sandbox, tokens, context) {
  const args = parseArgs(tokens)
  if (args.error) return response(sandbox, [err(args.error.message)], [{ kind: 'arguments', error: args.error }])
  const { host, dbname, port = '5432' } = args.values
  // psql connects by FQDN. Resource-name references are reserved for internal
  // engine/seed callers, so an unknown host cannot silently select a server.
  const server = sandbox.postgresServers?.find(server => server.fullyQualifiedDomainName === host)
  if (!server) {
    const error = { code: 'OperationalError', message: `psql: error: could not translate host name "${host ?? ''}" to address` }
    return response(sandbox, [err(error.message)], [{ kind: 'connection', error }])
  }
  const ref = { server: server.name, resourceGroup: server.resourceGroup, database: dbname, port, nowMs: context?.run?.elapsedMs ?? 0 }
  let current = sandbox, session = { settings: {} }
  const lines = [], results = []
  for (const action of args.commands) {
    let sql = action.value
    if (action.kind === 'file') {
      const path = action.value.replace(/^\.\//, '')
      sql = context?.run?.project?.savedFiles?.[path]
      if (typeof sql !== 'string') {
        const result = { kind: 'file', error: { code: 'OperationalError', message: `psql: error: ${action.value}: No such saved project file` } }
        results.push(result); lines.push(...resultLines(result)); break
      }
      const v3Loader = path === 'load-v3.sql' && sql === POSTGRES_V3_LOAD
        && context?.run?.project?.manifestId === POSTGRES_INDEPENDENT_MANIFEST.id
      if (v3Loader || path === 'load.sql' && /^\s*-- simulator:load-corpus\s*$/.test(sql)) {
        // Establish the same connection checks as SQL, even for this fixed COPY
        // stand-in. Loading validates both tables and commits them together.
        const checked = executePg(current, { ...ref, sql: '-- connection check', session })
        if (checked.results.some(result => result.error)) { results.push(...checked.results); lines.push(...checked.results.flatMap(resultLines)); break }
        try {
          const loaded = loadCorpus(current, { ...ref, ...(v3Loader ? { corpus: SUPPORT_V3_CORPUS } : {}) })
          current = loaded.sandbox
          const result = { kind: 'load-corpus', rowCount: loaded.rowCount, logicalRows: loaded.logicalRows }
          results.push(result); lines.push(...resultLines(result)); continue
        } catch (error) {
          const result = { kind: 'load-corpus', error: { code: error.code ?? 'ProgrammingError', message: /^(ERROR:|FATAL:|psql:|Not supported)/.test(error.message) ? error.message : `ERROR: ${error.message}` } }
          results.push(result); lines.push(...resultLines(result)); break
        }
      }
    }
    const executed = executePg(current, { ...ref, sql, session })
    current = executed.sandbox
    session = executed.session
    results.push(...executed.results)
    lines.push(...executed.results.flatMap(resultLines))
    if (executed.results.some(result => result.error)) break
  }
  return response(current, lines, results, session)
}

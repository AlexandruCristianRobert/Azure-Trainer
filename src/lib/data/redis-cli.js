import { executeRedis } from './redis-store.js'
import { executeRedisSearch } from './redis-search.js'

const unsupported = message => ({ code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: ${message}` })
const response = (sandbox, result) => ({ sandbox, lines: [{ text: result.error ? result.error.message : display(result.value), kind: result.error ? 'err' : 'out' }],
  results: [result], events: [], latencyMs: 0 })
function display(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value, (_key, child) => child?.redisKind === 'bytes' ? '<binary>' : child)
}

export function runRedisCli(sandbox, tokens, context) {
  const fail = error => response(sandbox, { kind: 'connection', error })
  if (context?.lab?.capabilities?.dataRedis !== true) return fail(unsupported('redis-cli requires the dataRedis capability.'))
  const options = {}, allowed = ['-h', '-p', '-a', '--tls']
  let offset = 0
  while (offset < tokens.length && tokens[offset].startsWith('-')) {
    const option = tokens[offset++]
    if (!allowed.includes(option) || Object.hasOwn(options, option)) return fail(unsupported(`redis-cli option '${option}'.`))
    if (option === '--tls') options[option] = true
    else {
      if (offset === tokens.length || tokens[offset].startsWith('-')) return fail(unsupported(`redis-cli option '${option}' requires a value.`))
      options[option] = tokens[offset++]
    }
  }
  if (offset === tokens.length) return fail(unsupported('interactive redis-cli; supply one command.'))
  const cluster = sandbox.redisClusters?.find(cluster => cluster.hostName === options['-h'])
  if (!cluster || options['-p'] !== '10000' || !options['--tls'] || options['-a'] !== 'Training-Only-Redis-Key'
    || cluster.database.clientProtocol !== 'Encrypted' || cluster.database.accessKeysAuthentication !== 'Enabled') {
    return fail({ code: 'ConnectionError', message: 'redis-cli: connection requires the supplied training host, port 10000, --tls and training-only key authentication.' })
  }
  const command = tokens[offset++].toUpperCase()
  let args = tokens.slice(offset)
  if (command === 'FT.SEARCH') return response(sandbox, { kind: command, error: unsupported('binary vector queries are taught through Python, not shell literals.') })
  if (command === 'HSET') {
    if (args.length < 3 || args.length % 2 !== 1) return response(sandbox, { kind: command, error: { code: 'ResponseError', message: "ERR wrong number of arguments for 'hset' command" } })
    const mapping = {}
    for (let i = 1; i < args.length; i += 2) Object.defineProperty(mapping, args[i], { value: args[i + 1], writable: true, enumerable: true, configurable: true })
    args = [args[0], mapping]
  }
  const target = { kind: 'redis', resourceGroup: cluster.resourceGroup, cluster: cluster.name, database: cluster.database.name }
  const execute = command.startsWith('FT.') ? executeRedisSearch : executeRedis
  const result = execute(sandbox, target, command, args, { nowMs: context?.run?.runtime?.simTimeMs ?? 0 })
  const { sandbox: next, ...details } = result
  const rendered = response(next, { kind: command, ...details })
  // Labels belong to presentation/measurements; raw FT.INFO remains RESP2.
  if (command === 'FT.INFO' && !result.error) rendered.lines.push({ kind: 'out', text: result.measurements.approximation }, { kind: 'out', text: result.measurements.estimate })
  return rendered
}

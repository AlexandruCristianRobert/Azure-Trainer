import { tokenize } from './tokenize.js'
import { runAz } from './run.js'
import { runKubectl } from '../kubernetes/kubectl.js'
import { runPsql } from '../data/psql.js'
import { runRedisCli } from '../data/redis-cli.js'

const EMPTY = (sandbox) => ({ sandbox, lines: [], events: [], latencyMs: 0, clear: false })

export function runLine(sandbox, line, context) {
  const { tokens, error } = tokenize(line)
  if (error) return { ...EMPTY(sandbox), lines: [{ text: `bash: ${error}`, kind: 'err' }] }
  if (tokens.length === 0) return EMPTY(sandbox)
  const [cmd, ...rest] = tokens
  if (cmd === 'clear') return { ...EMPTY(sandbox), clear: true }
  if (cmd === 'az') return { ...runAz(sandbox, rest, context), clear: false }
  if (cmd === 'kubectl' && context?.lab?.capabilities?.kubernetes === true) return { ...runKubectl(sandbox, rest, context), clear: false }
  if (cmd === 'psql' && (context?.lab?.capabilities?.dataPostgres === true || context?.lab?.capabilities?.dataCapstone === true)) return { ...runPsql(sandbox, rest, context), clear: false }
  if (cmd === 'redis-cli' && (context?.lab?.capabilities?.dataRedis === true || context?.lab?.capabilities?.dataCapstone === true)) return { ...runRedisCli(sandbox, rest, context), clear: false }
  return { ...EMPTY(sandbox), lines: [{ text: `bash: ${cmd}: command not found`, kind: 'err' }] }
}

import { tokenize } from './tokenize.js'
import { runAz } from './run.js'
import { runKubectl } from '../kubernetes/kubectl.js'
import { runPsql } from '../data/psql.js'
import { runRedisCli } from '../data/redis-cli.js'
import { runMessagingShell } from '../messaging/shell.js'
import { httpShellEffect } from '../http-functions/shell.js'

const EMPTY = (sandbox) => ({ sandbox, lines: [], events: [], latencyMs: 0, clear: false })

export function runLine(sandbox, line, context) {
  const { tokens, error } = tokenize(line)
  if (error) return { ...EMPTY(sandbox), lines: [{ text: `bash: ${error}`, kind: 'err' }] }
  if (tokens.length === 0) return EMPTY(sandbox)
  const [cmd, ...rest] = tokens
  if (cmd === 'clear') return { ...EMPTY(sandbox), clear: true }
  if (cmd === 'az') return { ...runAz(sandbox, rest, context), clear: false }
  const http = httpShellEffect(tokens, context)
  if (http) return http.diagnostic ? { ...EMPTY(sandbox), diagnostics: [http.diagnostic], lines: [{ text: `${http.diagnostic.code}: ${http.diagnostic.message}`, kind: 'err' }] }
    : { ...EMPTY(sandbox), effects: [http] }
  if (['python', 'func'].includes(cmd) && context?.lab?.capabilities?.messaging === true) return runMessagingShell(sandbox, cmd, rest, context)
  if (cmd === 'kubectl' && context?.lab?.capabilities?.kubernetes === true) return { ...runKubectl(sandbox, rest, context), clear: false }
  if (cmd === 'psql' && (context?.lab?.capabilities?.dataPostgres === true || context?.lab?.capabilities?.dataCapstone === true)) return { ...runPsql(sandbox, rest, context), clear: false }
  if (cmd === 'redis-cli' && (context?.lab?.capabilities?.dataRedis === true || context?.lab?.capabilities?.dataCapstone === true)) return { ...runRedisCli(sandbox, rest, context), clear: false }
  return { ...EMPTY(sandbox), lines: [{ text: `bash: ${cmd}: command not found`, kind: 'err' }] }
}

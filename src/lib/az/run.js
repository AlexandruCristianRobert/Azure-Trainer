import { buildTree } from './commands/index.js'
import { parseArgs, HELP_FLAGS } from './args.js'
import { toAzJson } from './format.js'
import { renderCommandHelp, renderGroupHelp } from './help.js'
import { AzError } from '../sandbox/errors.js'
import { BANNER, VERSION_TEXT } from './commands/misc.js'

function similar(word, candidates) {
  const w = word.toLowerCase()
  return candidates.filter((c) => {
    const d = levenshtein(w, c.toLowerCase())
    return d <= Math.max(1, Math.floor(c.length / 3))
  })
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

function formatError(e) {
  if (e instanceof AzError && e.kind === 'arm') return `(${e.code}) ${e.message}\nCode: ${e.code}\nMessage: ${e.message}`
  return e.message
}

function bannerText(root) {
  const width = Math.max(...Object.keys(root.children).map((k) => k.length)) + 4
  const rows = Object.entries(root.children).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `    ${k.padEnd(width)}: ${n.summary}`)
  return `${BANNER}${rows.join('\n')}\n`
}

// tokens: argv after the leading "az"
export function runAz(sandbox, tokens, context) {
  const root = buildTree()
  const out = (text) => ({ text, kind: 'out' })
  const err = (text) => ({ text, kind: 'err' })

  if (tokens.length === 0) return { sandbox, lines: [out(bannerText(root))], events: [], latencyMs: 0 }
  if (tokens.length === 1 && tokens[0] === '--version') return { sandbox, lines: [out(VERSION_TEXT)], events: [], latencyMs: 250 }
  if (tokens.length === 1 && HELP_FLAGS.includes(tokens[0])) return { sandbox, lines: [out(renderGroupHelp(root))], events: [], latencyMs: 0 }

  let node = root
  let i = 0
  while (i < tokens.length && node.type === 'group') {
    const tok = tokens[i]
    if (HELP_FLAGS.includes(tok)) return { sandbox, lines: [out(renderGroupHelp(node))], events: [], latencyMs: 0 }
    const child = node.children[tok]
    if (!child) {
      const suggestions = similar(tok, Object.keys(node.children))
      let msg = `'${tok}' is misspelled or not recognized by the system.`
      if (suggestions.length === 1) msg += `\nThe most similar choice to '${tok}' is:\n        ${suggestions[0]}`
      else if (suggestions.length > 1) msg += `\nThe most similar choices to '${tok}' are:\n${suggestions.map((s) => `        ${s}`).join('\n')}`
      return { sandbox, lines: [err(msg)], events: [], latencyMs: 0 }
    }
    node = child
    i++
  }
  if (node.type === 'group') return { sandbox, lines: [out(renderGroupHelp(node))], events: [], latencyMs: 0 }

  const { values, error, wantsHelp } = parseArgs(node.args, tokens.slice(i), sandbox.defaults)
  if (wantsHelp) {
    const selected = Array.isArray(context?.lab?.bicepTargets) && node.path[0] === 'deployment'
      && ['validate', 'what-if', 'create'].includes(node.path[2])
      ? { ...node, args: node.args.map(arg => arg.name === '--parameters'
        ? { ...arg, help: `Saved local parameter file: ${context.lab.bicepTargets.map(target => target.parameterPath).join(' or ')}.` }
        : arg) } : node
    return { sandbox, lines: [out(renderCommandHelp(selected))], events: [], latencyMs: 0 }
  }
  if (error) return { sandbox, lines: [err(error)], events: [], latencyMs: 0 }

  try {
    const result = node.run({ sandbox, context }, values)
    const lines = []
    if (values.globalOutput !== 'none' && result.output !== null && result.output !== undefined) {
      lines.push(out(typeof result.output === 'string' ? result.output : toAzJson(result.output)))
    }
    return { sandbox: result.sandbox ?? sandbox, lines, events: result.events ?? [], latencyMs: node.latencyMs, ...(result.effects ? { effects: result.effects } : {}) }
  } catch (e) {
    if (e instanceof AzError) return { sandbox, lines: [err(formatError(e))], events: [], latencyMs: Math.min(node.latencyMs, 600), ...(e.diagnostics ? { diagnostics: e.diagnostics } : {}) }
    throw e
  }
}

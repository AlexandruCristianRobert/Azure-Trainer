const GLOBAL_ARGS = [
  ['--debug', 'Increase logging verbosity to show all debug logs.'],
  ['--help -h', 'Show this help message and exit.'],
  ['--only-show-errors', 'Only show errors, suppressing warnings.'],
  ['--output -o', 'Output format.  Allowed values: json, jsonc, none, table, tsv, yaml, yamlc.  Default: json.'],
  ['--query', 'JMESPath query string. See http://jmespath.org/ for more information and examples.'],
  ['--subscription', 'Name or ID of subscription. You can configure the default subscription using `az account set -s NAME_OR_ID`.'],
  ['--verbose', 'Increase logging verbosity. Use --debug for full debug logs.'],
]

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function argLabel(a) {
  return [a.name, ...(a.aliases ?? [])].join(' ')
}

function argHelp(a) {
  let h = a.help ?? ''
  if (a.kind === 'bool') h += '  Allowed values: false, true.'
  else if (a.choices) h += `  Allowed values: ${a.choices.join(', ')}.`
  if (a.defaultValue !== undefined) h += `  Default: ${a.defaultValue}.`
  return h
}

function renderArgs(title, args) {
  if (!args.length) return ''
  const width = Math.max(...args.map((a) => argLabel(a).length))
  const lines = args.map((a) => `    ${pad(argLabel(a), width)}${a.required ? '[Required]' : '          '} : ${argHelp(a)}`)
  return `${title}\n${lines.join('\n')}\n`
}

export function renderCommandHelp(node) {
  const full = `az ${node.path.join(' ')}`
  const required = node.args.filter((a) => a.required)
  const optional = node.args.filter((a) => !a.required)
  let out = `\nCommand\n    ${full} : ${node.summary}\n\n`
  out += renderArgs('Arguments', [...required, ...optional])
  out += '\n'
  out += `Global Arguments\n${GLOBAL_ARGS.map(([n, h]) => `    ${pad(n, 20)}: ${h}`).join('\n')}\n`
  if (node.examples?.length) {
    out += `\nExamples\n${node.examples.map((e) => `    ${e.summary}\n        ${e.command}`).join('\n\n')}\n`
  }
  out += `\nTo search AI knowledge base for examples, use: az find "${full}"\n`
  return out
}

export function renderGroupHelp(node) {
  const full = node.path.length ? `az ${node.path.join(' ')}` : 'az'
  const entries = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b))
  const groups = entries.filter(([, n]) => n.type === 'group')
  const cmds = entries.filter(([, n]) => n.type === 'command')
  const width = Math.max(0, ...entries.map(([k]) => k.length)) + 1
  let out = `\nGroup\n    ${full} : ${node.summary}\n`
  if (groups.length) out += `\nSubgroups:\n${groups.map(([k, n]) => `    ${pad(k, width)}: ${n.summary}`).join('\n')}\n`
  if (cmds.length) out += `\nCommands:\n${cmds.map(([k, n]) => `    ${pad(k, width)}: ${n.summary}`).join('\n')}\n`
  out += `\nTo search AI knowledge base for examples, use: az find "${full}"\n`
  return out
}

import { parser } from '@lezer/python'
import { parseRetrievalSql } from './retrieval-sql.js'

const diagnostic = (code, message, path = 'app.py') => ({ code, message, path, line: 1, column: 1 })
const literal = value => ({ op: 'literal', value })

function answerBody(text) {
  const match = /^def\s+answer\s*\(\s*([A-Za-z_]\w*)\s*\)\s*:\s*$/m.exec(text)
  if (!match) return null
  const start = match.index + match[0].length
  const rest = text.slice(start).split('\n')
  const lines = []
  for (const line of rest) {
    if (line && !/^\s/.test(line)) break
    lines.push(line.replace(/#.*/, ''))
  }
  return { question: match[1], text: lines.join('\n') }
}

function configReferences(body, name) {
  const keys = []
  const re = new RegExp(`${name}\\s*\\[\\s*["']([^"']+)["']\\s*\\]`, 'g')
  for (let match; (match = re.exec(body));) keys.push(match[1])
  return keys
}

export function parsePythonIntegration(files, manifest = {}) {
  const app = files?.['app.py']
  if (typeof app !== 'string') return { appSpec: null, diagnostics: [diagnostic('MISSING_FILE', 'A required Python source file is missing.')] }
  let syntaxError = false
  parser.parse(app).iterate({ enter(node) { if (node.name === '⚠') syntaxError = true } })
  if (syntaxError) return { appSpec: null, diagnostics: [diagnostic('PYTHON_SYNTAX', 'Python source contains a syntax error.')] }
  const diagnostics = []
  if (files['integration_clients.py'] !== manifest.fixedFiles?.['integration_clients.py']) diagnostics.push(diagnostic('SCAFFOLD_MODIFIED', 'The supplied integration helper is fixed.', 'integration_clients.py'))
  if (files['server.py'] !== manifest.fixedFiles?.['server.py']) diagnostics.push(diagnostic('SCAFFOLD_MODIFIED', 'The supplied HTTP server is fixed.', 'server.py'))
  const sql = parseRetrievalSql(files?.['retrieval.sql'])
  diagnostics.push(...sql.diagnostics)
  const body = answerBody(app)
  if (!body) diagnostics.push(diagnostic('PYTHON_UNSUPPORTED', 'Define answer(question) as the active integration entry point.'))
  if (body && (!/\.strip\(\)/.test(body.text) || !new RegExp(`if\\s+not\\s+${body.question}\\s*:`).test(body.text))) diagnostics.push(diagnostic('PYTHON_UNSUPPORTED', 'answer() must strip and validate its question.'))
  if (diagnostics.length) return { appSpec: null, diagnostics }

  const graph = { version: 1, nodes: [], edges: [] }
  const add = (op, fields = {}) => { const node = { id: `n${graph.nodes.length + 1}`, op, ...fields }; graph.nodes.push(node); return node.id }
  const question = add('input', { name: body.question })
  const validation = add('validate-question', { input: question, trimmed: /\.strip\(\)/.test(body.text) })
  const cfgName = /([A-Za-z_]\w*)\s*=\s*settings\s*\(\s*\)/.exec(body.text)?.[1] ?? 'cfg'
  const cfg = add('settings', { name: cfgName })
  const embed = /([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.embed\s*\(\s*([^,]+)\s*,\s*([^\)]+)\)/.exec(body.text)
  let vector
  if (embed) vector = add('embed', { client: embed[2], question: embed[3].trim(), deployment: configReferences(embed[4], cfgName)[0] ?? null })
  else {
    const assigned = /(?:vector|embedding)\s*=\s*as_vector\s*\(\s*(\[[^\]]*\])\s*\)/.exec(body.text)
    vector = assigned ? add('literal', { value: JSON.parse(assigned[1]) }) : add('unknown', { reason: 'No embedding call in active answer().' })
  }
  for (const match of body.text.matchAll(/as_vector\s*\(\s*(\[[^\]]*\])\s*\)/g)) add('literal', { value: JSON.parse(match[1]) })
  const query = /([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.query\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([\s\S]*?)\)/.exec(body.text)
  const params = [...body.text.matchAll(/["']([A-Za-z_]\w*)["']\s*:\s*([^,}\n]+)/g)].map(match => ({ name: match[1], expression: match[2].trim() }))
  const rows = add('query', { client: query?.[2] ?? null, vector: query?.[3]?.trim() ?? null, sql: query?.[4]?.trim() ?? null, parameters: params, querySpec: sql.querySpec })
  const context = add('context', { rows })
  const answer = /([A-Za-z_]\w*)\.answer\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\)]+)\)/.exec(body.text)
  const completion = add('answer', { client: answer?.[1] ?? null, question: answer?.[2]?.trim() ?? null, context: answer?.[3]?.trim() ?? null, deployment: configReferences(answer?.[4] ?? '', cfgName)[0] ?? null })
  const sourceLiteral = /["']sources["']\s*:\s*(\[[^\]]*\])/.exec(body.text)
  const sources = sourceLiteral && !/for\s+/.test(sourceLiteral[1]) ? add('literal', { value: JSON.parse(sourceLiteral[1].replaceAll("'", '"')) }) : null
  add('response', { status: /"status"\s*:\s*200/.test(body.text) ? 200 : null, answer: completion, sources: sources ?? /"sources"\s*:/.test(body.text) })
  graph.edges = [[question, validation], [validation, vector], [cfg, vector], [vector, rows], [rows, context], [context, completion]]
  return { appSpec: { language: 'python', service: 'knowledge-assistant', version: 'integration-v1', listeningPort: 8080,
    routes: [{ method: 'GET', path: '/api/info' }, { method: 'POST', path: '/api/ask', response: { kind: 'integration' } }],
    integration: { adapter: 'integration-fixture-v1', graph, query: sql.querySpec } }, diagnostics: [] }
}

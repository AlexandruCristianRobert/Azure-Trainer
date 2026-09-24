import { CAPSTONE_PROGRAM } from '../../data/templates/containerapps-dotnet/capstone.js'
import { TROUBLESHOOTING_FOUNDRY_PROGRAM } from '../../data/templates/containerapps-dotnet/foundry-troubleshooting.js'
import { parseTroubleshootingFoundrySource } from './foundry.js'

const path = 'src/Trainer.Api/Program.cs'
const settingsPath = 'src/Trainer.Api/appsettings.json'
const diagnostic = (code, message, token = { line: 1, column: 1 }, file = path) => ({ code, message, path: file, line: token.line, column: token.column })

// Keep punctuation and string tokens distinct. Comments never produce executable tokens.
function tokenize(source, limit) {
  const result = []
  let offset = 0; let line = 1; let column = 1
  const advance = (text) => { for (const char of text) { if (char === '\n') { line++; column = 1 } else column++ } offset += text.length }
  while (offset < source.length) {
    const remaining = source.slice(offset)
    if (/^\s/.test(remaining)) { advance(/^\s+/.exec(remaining)[0]); continue }
    if (remaining.startsWith('//')) { advance(/^\/\/[^\r\n]*/.exec(remaining)[0]); continue }
    if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/', 2)
      if (end < 0) return { tokens: result, diagnostics: [diagnostic('UNTERMINATED_COMMENT', 'Unterminated comment.', { line, column })] }
      advance(remaining.slice(0, end + 2)); continue
    }
    const token = { line, column }
    if (remaining[0] === '"') {
      const match = /^"(?:\\["\\nrt]|[^"\\\r\n])*"/.exec(remaining)
      if (!match) return { tokens: result, diagnostics: [diagnostic('INVALID_STRING', 'Malformed string literal.', token)] }
      result.push({ ...token, value: match[0] }); advance(match[0]); continue
    }
    const match = /^(?:[A-Za-z_][A-Za-z_0-9]*|[0-9]+|=>|==|<=|>=|\|\||&&|\?\?|\?\.|.)/.exec(remaining)
    result.push({ ...token, value: match[0] }); advance(match[0])
    if (result.length > limit) return { tokens: result, diagnostics: [diagnostic('TOKEN_LIMIT', `Source exceeds ${limit} tokens.`, token)] }
  }
  return { tokens: result, diagnostics: [] }
}

const expected = tokenize(CAPSTONE_PROGRAM, 5000).tokens
const values = expected.map(token => token.value)
const slot = (sequence) => values.findIndex((_, index) => sequence.every((value, offset) => values[index + offset] === value)) + sequence.length
const cpuLimitIndex = slot(['units', '>', '100']) - 1
const healthIndices = ['StartupComplete', 'Ready', 'Responsive'].map(name => values.findIndex((value, index) => value === name && values[index - 1] === '.' && values[index - 2] === 'HealthState'))
const conditions = Object.freeze({ StartupComplete: 'startup', Ready: 'ready', Responsive: 'responsive', DependencyAvailable: 'dependency' })

export function parseCapstoneSource(program, configuration, maxTokens = 5000) {
  const scanned = tokenize(program, maxTokens)
  const diagnostics = [...scanned.diagnostics]
  const actual = scanned.tokens
  if (!diagnostics.length && actual.length !== expected.length) diagnostics.push(diagnostic('UNSUPPORTED_CAPSTONE_SOURCE',
    'The combined info, CPU, Foundry, health and listener source is required.', actual[Math.min(actual.length, expected.length - 1)] ?? expected.at(-1)))
  if (!diagnostics.length) {
    for (let index = 0; index < expected.length; index++) {
      if (index === cpuLimitIndex || healthIndices.includes(index)) continue
      if (actual[index].value !== expected[index].value) {
        diagnostics.push(diagnostic('UNSUPPORTED_CAPSTONE_SOURCE', 'Unsupported executable source.', actual[index]))
        break
      }
    }
  }
  const maxUnits = Number(actual[cpuLimitIndex]?.value)
  if (!Number.isInteger(maxUnits) || maxUnits < 1 || maxUnits > 1000) diagnostics.push(diagnostic('INVALID_CPU_BOUNDS',
    'CPU units must be bounded from 1 to 1000.', actual[cpuLimitIndex] ?? expected[cpuLimitIndex]))
  const healthEndpoints = healthIndices.map((index, offset) => ({ path: ['/health/startup', '/health/ready', '/health/live'][offset],
    condition: conditions[actual[index]?.value] }))
  healthEndpoints.forEach((endpoint, offset) => {
    if (!endpoint.condition) diagnostics.push(diagnostic('UNSUPPORTED_HEALTH_ROUTE',
      'Use a supported executable health condition.', actual[healthIndices[offset]] ?? expected[healthIndices[offset]]))
  })
  const foundry = parseTroubleshootingFoundrySource(TROUBLESHOOTING_FOUNDRY_PROGRAM, configuration)
  diagnostics.push(...foundry.diagnostics)
  if (configuration && (configuration.TotalAttempts !== 3 || configuration.TotalBudgetSeconds !== 10
    || configuration.AttemptTimeoutSeconds !== 3 || configuration.HonorRetryAfter !== true)) {
    diagnostics.push(diagnostic('INVALID_FOUNDRY_POLICY', 'Capstone requires three attempts, a ten-second budget, a three-second attempt cap and Retry-After.',
      { line: 1, column: 1 }, settingsPath))
  }
  return { cpuRoute: { method: 'GET', path: '/api/work', maxUnits, response: 'checksum' },
    healthEndpoints, foundry: foundry.foundry, diagnostics }
}

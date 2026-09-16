// Bash-like tokenizer: whitespace splitting, '…' literal quotes, "…" quotes with \ escapes,
// backslash escapes outside quotes, and $IDENT expansion to '' outside single quotes
// (the Sandbox shell has no variables, exactly like a fresh bash session).
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y

export function tokenize(line) {
  const tokens = []
  let cur = ''
  let has = false
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote === "'") {
      if (ch === "'") { quote = null; continue }
      cur += ch
      continue
    }
    if (quote === '"') {
      if (ch === '"') { quote = null; continue }
      if (ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { cur += line[++i]; continue }
      if (ch === '$') { i = expandVar(line, i); continue }
      cur += ch
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; has = true; continue }
    if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue }
    if (ch === '$') { has = true; i = expandVar(line, i); continue }
    if (/\s/.test(ch)) {
      if (has) { tokens.push(cur); cur = ''; has = false }
      continue
    }
    cur += ch
    has = true
  }
  if (quote) return { tokens: null, error: `unexpected EOF while looking for matching \`${quote}'` }
  if (has) tokens.push(cur)
  return { tokens, error: null }
}

// Returns the index of the last consumed character of "$IDENT" (or of "$" alone).
function expandVar(line, dollarIndex) {
  IDENT_RE.lastIndex = dollarIndex + 1
  const m = IDENT_RE.exec(line)
  return m ? dollarIndex + m[0].length : dollarIndex
}

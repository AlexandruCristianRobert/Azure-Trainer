// Small line-local scan: comments do not hide a block colon, quoted # does.
function endsWithPythonColon(line) {
  let quote = ''
  let code = ''
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'") {
      quote = char
      code += 's'
    } else if (char === '#') break
    else code += char
  }
  return !quote && code.trimEnd().endsWith(':')
}

export function editProjectText({ text, start, end, key, path = '', shiftKey = false }) {
  if (key !== 'Tab' && (key !== 'Enter' || shiftKey)) return null
  const python = /\.py$/i.test(path)
  const width = python || /\.cs$/i.test(path) ? 4 : 2
  const indent = ' '.repeat(width)
  const rowStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1

  if (key === 'Enter') {
    const beforeCaret = text.slice(rowStart, start)
    const whitespace = beforeCaret.match(/^[\t ]*/)[0]
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const insert = newline + whitespace + (python && endsWithPythonColon(beforeCaret) ? indent : '')
    const caret = start + insert.length
    return { text: text.slice(0, start) + insert + text.slice(end), start: caret, end: caret }
  }

  const edits = []
  let position = rowStart
  do {
    const prefix = text.slice(position).match(/^(?:\t| *)/)[0]
    const remove = shiftKey ? (prefix.startsWith('\t') ? 1 : Math.min(prefix.length, width)) : 0
    edits.push({ position, remove, insert: shiftKey ? '' : indent })
    const newline = text.indexOf('\n', position)
    if (newline === -1) break
    position = newline + 1
  } while (position < end)

  // Map both endpoints in original coordinates, including carets within removed whitespace.
  const map = (offset) => offset + edits.reduce((delta, edit) => {
    if (edit.position > offset) return delta
    return delta + edit.insert.length - Math.min(edit.remove, offset - edit.position)
  }, 0)
  let result = text
  for (const edit of [...edits].reverse()) {
    result = result.slice(0, edit.position) + edit.insert + result.slice(edit.position + edit.remove)
  }
  return { text: result, start: map(start), end: map(end) }
}

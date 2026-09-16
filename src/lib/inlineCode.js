const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c])
}

// Task/Hint/Exam Note text uses backticks for code. Output is safe to bind with v-html.
export function renderInline(text) {
  const parts = String(text).split('`')
  if (parts.length % 2 === 0) return escapeHtml(text)
  return parts.map((p, i) => (i % 2 === 1 ? `<code>${escapeHtml(p)}</code>` : escapeHtml(p))).join('')
}

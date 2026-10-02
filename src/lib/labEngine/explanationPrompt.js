const authoredText = value => typeof value === 'string' ? value.trim() : ''

export function buildExplanationPrompt({ labTitle, taskText, rationale = {} }) {
  // Read only authored learning fields: never serialize the task/workspace.
  const context = [
    ['Concept', rationale?.concept],
    ['What it does', rationale?.what],
    ['Why this application uses it', rationale?.why],
    ['What happens without it', rationale?.without],
    ['C# comparison', rationale?.csharp],
  ].filter(([, value]) => authoredText(value))
    .map(([label, value]) => `${label}: ${authoredText(value)}`)
  return [
    'I know C# and am learning Python for AI-200.',
    `In this Order Processing Application lab, "${authoredText(labTitle)}", I am working on: ${authoredText(taskText)}`,
    ...context,
    'Explain the concept: what it does, why we use it here, and what happens without it. Use a short C# comparison where useful. Explain the concept without giving the complete lab Solution.',
  ].join('\n\n')
}

export async function copyExplanationPrompt(text, clipboard) {
  try {
    if (typeof clipboard?.writeText !== 'function') return { copied: false, fallback: text }
    await clipboard.writeText(text)
    return { copied: true, fallback: null }
  } catch {
    return { copied: false, fallback: text }
  }
}

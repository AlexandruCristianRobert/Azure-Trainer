import { CORPUS, corpusQuestions } from './corpus.js'

// One local, fictional PG corpus supplies every service's eight-dimensional
// vectors. Redis's separate 30-day source fixture is deliberately not used.
const clone = value => JSON.parse(JSON.stringify(value))
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return Object.freeze(value)
}
// Finite ECMAScript whitespace rule, also emitted into the protected Python
// helper. NEL/U+001C..U+001F remain text; BOM is collapsed as whitespace.
export const CAPSTONE_WHITESPACE_PATTERN = '[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+'
const whitespace = new RegExp(CAPSTONE_WHITESPACE_PATTERN, 'g')
export const capstoneNormalize = text => String(text).replace(whitespace, ' ').replace(/^ | $/g, '').toLowerCase()
export const CAPSTONE_NO_MATCH = "I couldn't find that in the documentation."
const corpus = clone(CORPUS)
// The PG-only lab's deliberate foreign-scope decoy is a Support hours row.
// Restore its topic direction now that Support has its own retention topic.
corpus.chunks.find(c => c.id === 17).embedding = [0, 0, 0, 0, 1, 0.1, 0, 0]
const questions = corpusQuestions().map(q => ({ ...q, kind: 'canonical' }))
const retention = questions[0].text
const paraphrases = [
  ['How long does Contoso Backup keep my snapshots?', 0],
  ['Where can I request a senior engineer for my Contoso Support v1 ticket?', 4],
]
for (const [text, index] of paraphrases) questions.push({ ...clone(questions[index]), text, kind: 'paraphrase' })

const scopeVariants = [
  { product: 'contoso-backup', version: 'v1', language: 'en', expectedChunkIds: [1, 2] },
  { product: 'contoso-backup', version: 'v2', language: 'en', expectedChunkIds: [9, 10] },
  { product: 'contoso-backup', version: 'v1', language: 'de', expectedChunkIds: [5, 6] },
  { product: 'contoso-support', version: 'v1', language: 'en', expectedChunkIds: [33, 34] },
]
const addTopic = (scope, topic, passages, embedding) => {
  const id = corpus.documents.length + 1
  corpus.documents.push({ id, ...scope, metadata: { ...scope, audience: 'operators', tags: [topic, 'training-only'] }, body: passages.join('\n\n'), updated_at: '2025-01-06T09:00:00Z' })
  const ids = []
  passages.forEach((content, chunk_index) => {
    const chunkId = corpus.chunks.length + 1
    ids.push(chunkId)
    corpus.chunks.push({ id: chunkId, document_id: id, chunk_index, content, embedding: [...embedding] })
  })
  return ids
}
addTopic({ product: 'contoso-support', version: 'v1', language: 'en' }, 'diagnostic-retention', [
  'Contoso Support diagnostic snapshots are retained for 7 days by default.',
  'The case owner can extend the diagnostic snapshot retention window before expiry.',
], [1, 0.12, 0, 0, 0, 0, 0, 0])
for (const scope of scopeVariants) questions.push({ text: retention, ...scope, vector: [...questions[0].vector], kind: 'scope-variant' })

// These requests are related to retention, but answer a different question.
// Their orthogonal authored direction prevents loose semantic reuse.
const nearVector = [0, 1, 0, 0, 0, 0, 0, 0]
for (const { expectedChunkIds: unused, ...scope } of scopeVariants) {
  const answer = scope.product === 'contoso-support'
    ? 'A Contoso Support case owner must approve early deletion of diagnostic snapshots.'
    : scope.language === 'de'
      ? 'Kontaktieren Sie Contoso Backup Support fuer eine vorzeitige Loeschung; Self-Service ist nicht verfuegbar.'
      : scope.version === 'v2'
        ? 'In Contoso Backup v2, request early snapshot deletion through the Backup Center approval workflow.'
        : 'In Contoso Backup v1, contact Backup Support to request early snapshot deletion.'
  const ids = addTopic(scope, 'early-deletion', [answer, 'Early deletion requires approval and does not change the default retention policy.'], nearVector)
  questions.push({ text: 'How do I permanently delete a Contoso Backup snapshot before its retention period ends?', ...scope, vector: [...nearVector], expectedChunkIds: ids, kind: 'near-miss' })
}

// Stable primary/foreign keys: replacements are scoped to product/version/
// language. Applying an update overlays live rows, preserving other updates.
const replacements = (product, ids, transform) => {
  const chunks = corpus.chunks.filter(c => ids.includes(c.id)).map(c => ({ ...clone(c), content: transform(c.content) }))
  const documentIds = new Set(chunks.map(c => c.document_id))
  const documents = corpus.documents.filter(d => documentIds.has(d.id)).map(d => ({ ...clone(d), body: transform(d.body), updated_at: '2026-10-02T09:00:00Z' }))
  return { product, revision: 2, documents, chunks }
}
export const CAPSTONE_REVISION_2 = freeze({
  'contoso-backup': replacements('contoso-backup', [1, 2, 5, 6], content => content.replaceAll('35 days', '14 days').replaceAll('35-day', '14-day').replaceAll('35 Tage', '14 Tage')),
  'contoso-support': replacements('contoso-support', [19, 20], () => 'Set priority to Sev1 and use Request senior engineer review in the ticket panel.'),
})
export const CAPSTONE_CORPUS = freeze(corpus)
export const CAPSTONE_QUESTIONS = freeze(questions.map(q => ({ ...q, answer: corpus.chunks.find(c => c.id === q.expectedChunkIds[0]).content })))

export function capstoneCorpusRevision(liveCorpus, product, revision = 2) {
  const patch = revision === 2 ? CAPSTONE_REVISION_2[product] : null
  if (!patch) throw new Error('Unsupported capstone product revision')
  const next = clone(liveCorpus)
  for (const table of ['documents', 'chunks']) {
    const replacementsById = new Map(patch[table].map(row => [row.id, row]))
    next[table] = next[table].map(row => clone(replacementsById.get(row.id) ?? row))
  }
  return next
}

export function capstoneEmbed(question, deployment = 'embeddings-v1') {
  if (deployment !== 'embeddings-v1') return null
  const entry = CAPSTONE_QUESTIONS.find(q => capstoneNormalize(q.text) === capstoneNormalize(question))
  return entry ? [...entry.vector] : Array(8).fill(0)
}

// The executable helper consumes only returned context, never IDs or the
// grading oracle. A replaced PG passage therefore immediately changes output.
export function capstoneTrainingAnswer(question, context) {
  if (!Array.isArray(context?.sources) || !context.sources.length || typeof context.passages !== 'string' || !context.passages) return CAPSTONE_NO_MATCH
  return context.passages.split('\n\n')[0]
}

// Grading only: application runtime must never invoke this function.
export function capstoneExpectedAnswer(question, scope, revision = 1) {
  const entry = CAPSTONE_QUESTIONS.find(q => capstoneNormalize(q.text) === capstoneNormalize(question)
    && ['product', 'version', 'language'].every(key => q[key] === scope?.[key]))
  if (!entry) return { answer: CAPSTONE_NO_MATCH, sources: [], ...scope }
  const live = revision === 2 ? capstoneCorpusRevision(CAPSTONE_CORPUS, scope.product) : CAPSTONE_CORPUS
  return { answer: live.chunks.find(c => c.id === entry.expectedChunkIds[0]).content, sources: [...entry.expectedChunkIds], product: scope.product, version: scope.version, language: scope.language }
}

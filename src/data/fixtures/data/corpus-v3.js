import { CORPUS, corpusQuestions } from './corpus.js'

// Bounded, fictional audience-specific onboarding samples. Existing IDs and
// vectors stay intact; logical sizes describe the combined teaching dataset.
const groups = [
  ['en', 'admin', 'How do administrators escalate Contoso Support v3 incidents?',
    'Administrators escalate v3 incidents through the Admin incident console.',
    'Attach the tenant diagnostic bundle and approve access before senior review.'],
  ['en', 'user', 'How do users escalate Contoso Support v3 incidents?',
    'Users escalate v3 incidents from My support tickets by requesting a review.',
    'Include the ticket number and impact summary; an administrator approves diagnostic access.'],
  ['de', 'admin', 'Wie eskalieren Administratoren Vorfaelle in Contoso Support v3?',
    'Administratoren eskalieren v3-Vorfaelle in der Admin-Incident-Konsole.',
    'Fuegen Sie das Mandanten-Diagnosepaket hinzu und genehmigen Sie den Zugriff vor der Pruefung.'],
  ['de', 'user', 'Wie eskalieren Benutzer Vorfaelle in Contoso Support v3?',
    'Benutzer fordern fuer v3-Vorfaelle unter Meine Supporttickets eine Pruefung an.',
    'Geben Sie Ticketnummer und Auswirkungen an; ein Administrator genehmigt den Diagnosezugriff.'],
]
const documents = [], chunks = [], questions = []
for (const [i, [language, audience, text, first, second]] of groups.entries()) {
  const id = 17 + i
  const metadata = { product: 'contoso-support', version: 'v3', language, audience, tags: ['escalation', 'training-only'] }
  documents.push({ id, product: metadata.product, version: metadata.version, language, metadata,
    body: `${first}\n\n${second}`, updated_at: '2026-01-05T09:00:00Z' })
  for (const [chunk_index, content] of [first, second].entries()) {
    chunks.push({ id: 33 + i * 2 + chunk_index, document_id: id, chunk_index, content,
      embedding: [0, 0, 0, 0, 1, 0.05 * (i + 1) + chunk_index * 0.01, 0, 0] })
  }
  questions.push({ text, product: metadata.product, version: metadata.version, language, audience,
    vector: [0, 0, 0, 0, 1, 0, 0, 0], expectedChunkIds: [33 + i * 2, 34 + i * 2], answer: first })
}
export const SUPPORT_V3_QUESTIONS = Object.freeze(questions)
export const SUPPORT_V3_CORPUS = Object.freeze({ version: 3, logicalRows: { ...CORPUS.logicalRows },
  documents: [...CORPUS.documents, ...documents], chunks: [...CORPUS.chunks, ...chunks] })
export const SUPPORT_V3_ALL_QUESTIONS = Object.freeze([...corpusQuestions(), ...questions])

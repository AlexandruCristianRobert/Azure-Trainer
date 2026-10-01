import { DATA_FIXTURES, embed } from './knowledge.js'

// Fictional training data. Return copies so a run never changes shared source data.
const clone = value => JSON.parse(JSON.stringify(value))
const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return Object.freeze(value)
}
export const REDIS_TARGET = freeze({ kind: 'redis', resourceGroup: 'rg-assistant', cluster: 'redis-assistant', database: 'default' })
const retention = 'How many days are Contoso Backup snapshots retained?'
const supportHours = "What are Contoso Support's on-call hours for critical incidents?"
const canonical = Object.entries(DATA_FIXTURES.questions)
const aliases = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`${canonical[i % 4][0]} [training alias ${String(i + 1).padStart(3, '0')}]`, { of: canonical[i % 4][0], vector: [...canonical[i % 4][1].vector] }]))
export const REDIS_FIXTURES = freeze({
  questions: clone(DATA_FIXTURES.questions), paraphrases: clone(DATA_FIXTURES.paraphrases), nearMisses: clone(DATA_FIXTURES.nearMisses), aliases,
  scopeVariants: [
    { question: retention, scope: { product: 'contoso-backup', version: 'v1', language: 'en' }, answer: DATA_FIXTURES.questions[retention].answer, nearMissAnswer: DATA_FIXTURES.nearMisses['How do I permanently delete a Contoso Backup snapshot before its retention period ends?'].answer },
    { question: retention, scope: { product: 'contoso-backup', version: 'v2', language: 'en' }, answer: 'Contoso Backup v2 snapshots are retained for 45 days by default.', nearMissAnswer: 'In Contoso Backup v2, request early snapshot deletion through the Backup Center approval workflow.' },
    { question: retention, scope: { product: 'contoso-backup', version: 'v1', language: 'de' }, answer: 'Contoso Backup v1 bewahrt Snapshots standardmaessig 35 Tage auf.', nearMissAnswer: 'Kontaktieren Sie Contoso Backup Support fuer eine vorzeitige Loeschung; Self-Service ist nicht verfuegbar.' },
    { question: retention, scope: { product: 'contoso-support', version: 'v1', language: 'en' }, answer: 'Contoso Support diagnostic snapshots are retained for 7 days by default.', nearMissAnswer: 'A Contoso Support case owner must approve early deletion of diagnostic snapshots.' },
  ],
})

const normalize = text => String(text).trim().toLowerCase().replace(/\s+/g, ' ')
const resolveText = (entries, question) => Object.keys(entries).find(text => normalize(text) === normalize(question))
export function redisEmbed(question, deployment = 'embeddings-v1') {
  if (!['embeddings-v1', 'embeddings-v2'].includes(deployment)) return null
  for (const entries of [REDIS_FIXTURES.questions, REDIS_FIXTURES.paraphrases, REDIS_FIXTURES.nearMisses, REDIS_FIXTURES.aliases]) {
    const text = resolveText(entries, question)
    if (text) return entries === REDIS_FIXTURES.aliases ? embed(entries[text].of, deployment) : embed(text, deployment)
  }
  return null
}

export function redisSourceAnswer(scope, question, revision = 1) {
  if (!scope || ![1, 2].includes(revision)) return null
  const text = resolveText(REDIS_FIXTURES.questions, question) ?? resolveText(REDIS_FIXTURES.paraphrases, question)
    ?? resolveText(REDIS_FIXTURES.nearMisses, question) ?? resolveText(REDIS_FIXTURES.aliases, question)
  if (!text) return null
  const canonicalText = REDIS_FIXTURES.paraphrases[text]?.of ?? REDIS_FIXTURES.aliases[text]?.of ?? REDIS_FIXTURES.nearMisses[text]?.near ?? text
  const base = REDIS_FIXTURES.questions[canonicalText]
  const variant = REDIS_FIXTURES.scopeVariants.find(entry => entry.question === canonicalText && ['product', 'version', 'language'].every(name => entry.scope[name] === scope[name]))
  const standardScope = scope.product === base.product && scope.version === 'v1' && scope.language === 'en'
  if (!variant && !standardScope) return null
  const nearMiss = REDIS_FIXTURES.nearMisses[text]
  let answer = nearMiss ? variant?.nearMissAnswer ?? nearMiss.answer : variant?.answer ?? base.answer
  if (revision === 2 && scope.product === 'contoso-backup' && scope.version === 'v1' && canonicalText === retention && !nearMiss) {
    answer = scope.language === 'de' ? 'Contoso Backup v1 bewahrt Snapshots standardmaessig 14 Tage auf.' : 'Contoso Backup snapshots are retained for 14 days by default.'
  }
  const sourceIds = nearMiss ? [`kb-${base.id}-near-miss`] : base.sourceIds
  const native = standardScope && !nearMiss
  return clone({ answer, scope: { product: scope.product, version: scope.version, language: scope.language }, sourceRevision: revision,
    sourceIds: sourceIds.map(id => native ? id : `${id}:${scope.product}:${scope.version}:${scope.language}`) })
}

const backup = { product: 'contoso-backup', version: 'v1', language: 'en' }
const support = { product: 'contoso-support', version: 'v1', language: 'en' }
const request = (question, scope = backup, route = 'GET /cached') => ({ action: 'request', route, args: { question, ...scope, ...(route === 'GET /cached' ? { ttl: 60 } : {}) } })
// Primitive steps; deployment targets and grading evidence are supplied by each Lab.
export const REDIS_WORKLOADS = freeze({
  'cache-baseline': { steps: [request(retention), request(retention)] },
  'cache-expiry': { steps: [request(retention), { action: 'advance', seconds: 61 }, request(retention)] },
  'cache-freshness': { steps: [request(retention), request(supportHours, support), { action: 'source-update', product: 'contoso-backup', revision: 2 }, { action: 'request', route: 'POST /invalidate', args: { product: 'contoso-backup' } }, request(retention), request(supportHours, support)] },
  'cache-scopes': { steps: REDIS_FIXTURES.scopeVariants.map(entry => request(entry.question, entry.scope)) },
  'cache-semantic': { steps: [request(retention, backup, 'GET /answer'), request('How long does Contoso Backup keep my snapshots?', backup, 'GET /answer'), request('How do I permanently delete a Contoso Backup snapshot before its retention period ends?', backup, 'GET /answer')] },
})

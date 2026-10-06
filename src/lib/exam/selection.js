import { ExamError, EXAM_DOMAINS, EXAM_KINDS, EXAM_LIMITS, finiteJson, record, integer, member, requireExam, uniqueIds, uniqueRecords, stableId, text, validateReference } from './contracts.js'
import { validateQuestion, candidateIds } from './question.js'

const QUOTAS = { 40: [9, 11, 10, 10], 50: [12, 14, 12, 12], 60: [14, 16, 15, 15] }
const copy = value => structuredClone(value)
const bit = q => 1 << EXAM_KINDS.indexOf(q.kind)
const unsatisfiable = () => { throw new ExamError('The bank cannot satisfy the requested blueprint', 'BANK_UNSATISFIABLE') }
// Sort by stable ID before drawing: source-file/import ordering cannot alter a seed.
function shuffle(values, random) {
  const output = [...values].sort((a, b) => (a.id ?? a) < (b.id ?? b) ? -1 : (a.id ?? a) > (b.id ?? b) ? 1 : 0)
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [output[i], output[j]] = [output[j], output[i]] }
  return output
}
function randomFor(seed) {
  integer(seed, 0, 4294967295)
  let state = seed
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
}
function validateBank(bank) {
  finiteJson(bank); record(bank, ['version', 'revision', 'questions', 'groups', 'references'])
  member(bank.version, [1]); integer(bank.revision, 1)
  requireExam(Array.isArray(bank.questions) && bank.questions.length <= 120, 'Invalid bank question pool')
  bank.questions.forEach(q => validateQuestion(q)); uniqueRecords(bank.questions)
  requireExam(Array.isArray(bank.references) && bank.references.length <= 3840, 'Invalid bank references')
  bank.references.forEach(validateReference); uniqueRecords(bank.references)
  requireExam(Array.isArray(bank.groups) && bank.groups.length <= 40, 'Invalid bank groups')
  for (const g of bank.groups) {
    record(g, ['id', 'kind', 'domain', 'title', 'background', 'questionIds'])
    stableId(g.id); member(g.kind, ['case', 'series']); member(g.domain, EXAM_DOMAINS); text(g.title, 1024); text(g.background, EXAM_LIMITS.caseBytes)
    uniqueIds(g.questionIds, 3, bank.questions.map(q => q.id), 3)
    requireExam(g.questionIds.every(id => bank.questions.some(q => q.id === id && q.groupId === g.id && q.domain === g.domain)), 'Invalid group members')
  }
  uniqueRecords(bank.groups)
  requireExam(bank.questions.every(q => (q.groupId === null || bank.groups.some(g => g.id === q.groupId && g.questionIds.includes(q.id))) && q.referenceIds.every(id => bank.references.some(r => r.id === id))), 'Missing group or reference')
}
function filtersWithDefaults(filters) {
  finiteJson(filters)
  requireExam(filters && typeof filters === 'object' && !Array.isArray(filters), 'Invalid Study filters')
  requireExam(Object.keys(filters).every(k => ['domains', 'kinds', 'conceptIds'].includes(k)), 'Unknown Study filter')
  const result = { domains: filters.domains ?? [...EXAM_DOMAINS], kinds: filters.kinds ?? [...EXAM_KINDS], conceptIds: filters.conceptIds ?? [] }
  uniqueIds(result.domains, 4, EXAM_DOMAINS, 1); uniqueIds(result.kinds, 8, EXAM_KINDS, 1); uniqueIds(result.conceptIds, 720)
  return result
}
function deckFor(bank, selected, groups, random) {
  const sections = [], standalone = selected.filter(q => q.groupId === null)
  if (standalone.length) sections.push({ id: 'standalone', kind: 'standalone', questionIds: standalone.map(q => q.id), sealed: false })
  for (const [index, g] of groups.entries()) sections.push({ id: `group:${index + 1}`, kind: g.kind, questionIds: [...g.questionIds], sealed: false })
  const order = sections.flatMap(s => s.questionIds)
  const questions = order.map(id => selected.find(q => q.id === id))
  const referenceIds = new Set(questions.flatMap(q => q.referenceIds))
  return copy({ questions, groups, references: bank.references.filter(r => referenceIds.has(r.id)).sort((a, b) => a.id < b.id ? -1 : 1), order, sections,
    optionOrders: Object.fromEntries(questions.map(q => [q.id, shuffle(candidateIds(q), random)])) })
}
// Memoized count/kind states are equivalent for future choices within a domain.
// At most (quota + 1) * 256 states per domain; no greedy quota relaxation.
function domainChoices(pool, count) {
  if (count < 0 || pool.length < count) return new Map()
  const states = Array.from({ length: count + 1 }, () => new Map())
  states[0].set(0, [])
  for (const q of pool) {
    for (let n = count; n > 0; n--) for (const [mask, chosen] of states[n - 1]) {
      const next = mask | bit(q)
      if (!states[n].has(next)) states[n].set(next, [...chosen, q])
    }
  }
  return states[count]
}
export function drawMock(bank, settings = {}, seed = 0) {
  validateBank(bank); finiteJson(settings)
  requireExam(settings && typeof settings === 'object' && !Array.isArray(settings), 'Invalid Mock settings')
  requireExam(Object.keys(settings).every(k => ['size', 'durationMinutes', 'practiceGoal', 'domains', 'kinds', 'conceptIds'].includes(k)), 'Unknown Mock setting')
  if (Object.hasOwn(settings, 'durationMinutes')) member(settings.durationMinutes, [60, 100, 120])
  if (Object.hasOwn(settings, 'practiceGoal')) integer(settings.practiceGoal, 1, 100)
  for (const [key, expected] of [['domains', EXAM_DOMAINS], ['kinds', EXAM_KINDS], ['conceptIds', []]]) {
    if (Object.hasOwn(settings, key)) requireExam(Array.isArray(settings[key]) && settings[key].length === expected.length && new Set(settings[key]).size === expected.length && expected.every(v => settings[key].includes(v)), 'Mock cannot use adaptive filters')
  }
  const size = settings.size ?? 50; member(size, [40, 50, 60])
  const random = randomFor(seed), cases = shuffle(bank.groups.filter(g => g.kind === 'case'), random), series = shuffle(bank.groups.filter(g => g.kind === 'series'), random)
  const pool = shuffle(bank.questions.filter(q => q.groupId === null), random), cache = new Map()
  for (let a = 0; a < cases.length; a++) for (let b = a + 1; b < cases.length; b++) for (const s of series) {
    const groups = [cases[a], cases[b], s], reserved = groups.flatMap(g => g.questionIds.map(id => bank.questions.find(q => q.id === id)))
    const remaining = QUOTAS[size].map((n, i) => n - reserved.filter(q => q.domain === EXAM_DOMAINS[i]).length)
    if (remaining.some(n => n < 0)) continue
    let states = new Map([[reserved.reduce((mask, q) => mask | bit(q), 0), []]])
    for (let d = 0; d < EXAM_DOMAINS.length; d++) {
      const key = `${d}:${remaining[d]}`
      if (!cache.has(key)) cache.set(key, domainChoices(pool.filter(q => q.domain === EXAM_DOMAINS[d]), remaining[d]))
      const next = new Map()
      for (const [mask, chosen] of states) for (const [extra, candidates] of cache.get(key)) {
        const combined = mask | extra
        if (!next.has(combined)) next.set(combined, [...chosen, ...candidates])
      }
      states = next
    }
    if (!states.has(255)) continue
    const selected = [...shuffle(states.get(255), random), ...reserved]
    requireExam(selected.length === size && new Set(selected.map(q => q.id)).size === size && QUOTAS[size].every((n, d) => selected.filter(q => q.domain === EXAM_DOMAINS[d]).length === n) && selected.reduce((mask, q) => mask | bit(q), 0) === 255, 'Invalid constrained draw')
    return deckFor(bank, selected, groups, random)
  }
  return unsatisfiable()
}
export function drawStudy(bank, filters = {}, requestedSize = 10, seed = 0, options = {}) {
  validateBank(bank); member(requestedSize, [5, 10, 20])
  finiteJson(options)
  requireExam(options && typeof options === 'object' && !Array.isArray(options), 'Invalid Study draw options')
  record(options, Object.hasOwn(options, 'preferredQuestionIds') ? ['preferredQuestionIds'] : [])
  const preferredQuestionIds = Object.hasOwn(options, 'preferredQuestionIds') ? options.preferredQuestionIds : []
  uniqueIds(preferredQuestionIds, bank.questions.length, bank.questions.map(q => q.id))
  const preferred = new Set(preferredQuestionIds)
  const chosenFilters = filtersWithDefaults(filters), random = randomFor(seed)
  const eligible = bank.questions.filter(q => chosenFilters.domains.includes(q.domain) && chosenFilters.kinds.includes(q.kind) && (!chosenFilters.conceptIds.length || q.components.some(c => chosenFilters.conceptIds.includes(c.conceptId))))
  const selected = [
    ...shuffle(eligible.filter(q => preferred.has(q.id)), random),
    ...shuffle(eligible.filter(q => !preferred.has(q.id)), random),
  ].slice(0, requestedSize), ids = new Set(selected.map(q => q.id))
  const groupIds = [...new Set(selected.filter(q => q.groupId !== null).map(q => q.groupId))]
  const groups = groupIds.map(id => { const g = bank.groups.find(g => g.id === id); return { ...g, questionIds: g.questionIds.filter(qid => ids.has(qid)) } })
  return { ...deckFor(bank, selected, groups, random), available: eligible.length, requestedSize, actualSize: selected.length, requiresConsent: selected.length < requestedSize }
}

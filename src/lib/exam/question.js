import { EXAM_DOMAINS, EXAM_KINDS, EXAM_LIMITS, requireExam, finiteJson, record, text, stableId, integer, member, arrayOf, uniqueIds, uniqueRecords, sameIds } from './contracts.js'

const publicFields = ['id', 'revision', 'familyId', 'kind', 'domain', 'objectiveId', 'difficulty', 'stem', 'artifacts', 'presentation', 'components', 'groupId']
const privateFields = ['explanation', 'referenceIds', 'csharp']
const componentFields = ['id', 'conceptId', 'points', 'input', 'requiredCount', 'candidateIds']
const singleKinds = ['single-choice', 'multiple-response', 'hot-area']
const setKinds = ['multiple-response', 'hot-area']
const clone = (value) => JSON.parse(JSON.stringify(value))

// Call only after validation when consuming arbitrary input.
export function candidateIds(q) {
  const p = q.presentation
  return (p.choices ?? p.candidates ?? p.regions).map((c) => c.id)
}
function catalogue(values, region = false) {
  arrayOf(values, EXAM_LIMITS.candidates, (v) => {
    record(v, region ? ['id', 'label', 'x', 'y', 'width', 'height'] : ['id', 'label']); stableId(v.id); text(v.label)
    if (region) {
      for (const key of ['x', 'y', 'width', 'height']) requireExam(typeof v[key] === 'number' && v[key] >= 0 && v[key] <= 1, 'Region geometry must be normalized')
      requireExam(v.width > 0 && v.height > 0 && v.x + v.width <= 1 && v.y + v.height <= 1, 'Region exceeds diagram bounds')
    }
  }, 1); uniqueRecords(values)
}
function bindings(values, components, segment = false) {
  arrayOf(values, EXAM_LIMITS.components, (v) => {
    record(v, segment ? ['type', 'componentId', 'label'] : ['componentId', 'label']); stableId(v.componentId); text(v.label)
  }, 1)
  requireExam(values.length === components.length && values.every((v, i) => v.componentId === components[i].id), 'Presentation bindings must follow declared component order')
}
function presentation(q) {
  const p = q.presentation, c = q.components
  switch (q.kind) {
    case 'single-choice': case 'multiple-response':
      record(p, ['choices']); catalogue(p.choices); break
    case 'build-list':
      record(p, ['candidates', 'slots']); catalogue(p.candidates); bindings(p.slots, c); break
    case 'matching':
      record(p, ['candidates', 'targets', 'allowReuse']); catalogue(p.candidates); bindings(p.targets, c); requireExam(typeof p.allowReuse === 'boolean', 'Matching must declare reuse policy'); break
    case 'dropdown':
      record(p, ['candidates', 'segments']); catalogue(p.candidates)
      arrayOf(p.segments, 128, (s) => {
        member(s?.type, ['text', 'slot'])
        if (s.type === 'text') { record(s, ['type', 'text']); text(s.text, EXAM_LIMITS.questionBytes, true) }
        else { record(s, ['type', 'componentId', 'label']); stableId(s.componentId); text(s.label) }
      }, 1)
      bindings(p.segments.filter((s) => s.type === 'slot'), c, true); break
    case 'statement-grid':
      record(p, ['choices', 'rows']); catalogue(p.choices); bindings(p.rows, c); sameIds(p.choices.map((v) => v.id), ['yes', 'no']); break
    case 'hot-area':
      record(p, ['label', 'regions']); text(p.label); catalogue(p.regions, true); break
    case 'active-screen':
      record(p, ['title', 'candidates', 'fields']); text(p.title); catalogue(p.candidates); bindings(p.fields, c); break
  }
  const candidates = candidateIds(q)
  for (const component of c) {
    requireExam(component.candidateIds.every((id) => candidates.includes(id)), 'Component refers to a missing candidate')
    if (!['dropdown', 'active-screen'].includes(q.kind)) sameIds(component.candidateIds, candidates)
  }
  requireExam(candidates.every((id) => c.some((component) => component.candidateIds.includes(id))), 'Unused presentation candidate')
}
function explanation(q) {
  if (q.components.length === 1 && typeof q.explanation === 'string') { text(q.explanation); return }
  record(q.explanation, ['components'])
  arrayOf(q.explanation.components, EXAM_LIMITS.components, (entry, i) => {
    record(entry, ['componentId', 'text', 'candidates']); const c = q.components[i]
    requireExam(c && entry.componentId === c.id, 'Explanation component order mismatch'); text(entry.text)
    arrayOf(entry.candidates, EXAM_LIMITS.candidates, (reason) => { record(reason, ['candidateId', 'text']); stableId(reason.candidateId); text(reason.text) }, 1)
    const ids = entry.candidates.map((reason) => reason.candidateId); uniqueIds(ids); sameIds(ids, c.candidateIds)
  }, 1)
  requireExam(q.explanation.components.length === q.components.length, 'Missing component explanation')
}
function question(value, historical, view) {
  finiteJson(value, EXAM_LIMITS.questionBytes)
  record(value, view ? publicFields : [...publicFields, ...privateFields])
  stableId(value.id); integer(value.revision, 1); stableId(value.familyId); member(value.kind, EXAM_KINDS)
  if (historical) stableId(value.domain); else member(value.domain, EXAM_DOMAINS)
  stableId(value.objectiveId); member(value.difficulty, ['easy', 'medium', 'hard']); text(value.stem)
  if (value.groupId !== null) stableId(value.groupId)
  arrayOf(value.artifacts, 32, (a) => {
    record(a, ['id', 'kind', 'language', 'text']); stableId(a.id); member(a.kind, ['text', 'code']); text(a.text)
    if (a.kind === 'text') requireExam(a.language === null, 'Text artifact has no language'); else { if (a.language !== null) stableId(a.language) }
  }); uniqueRecords(value.artifacts)
  arrayOf(value.components, EXAM_LIMITS.components, (c) => {
    record(c, view ? componentFields : [...componentFields, 'expected']); stableId(c.id); stableId(c.conceptId); member(c.points, [1]); member(c.input, ['one', 'set'])
    requireExam(c.input === (setKinds.includes(value.kind) ? 'set' : 'one'), 'Component input does not match widget')
    uniqueIds(c.candidateIds, EXAM_LIMITS.candidates, null, 1)
    if (c.input === 'one') requireExam(c.requiredCount === null, 'Single answers have no set count')
    else if (c.requiredCount !== null) integer(c.requiredCount, 1, c.candidateIds.length)
    if (!view) {
      if (c.input === 'one') member(c.expected, c.candidateIds)
      else {
        uniqueIds(c.expected, EXAM_LIMITS.candidates, c.candidateIds, 1)
        requireExam(c.requiredCount === null || c.requiredCount === c.expected.length, 'Expected set must match required count')
      }
    }
  }, 1); uniqueRecords(value.components)
  if (singleKinds.includes(value.kind)) requireExam(value.components.length === 1, 'This widget has one scoring component')
  presentation(value)
  if (!view) {
    if (value.kind === 'build-list' || (value.kind === 'matching' && !value.presentation.allowReuse)) requireExam(new Set(value.components.map((c) => c.expected)).size === value.components.length, 'Expected answers violate reuse policy')
    explanation(value); uniqueIds(value.referenceIds, 32, null, 1); if (value.csharp !== null) text(value.csharp)
  }
  return value
}
export function validateQuestion(q, { historical = false } = {}) { return question(q, historical, false) }
export function validateQuestionView(view) { return question(view, true, true) }
function fullOrView(q) {
  // Descriptor scan precedes even selecting the shape, so accessors cannot influence it.
  finiteJson(q, EXAM_LIMITS.questionBytes)
  requireExam(q !== null && typeof q === 'object' && !Array.isArray(q), 'Expected a question record')
  return Object.hasOwn(q, 'explanation') ? validateQuestion(q, { historical: true }) : validateQuestionView(q)
}
export function validateAnswer(qOrView, answer) {
  const q = fullOrView(qOrView)
  finiteJson(answer, EXAM_LIMITS.questionBytes)
  requireExam(answer !== null && typeof answer === 'object' && !Array.isArray(answer), 'Expected an answer record')
  for (const [id, value] of Object.entries(answer)) {
    const c = q.components.find((item) => item.id === id); requireExam(c, 'Unknown answer component')
    if (c.input === 'one') member(value, c.candidateIds)
    else uniqueIds(value, EXAM_LIMITS.candidates, c.candidateIds)
  }
  if (q.kind === 'build-list' || (q.kind === 'matching' && !q.presentation.allowReuse)) requireExam(new Set(Object.values(answer)).size === Object.values(answer).length, 'Candidate reuse is not allowed')
  return answer
}
export function publicQuestion(q, { feedback = false } = {}) {
  requireExam(typeof feedback === 'boolean', 'Feedback permission must be an explicit boolean')
  validateQuestion(q, { historical: true })
  const result = clone(q)
  if (!feedback) { for (const key of privateFields) delete result[key]; for (const c of result.components) delete c.expected }
  return result
}
export function applyAnswerEdit(qOrView, answer, edit) {
  const q = fullOrView(qOrView); validateAnswer(q, answer); finiteJson(edit, 2048)
  member(edit?.type, ['set', 'toggle', 'assign', 'remove', 'move'])
  const extra = { set: 'value', toggle: 'candidateId', assign: 'candidateId', move: 'toComponentId' }[edit.type]
  record(edit, ['type', 'componentId', ...(extra ? [extra] : [])])
  const index = q.components.findIndex((c) => c.id === edit.componentId), c = q.components[index]; requireExam(c, 'Unknown edit component')
  const next = clone(answer)
  switch (edit.type) {
    case 'set': next[c.id] = clone(edit.value); break
    case 'assign': requireExam(c.input === 'one', 'Assign requires a single-choice component'); member(edit.candidateId, c.candidateIds); next[c.id] = edit.candidateId; break
    case 'toggle': {
      requireExam(c.input === 'set', 'Toggle requires a set component'); member(edit.candidateId, c.candidateIds)
      const values = Object.hasOwn(next, c.id) ? next[c.id] : []; next[c.id] = values.includes(edit.candidateId) ? values.filter((id) => id !== edit.candidateId) : [...values, edit.candidateId]; break
    }
    case 'remove': delete next[c.id]; break
    case 'move': {
      requireExam(q.kind === 'build-list', 'Move requires a build list')
      const to = q.components.findIndex((component) => component.id === edit.toComponentId); requireExam(to >= 0, 'Unknown destination slot')
      const values = q.components.map((component) => Object.hasOwn(next, component.id) ? next[component.id] : undefined); const [moved] = values.splice(index, 1); values.splice(to, 0, moved)
      q.components.forEach((component, i) => { if (values[i] === undefined) delete next[component.id]; else next[component.id] = values[i] }); break
    }
  }
  validateAnswer(q, next)
  return next
}

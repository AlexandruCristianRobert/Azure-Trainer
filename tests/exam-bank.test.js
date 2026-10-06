import { describe, it, expect } from 'vitest'
import { gradeQuestion } from '../src/lib/exam/grading.js'
import { EXAM_CONCEPTS } from '../src/data/exam/concepts.js'

const banks = import.meta.glob('../src/data/exam/bank/*.js', { eager: true })
const validators = import.meta.glob('../src/lib/exam/bankValidation.js', { eager: true })
const { CONTAINERS_QUESTIONS, CONTAINERS_GROUPS, CONTAINERS_REFERENCES } = banks['../src/data/exam/bank/containers.js'] || {}
const { validateDomainContent } = validators['../src/lib/exam/bankValidation.js'] || {}
const content = () => structuredClone({ questions: CONTAINERS_QUESTIONS, groups: CONTAINERS_GROUPS, references: CONTAINERS_REFERENCES })
const ready = () => { expect(validateDomainContent).toBeTypeOf('function'); expect(CONTAINERS_QUESTIONS).toBeInstanceOf(Array) }
// Hand-checked author keys, independent literal expectations in component order.
const containerKeys = [
  ['digest'],['build'],['port'],['ready'],['multiple'],['events'],
  [['role','select']],[['commit','base']],[['settings','logs']],[['min','max']],
  ['build','record','handoff'],['create','run','logs'],['enable','grant','use'],['save','apply','inspect'],
  ['deployment','service'],['readiness','liveness','startup'],['build','run','logs'],['console','system'],
  ['multiple','r2'],['zero','four'],['api','p8080'],['no','yes','yes'],['yes','no'],
  [['selector']],[['min','max']],['production','secret'],['hour','off','off'],
]

describe('containers bank', () => {
  it('exports the complete original domain and first validator', () => {
    ready()
    expect(CONTAINERS_QUESTIONS).toHaveLength(27)
    expect(CONTAINERS_GROUPS).toBeInstanceOf(Array)
    expect(CONTAINERS_REFERENCES).toBeInstanceOf(Array)
    expect(validateDomainContent(content(), 'containers')).toBe(true)
  })
  it('pins all fixed IDs and widget allocations independently of validator output', () => {
    ready()
    const kinds = ['single-choice','multiple-response','build-list','matching','dropdown','statement-grid','hot-area','active-screen']
    const counts = [6,4,4,4,3,2,2,2]
    expect(CONTAINERS_QUESTIONS.map(q => q.id)).toEqual(Array.from({ length: 27 }, (_, i) => `ai200-c${String(i + 1).padStart(3, '0')}`))
    expect(CONTAINERS_QUESTIONS.map(q => q.kind)).toEqual(kinds.flatMap((kind, i) => Array(counts[i]).fill(kind)))
    expect(CONTAINERS_GROUPS.map(g => [g.id,g.kind,g.questionIds])).toEqual([['case-c1','case',['ai200-c019','ai200-c022','ai200-c026']]])
  })
  it('resolves every authored concept and gives full credit to legal answer keys', () => {
    ready()
    const refs = CONTAINERS_REFERENCES.map(r => r.id)
    for (const c of EXAM_CONCEPTS.filter(c => c.objectiveId.startsWith('containers.'))) expect(c.referenceIds.every(id => refs.includes(id))).toBe(true)
    for (const [i,q] of CONTAINERS_QUESTIONS.entries()) {
      expect(q.components.map(c => c.expected)).toEqual(containerKeys[i])
      const result = gradeQuestion(q, Object.fromEntries(q.components.map((c,j) => [c.id,containerKeys[i][j]])))
      expect(result.earned).toBe(q.components.length)
      expect(q.referenceIds.every(id => refs.includes(id))).toBe(true)
    }
    for (const id of ['containers.registry-automation','containers.appservice-hosting']) {
      const c = EXAM_CONCEPTS.find(c => c.id === id)
      expect(c.labIds).toEqual([]); expect(c.taskIds).toEqual([])
    }
  })
  it.each([
    ['missing item', c => c.questions.pop()],
    ['duplicate question ID', c => { c.questions[1].id = c.questions[0].id }],
    ['wrong fixed kind', c => { c.questions[0].kind = 'matching' }],
    ['schema-valid wrong fixed kind', c => { c.questions[0] = { ...structuredClone(c.questions[14]), id:'ai200-c001',familyId:'ai200-c001' } }],
    ['question order mismatch', c => { [c.questions[0],c.questions[1]] = [c.questions[1],c.questions[0]] }],
    ['noninitial revision', c => { c.questions[0].revision = 2 }],
    ['wrong ID prefix', c => { c.questions[0].id = 'ai200-d001' }],
    ['unknown objective', c => { c.questions[0].objectiveId = 'containers.unknown' }],
    ['concept from another objective', c => { c.questions[0].components[0].conceptId = 'containers.scale-signals' }],
    ['missing canonical reference', c => { c.references = c.references.filter(r => r.id !== 'ref-containers.appservice-container') }],
    ['missing question reference', c => { c.questions[0].referenceIds = ['missing'] }],
    ['malicious reference', c => { c.references[0].url = 'https://learn.microsoft.com.evil.example/steal' }],
    ['credential URL', c => { c.references[0].url = 'https://user:pass@learn.microsoft.com/en-us/azure/' }],
    ['invalid reference date', c => { c.references[0].reviewedAt = '2026-02-30' }],
    ['invalid answer key', c => { c.questions[0].components[0].expected = 'unknown' }],
    ['extra DTO field', c => { c.questions[0].html = '<script>bad()</script>' }],
    ['wrong case membership', c => { c.groups[0].questionIds[0] = 'ai200-c020' }],
    ['missing reciprocal membership', c => { c.questions[18].groupId = null }],
    ['two-member group', c => { c.groups[0].questionIds.pop() }],
    ['foreign group domain', c => { c.groups[0].domain = 'data' }],
    ['wrong fixed group kind', c => { c.groups[0].kind = 'series' }],
    ['group member order mismatch', c => { c.groups[0].questionIds.reverse() }],
    ['orphan grouped question', c => { c.questions[0].groupId = 'case-c1' }],
    ['missing objective coverage', c => {
      c.questions.filter(q => q.objectiveId === 'containers.registry-images').forEach(q => {
        q.objectiveId = 'containers.registry-tasks'; q.components.forEach(part => { part.conceptId = 'containers.registry-automation' })
      })
    }],
    ['duplicate reference', c => { c.references.push(c.references[0]) }],
    ['duplicate group', c => { c.groups.push(c.groups[0]) }],
  ])('rejects %s', (_, corrupt) => {
    ready(); const c = content(); corrupt(c)
    expect(() => validateDomainContent(c, 'containers')).toThrow()
  })
  it('rejects accessors without executing them and preserves accepted content', () => {
    ready(); const c = content(), before = structuredClone(c)
    expect(validateDomainContent(c, 'containers')).toBe(true); expect(c).toEqual(before)
    let accessed = false
    Object.defineProperty(c.questions[0], 'stem', { enumerable: true, get() { accessed = true; return 'bad' } })
    expect(() => validateDomainContent(c, 'containers')).toThrow(); expect(accessed).toBe(false)
  })
})

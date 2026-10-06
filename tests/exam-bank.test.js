import { describe, it, expect } from 'vitest'
import { gradeQuestion } from '../src/lib/exam/grading.js'
import { EXAM_CONCEPTS } from '../src/data/exam/concepts.js'
import * as examData from '../src/data/exam/index.js'
import { LABS } from '../src/data/labs/index.js'
import { drawMock } from '../src/lib/exam/selection.js'
import { ExamError } from '../src/lib/exam/contracts.js'

const banks = import.meta.glob('../src/data/exam/bank/*.js', { eager: true })
const validators = import.meta.glob('../src/lib/exam/bankValidation.js', { eager: true })
const { CONTAINERS_QUESTIONS, CONTAINERS_GROUPS, CONTAINERS_REFERENCES } = banks['../src/data/exam/bank/containers.js'] || {}
const { validateDomainContent } = validators['../src/lib/exam/bankValidation.js'] || {}
const { validateExamBank, bankCoverage } = validators['../src/lib/exam/bankValidation.js'] || {}
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
  it('shares the containers replica-bound family across equivalent widgets without removing questions', () => {
    ready()
    expect(CONTAINERS_QUESTIONS).toHaveLength(27)
    expect(CONTAINERS_QUESTIONS.find(q => q.id === 'ai200-c010').familyId).toBe('ai200-c010')
    expect(CONTAINERS_QUESTIONS.find(q => q.id === 'ai200-c025').familyId).toBe('ai200-c010')
    expect(new Set(CONTAINERS_QUESTIONS.map(q => q.familyId)).size).toBe(26)
    expect(CONTAINERS_QUESTIONS.filter(q => q.id !== 'ai200-c025').every(q => q.familyId === q.id)).toBe(true)
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

const { DATA_QUESTIONS, DATA_GROUPS, DATA_REFERENCES } = banks['../src/data/exam/bank/data.js'] || {}
const dataContent = () => structuredClone({ questions: DATA_QUESTIONS, groups: DATA_GROUPS, references: DATA_REFERENCES })
const dataKeys = [
  ['point'],['session'],['params'],['cosine'],['invalidate'],['transaction'],
  [['dimension','metric']],[['cpu','memory']],[['exclude','measure']],[['filter','vector']],[['idempotent','leases']],[['expiry','delete']],
  ['extension','table','insert'],['begin','query','commit'],['read','cost','compare'],['miss','source','store'],['baseline','ann','recall'],
  ['btree','gin'],['history','cache'],['l2','cosine','negative'],['app','server'],
  ['tenant','distance'],['bound','literal'],['path','size'],['tag','knn'],['limit','headroom'],
  ['yes','no'],['yes','no'],['no','yes'],[['filter','order']],[['ttl','invalidate']],['latest','idempotent'],['memory','compute'],
]

const { CONNECT_QUESTIONS, CONNECT_GROUPS, CONNECT_REFERENCES } = banks['../src/data/exam/bank/connect.js'] || {}
const connectContent = () => structuredClone({ questions: CONNECT_QUESTIONS, groups: CONNECT_GROUPS, references: CONNECT_REFERENCES })
// Hand-derived keys: changing a settlement/filter/API decision must fail grading.
const connectKeys = [
  ['no'],['yes'],['no'],['property'],['json'],['azure'],
  [['complete','abandon']],[['retry','idempotent']],[['north','priority']],[['parse','schema']],[['requirements','settings']],
  ['receive','commit','complete'],['validate','send','respond'],['declare','publish','probe'],['destination','subscribe','test'],
  ['complete','abandon','deadletter'],['retry','deadletter','exclude'],['query','route','body'],['host','azure','local'],
  ['type','subject'],['property','literal'],['route','post'],['python','v4'],
  ['yes','no','yes'],['no','yes'],['no','yes'],[['billing','warehouse']],[['invalid','missing']],
  ['topic','subscription','connection'],['schema','bundle'],
]

describe('connect bank', () => {
  it('exports 30 allocated items with the fixed ordered series and continuing case', () => {
    expect(CONNECT_QUESTIONS).toBeInstanceOf(Array)
    expect(CONNECT_QUESTIONS).toHaveLength(30)
    expect(validateDomainContent(connectContent(), 'connect')).toBe(true)
    expect(CONNECT_QUESTIONS.map(q => q.id)).toEqual(Array.from({ length: 30 }, (_, i) => `ai200-x${String(i+1).padStart(3,'0')}`))
    expect(CONNECT_QUESTIONS.map(q => q.kind)).toEqual(['single-choice','multiple-response','build-list','matching','dropdown','statement-grid','hot-area','active-screen'].flatMap((kind,i) => Array([6,5,4,4,4,3,2,2][i]).fill(kind)))
    expect(CONNECT_GROUPS.map(g => [g.id,g.kind,g.questionIds])).toEqual([
      ['series-x1','series',['ai200-x001','ai200-x002','ai200-x003']],
      ['case-x1','case',['ai200-x009','ai200-x020','ai200-x029']],
    ])
    expect(new Set(CONNECT_QUESTIONS.map(q => q.objectiveId)).size).toBe(4)
  })
  it('grades all hand-checked connect keys and resolves canonical source IDs', () => {
    expect(CONNECT_QUESTIONS).toBeInstanceOf(Array)
    const refs = CONNECT_REFERENCES.map(r => r.id)
    for (const c of EXAM_CONCEPTS.filter(c => c.objectiveId.startsWith('connect.'))) expect(c.referenceIds.every(id => refs.includes(id))).toBe(true)
    for (const [i,q] of CONNECT_QUESTIONS.entries()) {
      expect(q.components.map(c => c.expected)).toEqual(connectKeys[i])
      const answer = Object.fromEntries(q.components.map((c,j) => [c.id,connectKeys[i][j]]))
      expect(gradeQuestion(q, answer).earned).toBe(q.components.length)
      expect(q.referenceIds.every(id => refs.includes(id))).toBe(true)
      expect(q.components.every(c => c.points === 1)).toBe(true)
    }
    expect(CONNECT_QUESTIONS.slice(0,3).map(q => q.presentation.choices.map(c => c.id))).toEqual([['yes','no'],['yes','no'],['yes','no']])
  })
  it('shares families for equivalent settlement, filtering and configuration widgets', () => {
    expect(CONNECT_QUESTIONS).toBeInstanceOf(Array)
    const families = Object.fromEntries(CONNECT_QUESTIONS.map(q => [q.id,q.familyId]))
    for (const [member,original] of [[2,1],[3,1],[12,7],[13,10],[16,7],[18,5],[20,9],[21,4],[24,7],[25,8],[26,10],[27,4],[28,10],[29,11],[30,11],[19,6],[23,6]]) {
      expect(families[`ai200-x${String(member).padStart(3,'0')}`]).toBe(`ai200-x${String(original).padStart(3,'0')}`)
    }
    expect(new Set(CONNECT_QUESTIONS.map(q => q.familyId)).size).toBe(13)
  })
})
describe('data bank', () => {
  it('exports all 33 allocated original items and validates all 12 objectives', () => {
    expect(DATA_QUESTIONS).toBeInstanceOf(Array)
    expect(DATA_QUESTIONS).toHaveLength(33)
    expect(validateDomainContent(dataContent(), 'data')).toBe(true)
    expect(new Set(DATA_QUESTIONS.map(q => q.objectiveId)).size).toBe(12)
    expect(DATA_QUESTIONS.map(q => q.id)).toEqual(Array.from({ length: 33 }, (_, i) => `ai200-d${String(i+1).padStart(3,'0')}`))
    expect(DATA_QUESTIONS.map(q => q.kind)).toEqual(['single-choice','multiple-response','build-list','matching','dropdown','statement-grid','hot-area','active-screen'].flatMap((kind,i) => Array([6,6,5,4,5,3,2,2][i]).fill(kind)))
    expect(DATA_GROUPS.map(g => [g.id,g.questionIds])).toEqual([
      ['case-d1',['ai200-d004','ai200-d022','ai200-d030']], ['case-d2',['ai200-d009','ai200-d019','ai200-d032']],
    ])
  })
  it('grades hand-checked literal data keys and resolves canonical references', () => {
    expect(DATA_QUESTIONS).toBeInstanceOf(Array)
    const refs = DATA_REFERENCES.map(r => r.id)
    for (const c of EXAM_CONCEPTS.filter(c => c.objectiveId.startsWith('data.'))) expect(c.referenceIds.every(id => refs.includes(id))).toBe(true)
    for (const [i,q] of DATA_QUESTIONS.entries()) {
      expect(q.components.map(c => c.expected)).toEqual(dataKeys[i])
      expect(gradeQuestion(q, Object.fromEntries(q.components.map((c,j) => [c.id,dataKeys[i][j]]))).earned).toBe(q.components.length)
    }
  })
  it('prevents equivalent data widgets from multiplying fresh family evidence', () => {
    expect(DATA_QUESTIONS).toBeInstanceOf(Array)
    const families = Object.fromEntries(DATA_QUESTIONS.map(q => [q.id,q.familyId]))
    for (const [member,original] of [[12,5],[20,4],[21,6],[22,4],[23,3],[24,7],[25,10],[27,11],[28,5],[30,4],[31,5],[32,11],[33,8]]) {
      expect(families[`ai200-d${String(member).padStart(3,'0')}`]).toBe(`ai200-d${String(original).padStart(3,'0')}`)
    }
  })
})

const { SECURE_QUESTIONS, SECURE_GROUPS, SECURE_REFERENCES } = banks['../src/data/exam/bank/secure.js'] || {}
const { EXAM_BANK } = banks['../src/data/exam/bank/index.js'] || {}
const secureContent = () => structuredClone({ questions:SECURE_QUESTIONS, groups:SECURE_GROUPS, references:SECURE_REFERENCES })
// Independently hand-checked keys and equivalence assignments, never derived by the authoring helper.
const secureKeys = [
  ['no'],['yes'],['no'],['production'],['current'],['failures'],
  [['get','value']],[['set','latest']],[['operation','status']],[['enabled','refresh']],[['total','failed']],
  ['client','get','value'],['regenerate','store','consume'],['filter','summarize','sort'],
  ['user','reader','officer'],['unlabelled','production','development'],['extract','inject','current'],['where','summarize','project'],
  ['production','refresh'],['get','value'],['extract','context'],['countif','bin'],
  ['yes','no','no'],['yes','no'],['yes','no'],['yes','no'],
  [['label','refresh']],[['filter','aggregate']],['extract','parent'],['store','vault'],
]
const secureFamilies = [1,1,1,4,5,6,7,7,9,4,6,7,13,6,1,4,17,6,4,7,17,6,7,9,25,6,4,6,17,30]
describe('secure bank', () => {
  it('exports 30 schema-valid items with exact kinds, groups and four objective allocations', () => {
    expect(SECURE_QUESTIONS).toBeInstanceOf(Array)
    expect(SECURE_QUESTIONS).toHaveLength(30)
    expect(validateDomainContent(secureContent(),'secure')).toBe(true)
    expect(SECURE_QUESTIONS.map(q=>q.id)).toEqual(Array.from({length:30},(_,i)=>`ai200-s${String(i+1).padStart(3,'0')}`))
    expect(SECURE_QUESTIONS.map(q=>q.kind)).toEqual(['single-choice','multiple-response','build-list','matching','dropdown','statement-grid','hot-area','active-screen'].flatMap((kind,i)=>Array([6,5,3,4,4,4,2,2][i]).fill(kind)))
    expect(SECURE_GROUPS.map(g=>[g.id,g.kind,g.questionIds])).toEqual([
      ['series-s1','series',['ai200-s001','ai200-s002','ai200-s003']],
      ['case-s1','case',['ai200-s004','ai200-s019','ai200-s027']],
      ['case-s2','case',['ai200-s009','ai200-s024','ai200-s029']],
    ])
    expect(new Set(SECURE_QUESTIONS.map(q=>q.objectiveId)).size).toBe(4)
  })
  it('grades all 30 literal keys and keeps equivalent widgets in shared families', () => {
    expect(SECURE_QUESTIONS).toBeInstanceOf(Array)
    SECURE_QUESTIONS.forEach((q,i)=>{
      expect(q.components.map(c=>c.expected)).toEqual(secureKeys[i])
      expect(gradeQuestion(q,Object.fromEntries(q.components.map((c,j)=>[c.id,secureKeys[i][j]]))).earned).toBe(q.components.length)
      expect(q.familyId).toBe(`ai200-s${String(secureFamilies[i]).padStart(3,'0')}`)
    })
    expect(new Set(SECURE_QUESTIONS.map(q=>q.familyId)).size).toBe(10)
    expect(SECURE_QUESTIONS.slice(0,3).map(q=>q.presentation.choices.map(c=>c.id))).toEqual([['yes','no'],['yes','no'],['yes','no']])
  })
})
describe('full-bank publication', () => {
  it('loads the complete validated bank lazily with all objective and canonical references', async () => {
    expect(EXAM_BANK).toBeTypeOf('object')
    expect(examData.loadExamBank).toBeTypeOf('function')
    expect(await examData.loadExamBank()).toBe(EXAM_BANK)
    expect(EXAM_BANK.questions).toHaveLength(120)
    expect(validateExamBank(EXAM_BANK)).toBe(true)
    expect(EXAM_BANK.groups).toHaveLength(8)
    expect(bankCoverage(EXAM_BANK).byKind).toEqual({'single-choice':24,'multiple-response':20,'build-list':16,matching:16,dropdown:16,'statement-grid':12,'hot-area':8,'active-screen':8})
    const coverage = bankCoverage(EXAM_BANK)
    expect(coverage.byDomain).toEqual({containers:27,data:33,connect:30,secure:30})
    expect(Object.keys(coverage.byObjective)).toHaveLength(27)
    expect(coverage.byObjective['secure.vault']).toBe(10)
    expect(coverage.byConcept['secure.trace-context']).toBe(6)
    expect(coverage.missingObjectiveIds).toEqual([])
    expect(coverage.missingConceptIds).toEqual([])
    expect(coverage.missingFamilyIds).toEqual([])
    expect(coverage.familyCount).toBe(69)
    expect(coverage.assessmentNeeded).toContainEqual({conceptId:'secure.failure-query',objectiveId:'secure.kql',familyCount:1,reason:'assessment-needed'})
    expect(coverage.assessmentNeeded.every(row=>row.reason==='assessment-needed' && row.familyCount<3)).toBe(true)
    const refs = new Set(EXAM_BANK.references.map(r=>r.id))
    for(const c of EXAM_CONCEPTS) expect(c.referenceIds.every(id=>refs.has(id))).toBe(true)
    expect(examData.validateLabMappings(EXAM_CONCEPTS,LABS)).toBe(EXAM_CONCEPTS)
  })
  it.each([40,50,60])('draws full-bank size %i with exact quotas, all kinds, two whole cases and one whole series', size => {
    expect(EXAM_BANK).toBeTypeOf('object')
    for(const seed of [0,23,4294967295]) {
      const deck=drawMock(EXAM_BANK,{size},seed)
      expect(deck.order).toHaveLength(size)
      expect(new Set(deck.order).size).toBe(size)
      expect(['containers','data','connect','secure'].map(d=>deck.questions.filter(q=>q.domain===d).length)).toEqual({40:[9,11,10,10],50:[12,14,12,12],60:[14,16,15,15]}[size])
      expect(new Set(deck.questions.map(q=>q.kind)).size).toBe(8)
      expect(deck.groups.filter(g=>g.kind==='case')).toHaveLength(2)
      expect(deck.groups.filter(g=>g.kind==='series')).toHaveLength(1)
      for(const g of deck.groups) expect(g.questionIds).toEqual(EXAM_BANK.groups.find(original=>original.id===g.id).questionIds)
      expect(drawMock(EXAM_BANK,{size},seed).order).toEqual(deck.order)
    }
  })
  it.each([
    ['incomplete pool',b=>b.questions.pop()],
    ['duplicate global question',b=>{b.questions[27].id=b.questions[0].id}],
    ['conflicting reused reference',b=>{b.references.push({...b.references[0],title:'Conflicting definition'})}],
    ['unknown family',b=>{b.questions[0].familyId='absent-family'}],
    ['cross-objective family',b=>{b.questions[0].familyId='ai200-s001'}],
    ['missing canonical ref',b=>{b.references=b.references.filter(r=>r.id!=='ref-secure.otel')}],
    ['extra envelope field',b=>{b.published=true}],
    ['null group',b=>{b.groups[0]=null}],
  ])('rejects full-bank %s',(_,corrupt)=>{
    expect(EXAM_BANK).toBeTypeOf('object')
    const b=structuredClone(EXAM_BANK);corrupt(b)
    expect(()=>validateExamBank(b)).toThrow(ExamError)
  })
  it('reports absent objectives, concepts and unresolved families honestly without inventing evidence',()=>{
    expect(bankCoverage).toBeTypeOf('function')
    const partial={version:1,revision:1,questions:[{...structuredClone(EXAM_BANK.questions.find(q=>q.id==='ai200-s007')),familyId:'missing'}],groups:[],references:[]}
    const coverage=bankCoverage(partial)
    expect(coverage.missingObjectiveIds).toContain('secure.kql')
    expect(coverage.missingConceptIds).toContain('secure.failure-query')
    expect(coverage.missingFamilyIds).toEqual(['missing'])
    expect(coverage.assessmentNeeded.find(c=>c.conceptId==='secure.failure-query')).toEqual({conceptId:'secure.failure-query',objectiveId:'secure.kql',familyCount:0,reason:'assessment-needed'})
  })
})

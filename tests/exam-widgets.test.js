// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import QuestionRenderer from '../src/components/exam/QuestionRenderer.vue'
import QuestionFeedback from '../src/components/exam/QuestionFeedback.vue'
import { publicQuestion, validateAnswer } from '../src/lib/exam/question.js'
import { gradeQuestion } from '../src/lib/exam/grading.js'
import { bankFixture, questionFixture } from './helpers/examFixtures.js'
import { change, cleanupExam, click, drop, dropData, key, mountExam } from './helpers/mountExam.js'

afterEach(cleanupExam)
const mount = (kind, value = {}, question = publicQuestion(questionFixture(kind))) => mountExam(QuestionRenderer, { question, value, disabled: false })
const button = (m, label) => [...m.host.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label || el.textContent.trim() === label)
const selects = (m) => [...m.host.querySelectorAll('select')]

describe('exam public question controls', () => {
  it('single choice starts unanswered and emits the chosen ID in given presentation order', async () => {
    const q = publicQuestion(questionFixture())
    q.presentation.choices.reverse()
    const m = mount('single-choice', {}, q)
    const radios = [...m.host.querySelectorAll('input[type=radio]')]
    expect(radios.map((el) => el.value)).toEqual(['d', 'c', 'b', 'a'])
    expect(m.host.querySelector('input:checked')).toBeNull()
    await click(radios[0])
    expect(m.answers).toEqual([{ pick: 'd' }])
    expect(m.warnings).toEqual([])
  })

  it.each(['multiple-response', 'hot-area'])('%s saves legal partial and excess drafts without enforcing the required count', async (kind) => {
    const m = mount(kind)
    const checks = [...m.host.querySelectorAll('input[type=checkbox]')]
    expect(checks.every((el) => !el.checked)).toBe(true)
    for (const el of checks.slice(0, 3)) await click(el)
    expect(m.answers).toEqual([{ pick: ['a'] }, { pick: ['a', 'b'] }, { pick: ['a', 'b', 'c'] }])
    await click(checks[0])
    expect(m.props.value).toEqual({ pick: ['b', 'c'] })
    validateAnswer(m.props.question, m.props.value)
  })

  it('build slots start unset, choose/remove candidates, and keep authored slot order', async () => {
    const m = mount('build-list')
    expect(selects(m).map((el) => el.value)).toEqual(['', ''])
    await change(selects(m)[1], 'b')
    await change(selects(m)[0], 'a')
    expect(m.props.value).toEqual({ first: 'a', second: 'b' })
    await click(button(m, 'Remove first'))
    expect(m.props.value).toEqual({ second: 'b' })
    expect(selects(m).map((el) => el.getAttribute('aria-label'))).toEqual(['first', 'second'])
  })

  it('build pointer reorder and keyboard reorder use stable slot IDs, including holes', async () => {
    const pointer = mount('build-list', { first: 'a' })
    await drop(button(pointer, 'Choice a'), pointer.host.querySelector('[data-slot="second"]'))
    expect(pointer.answers).toEqual([{ second: 'a' }])
    const keyboard = mount('build-list', { first: 'a' })
    await key(keyboard.host.querySelector('[data-slot="first"]'), 'ArrowDown', { altKey: true })
    expect(keyboard.answers).toEqual([{ second: 'a' }])
    await click(button(keyboard, 'Move second up'))
    expect(keyboard.props.value).toEqual({ first: 'a' })
  })

  it('build candidate selection and a slot button provide a keyboard alternative to candidate drop', async () => {
    const pointer = mount('build-list')
    await drop(button(pointer, 'Choice c'), pointer.host.querySelector('[data-slot="second"]'))
    const keyboard = mount('build-list')
    await click(button(keyboard, 'Choice c'))
    await click(button(keyboard, 'Place selected action in second'))
    expect(pointer.answers).toEqual([{ second: 'c' }])
    expect(keyboard.answers).toEqual([{ second: 'c' }])
  })

  it.each(['build-list', 'matching'])('%s ignores unrelated and empty drag payloads instead of clearing a saved answer', async (kind) => {
    const m = mount(kind, { first: 'a' })
    const target = m.host.querySelector('[data-slot], [data-target]')
    await dropData(target, '')
    await dropData(target, 'unknown-candidate')
    expect(m.answers).toEqual([])
    expect(m.props.value).toEqual({ first: 'a' })
    expect(m.warnings).toEqual([])
  })

  it('matching dropdown and drop move a non-reusable candidate with one legal emission', async () => {
    const pointer = mount('matching', { first: 'a', second: 'b' })
    expect(pointer.host.textContent).toContain('Each candidate can be used once')
    await drop(button(pointer, 'Choice a'), pointer.host.querySelector('[data-target="second"]'))
    expect(pointer.answers).toEqual([{ second: 'a' }])
    const keyboard = mount('matching', { first: 'a', second: 'b' })
    await change(selects(keyboard)[1], 'a')
    expect(keyboard.answers).toEqual([{ second: 'a' }])
    await click(button(keyboard, 'Remove second'))
    expect(keyboard.props.value).toEqual({})
  })

  it('matching allows reuse when authored and leaves target order fixed', async () => {
    const q = publicQuestion(questionFixture('matching'))
    q.presentation.allowReuse = true
    q.presentation.candidates.reverse()
    const m = mount('matching', {}, q)
    await change(selects(m)[0], 'a')
    await change(selects(m)[1], 'a')
    expect(m.props.value).toEqual({ first: 'a', second: 'a' })
    expect([...selects(m)[0].options].map((el) => el.value)).toEqual(['', 'd', 'c', 'b', 'a'])
    expect(selects(m).map((el) => el.getAttribute('aria-label'))).toEqual(['first', 'second'])
  })

  it.each(['dropdown', 'active-screen'])('%s has labelled unset fields and filters only legal component candidates', async (kind) => {
    const q = publicQuestion(questionFixture(kind))
    q.components[0].candidateIds = ['a', 'c']
    q.presentation.candidates.reverse()
    const m = mount(kind, {}, q)
    expect(selects(m).map((el) => el.value)).toEqual(['', ''])
    expect([...selects(m)[0].options].map((el) => el.value)).toEqual(['', 'c', 'a'])
    expect(selects(m).map((el) => el.getAttribute('aria-label'))).toEqual(['first', 'second'])
    await change(selects(m)[0], 'c')
    await change(selects(m)[1], 'b')
    expect(m.props.value).toEqual({ first: 'c', second: 'b' })
    await change(selects(m)[0], '')
    expect(m.props.value).toEqual({ second: 'b' })
  })

  it('statement grid groups yes/no per row without defaulting or affecting another row', async () => {
    const m = mount('statement-grid')
    expect(m.host.querySelector('input:checked')).toBeNull()
    const rows = [...m.host.querySelectorAll('fieldset')]
    await click(rows[1].querySelector('input[value=no]'))
    await click(rows[0].querySelector('input[value=yes]'))
    expect(m.props.value).toEqual({ second: 'no', first: 'yes' })
    expect(rows[0].querySelector('legend').textContent).toBe('first')
    expect(rows[0].querySelector('input').name).not.toBe(rows[1].querySelector('input').name)
  })

  it('hot-area geometry has labels and pressed states synchronized with the equivalent text list', async () => {
    const m = mount('hot-area')
    const diagram = m.host.querySelector('[role=group][aria-label=Architecture]')
    const region = diagram.querySelector('button[aria-label="Choice b"]')
    expect(region.style.left).toBe('25%')
    expect(region.getAttribute('aria-pressed')).toBe('false')
    await click(region)
    expect(m.props.value).toEqual({ pick: ['b'] })
    expect(m.host.querySelector('input[value=b]').checked).toBe(true)
    await click(m.host.querySelector('input[value=b]'))
    expect(region.getAttribute('aria-pressed')).toBe('false')
    expect(m.props.value).toEqual({ pick: [] })
  })

  it.each(['single-choice', 'multiple-response', 'build-list', 'matching', 'dropdown', 'statement-grid', 'hot-area', 'active-screen'])('%s disables native controls and refuses synthetic edits', async (kind) => {
    const initial = ['multiple-response', 'hot-area'].includes(kind) ? { pick: ['a'] }
      : kind === 'single-choice' ? { pick: 'a' }
      : kind === 'statement-grid' ? { first: 'yes' } : { first: 'a' }
    const m = mount(kind, initial)
    await m.setProps({ disabled: true })
    const controls = [...m.host.querySelectorAll('input,select,button')]
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((el) => el.disabled)).toBe(true)
    for (const el of controls) {
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    if (kind === 'build-list' || kind === 'matching') {
      await drop(button(m, 'Choice a'), m.host.querySelector('[data-slot], [data-target]'))
      await dropData(m.host.querySelector('[data-slot], [data-target]'), 'b')
      await key(m.host.querySelector('[data-slot], [data-target]'), 'ArrowDown', { altKey: true })
    }
    expect(m.answers).toEqual([])
    expect(m.props.value).toEqual(initial)
    expect(m.warnings).toEqual([])
  })

  it('build movement at a list boundary refuses synthetic clicks and keyboard moves without warnings', async () => {
    const m = mount('build-list', { first: 'a', second: 'b' })
    for (const label of ['Move first up', 'Move second down']) button(m, label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await key(m.host.querySelector('[data-slot=first]'), 'ArrowUp', { altKey: true })
    await key(m.host.querySelector('[data-slot=second]'), 'ArrowDown', { altKey: true })
    expect(m.answers).toEqual([])
    expect(m.warnings).toEqual([])
  })

  it('renders authored text and code safely and does not accept private questions in inputs', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const q = publicQuestion(questionFixture('single-choice', { stem: hostile, artifacts: [{ id: 'code', kind: 'code', language: 'python', text: hostile }, { id: 'note', kind: 'text', language: null, text: hostile }] }))
    const m = mount('single-choice', {}, q)
    expect(m.host.querySelector('pre code').textContent).toBe(hostile)
    expect(m.host.textContent).toContain(hostile)
    expect(m.host.querySelector('img')).toBeNull()
    const privateMount = mount('single-choice', {}, questionFixture())
    expect(privateMount.host.querySelector('[role=alert]')).not.toBeNull()
    expect(privateMount.host.querySelector('input')).toBeNull()
    expect(privateMount.warnings).toEqual([])
  })

  it.each([null, { kind: 'unknown' }, { ...publicQuestion(questionFixture()), components: [] }])('invalid or unknown question renders a visible failure without Vue warnings', (question) => {
    const m = mountExam(QuestionRenderer, { question, value: {}, disabled: false })
    expect(m.host.querySelector('[role=alert]').textContent).toContain('Question cannot be displayed')
    expect(m.host.querySelector('input')).toBeNull()
    expect(m.warnings).toEqual([])
  })
})

describe('explicitly permitted feedback', () => {
  it('omitted permission hides malformed private payloads without reading getters', () => {
    let getterReads = 0
    let descriptorInspections = 0
    const payload = {}
    for (const property of ['id', 'stem', 'explanation', 'questionId', 'outcomes']) {
      Object.defineProperty(payload, property, { enumerable: true, get() { getterReads++; throw new Error('Denied payload was read') } })
    }
    const privatePayload = new Proxy(payload, { ownKeys() { descriptorInspections++; throw new Error('Denied payload was inspected') } })
    const m = mountExam(QuestionFeedback, { question: privatePayload, grade: privatePayload, references: [privatePayload] })
    expect(m.host.textContent.trim()).toBe('')
    expect(m.host.querySelector('a, pre, [role=alert]')).toBeNull()
    expect(getterReads).toBe(0)
    expect(descriptorInspections).toBe(0)
    expect(m.warnings).toEqual([])
  })

  it('revoking permission removes all private feedback and does not inspect a denied replacement', async () => {
    const q = questionFixture('matching', { csharp: 'private example' })
    const m = mountExam(QuestionFeedback, { question: q, grade: gradeQuestion(q, { first: 'a' }), references: bankFixture().references, permitted: true })
    expect(m.host.querySelector('[data-component-reason]')).not.toBeNull()
    expect(m.host.querySelector('a')).not.toBeNull()
    expect(m.host.querySelector('pre code').textContent).toBe('private example')
    await m.setProps({ permitted: false })
    expect(m.host.textContent.trim()).toBe('')
    expect(m.host.querySelector('[data-component-reason], [data-candidate-reason], a, pre, [role=alert]')).toBeNull()
    let getterReads = 0
    let descriptorInspections = 0
    const payload = {}
    Object.defineProperty(payload, 'id', { enumerable: true, get() { getterReads++; throw new Error('Denied question was read') } })
    Object.defineProperty(payload, 'questionId', { enumerable: true, get() { getterReads++; throw new Error('Denied grade was read') } })
    const denied = new Proxy(payload, { ownKeys() { descriptorInspections++; throw new Error('Denied payload was inspected') } })
    await m.setProps({ question: denied, grade: denied, references: [denied] })
    expect(m.host.textContent.trim()).toBe('')
    expect(getterReads).toBe(0)
    expect(descriptorInspections).toBe(0)
    expect(m.warnings).toEqual([])
  })

  it('discloses nothing until permission and then shows every authored reason, outcome and approved reference', async () => {
    const q = questionFixture('matching', { csharp: '<script>not executable</script>' })
    const grade = gradeQuestion(q, { first: 'a' })
    const m = mountExam(QuestionFeedback, { question: q, grade, references: bankFixture().references, permitted: false })
    expect(m.host.textContent.trim()).toBe('')
    expect(m.host.querySelector('a')).toBeNull()
    await m.setProps({ permitted: true })
    expect(m.host.textContent).toContain('1 / 2')
    expect(m.host.textContent).toContain('unanswered')
    expect([...m.host.querySelectorAll('[data-component-reason]')].length).toBe(2)
    expect([...m.host.querySelectorAll('[data-candidate-reason]')].length).toBe(8)
    for (const reason of q.explanation.components) {
      expect(m.host.textContent).toContain(reason.text)
      for (const candidate of reason.candidates) expect(m.host.textContent).toContain(candidate.text)
    }
    expect(m.host.querySelector('a').href).toBe(bankFixture().references[0].url)
    expect(m.host.querySelector('pre code').textContent).toBe('<script>not executable</script>')
    expect(m.host.querySelector('script')).toBeNull()
    expect(m.warnings).toEqual([])
  })

  it('rejects missing/mismatched grade and unsafe or missing references without leaking reasons', () => {
    const q = questionFixture()
    for (const props of [
      { grade: null, references: bankFixture().references },
      { grade: { ...gradeQuestion(q, {}), questionId: 'other' }, references: bankFixture().references },
      { grade: { ...gradeQuestion(q, {}), outcomes: [] }, references: bankFixture().references },
      { grade: { ...gradeQuestion(q, {}), earned: 1 }, references: bankFixture().references },
      { grade: gradeQuestion(q, {}), references: [] },
      { grade: gradeQuestion(q, {}), references: [{ ...bankFixture().references[0], url: 'javascript:alert(1)' }] },
    ]) {
      const m = mountExam(QuestionFeedback, { question: q, permitted: true, ...props })
      expect(m.host.querySelector('[role=alert]')).not.toBeNull()
      expect(m.host.textContent).not.toContain(q.explanation)
      expect(m.host.querySelector('a')).toBeNull()
      expect(m.warnings).toEqual([])
    }
  })
})

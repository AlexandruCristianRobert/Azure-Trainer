import { afterEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { buildExplanationPrompt, copyExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'
import rationaleSource from '../src/components/lab/TaskRationale.vue?raw'
import taskSource from '../src/components/lab/TaskRow.vue?raw'
import hintSource from '../src/components/lab/HintBox.vue?raw'
import examSource from '../src/components/lab/ExamNote.vue?raw'
import iconSource from '../src/components/icons/FluentIcon.vue?raw'
import { renderInline } from '../src/lib/inlineCode.js'
import { fluentIcon } from '../src/lib/icons.js'

const rationale = { concept: 'PeekLock', what: 'Receive with a lock', why: 'Finish work first', without: 'Work can be lost', csharp: 'Compare CompleteMessageAsync in C#.' }

it('copies authored concept context, never solution properties', async () => {
  const text = buildExplanationPrompt({ labTitle: 'Receive orders', taskText: 'Complete an order',
    rationale: { ...rationale, solution: 'NESTED-SECRET', credentials: 'SECRET-TOKEN' },
    solution: 'SECRET-WORKED-ANSWER', workspace: 'PRIVATE-WORKSPACE' })
  for (const context of ['C#', 'Python', 'AI-200', 'Receive orders', 'Complete an order', 'PeekLock', 'Receive with a lock', 'Finish work first', 'Work can be lost', 'CompleteMessageAsync']) expect(text).toContain(context)
  for (const secret of ['SECRET-WORKED-ANSWER', 'NESTED-SECRET', 'SECRET-TOKEN', 'PRIVATE-WORKSPACE']) expect(text).not.toContain(secret)
  expect(text).toMatch(/without giving the complete lab Solution/i)
  let clipboardText
  const writeText = vi.fn(async value => { clipboardText = value })
  expect(await copyExplanationPrompt(text, { writeText })).toEqual({ copied: true, fallback: null })
  expect(clipboardText).toBe(text)
})

it('returns selectable original text when the clipboard rejects', async () => {
  expect(await copyExplanationPrompt('Explain PeekLock', { writeText: async () => { throw new Error('Denied') } }))
    .toEqual({ copied: false, fallback: 'Explain PeekLock' })
})

it('returns selectable original text when the clipboard is absent', async () => {
  expect(await copyExplanationPrompt('Explain PeekLock', undefined)).toEqual({ copied: false, fallback: 'Explain PeekLock' })
})

// Compile the real client SFCs, as in the owning editor/terminal tests. Only the
// store boundary is supplied; all assistance components and Vue state are real.
function compileComponent(source, dependencies = {}) {
  const code = compileScript(parse(source).descriptor, { id: 'messaging-rationale', inlineTemplate: true }).content
    .replace(/import \{([\s\S]*?)\} from ['"]vue['"];?/g, (_, names) => `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = Vue;`)
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return')
  return new Function('Vue', ...Object.keys(dependencies), code)(Vue, ...Object.values(dependencies))
}
const TaskRationale = compileComponent(rationaleSource, { buildExplanationPrompt, copyExplanationPrompt })
const fixture = { run: null }
const TaskRow = compileComponent(taskSource, {
  TaskRationale, renderInline,
  FluentIcon: compileComponent(iconSource, { fluentIcon }),
  HintBox: compileComponent(hintSource, { renderInline }),
  ExamNote: compileComponent(examSource, { renderInline }),
  useLabRunStore: () => fixture.run,
})

const apps = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount(); vi.unstubAllGlobals() })

function mount(component, initialProps) {
  const node = type => Vue.markRaw({ type, children: [], parent: null, props: {}, text: '' })
  function insert(child, parent, anchor = null) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  }
  const renderer = Vue.createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: text => ({ ...node('#comment'), text }), insert,
    remove(child) { child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null },
    setText: (child, text) => { child.text = text },
    setElementText: (child, text) => { child.text = text; child.children = [] },
    patchProp: (child, key, _previous, value) => { child.props[key] = value },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    insertStaticContent(content, parent, anchor) { const child = node('#static'); child.text = content; insert(child, parent, anchor); return [child, child] },
  })
  const props = Vue.reactive(initialProps)
  const root = node('root')
  const app = renderer.createApp({ render: () => Vue.h(component, props) })
  app.mount(root); apps.push(app)
  function find(predicate, parent = root) { return predicate(parent) ? parent : parent.children.map(child => find(predicate, child)).find(Boolean) }
  const text = parent => parent.text + parent.children.map(text).join('')
  return { props, app, find, text: () => text(root), button: label => find(child => child.type === 'button' && text(child).includes(label)) }
}

function taskRow(state = 'current', extra = {}) {
  fixture.run = Vue.reactive({ lab: { title: 'Receive orders' }, behavioralRun: {} })
  return mount(TaskRow, { task: { id: 'receive', index: 0, text: 'Complete an order', hints: ['Consider settlement'], examNote: 'Lock before settlement', solution: 'SECRET-WORKED-ANSWER', explanation: 'LEGACY-EXPLANATION', rationale }, state, ...extra })
}

it('starts collapsed and exposes a keyboard-native expanded control', async () => {
  const view = taskRow()
  expect(view.button('Why this?').props.type).toBe('button')
  expect(view.button('Why this?').props['aria-expanded']).toBe(false)
  expect(view.find(child => child.props['aria-label'] === 'Task rationale')).toBeUndefined()
  expect(view.text()).not.toContain('LEGACY-EXPLANATION')
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  expect(view.button('Why this?').props['aria-expanded']).toBe(true)
  expect(view.find(child => child.props['aria-label'] === 'Task rationale')).toBeDefined()
  expect(view.text()).toContain('Receive with a lock')
  expect(view.text()).toContain('Compare CompleteMessageAsync')
})

it('keeps rationale available for a completed task', async () => {
  const view = taskRow('done')
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  expect(view.text()).toContain('Finish work first')
  expect(view.button('Copy explanation prompt')).toBeDefined()
})

it('revealing a Solution leaves rationale closed and rationale does not reveal assistance', async () => {
  const revealed = []
  const view = taskRow('current', { onRevealSolution: () => revealed.push('solution'), onRevealHint: () => revealed.push('hint') })
  view.button('Show solution').props.onClick()
  view.props.solutionRevealed = true; await Vue.nextTick()
  expect(revealed).toEqual(['solution'])
  expect(view.text()).toContain('SECRET-WORKED-ANSWER')
  expect(view.button('Why this?').props['aria-expanded']).toBe(false)
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  expect(revealed).toEqual(['solution'])
})

it('preserves legacy explanation when authored rationale is absent', () => {
  const view = taskRow('current')
  view.props.task.rationale = null
  return Vue.nextTick().then(() => {
    expect(view.button('Why this?')).toBeUndefined()
    expect(view.text()).toContain('LEGACY-EXPLANATION')
  })
})

it('reports clipboard success only after completion', async () => {
  let finish
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise(resolve => { finish = resolve }) } })
  const view = mount(TaskRationale, { labTitle: 'Receive orders', taskText: 'Complete an order', rationale })
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  const copying = view.button('Copy explanation prompt').props.onClick()
  await Vue.nextTick()
  expect(view.find(child => child.props.role === 'status').text).not.toContain('copied')
  finish(); await copying; await Vue.nextTick()
  expect(view.find(child => child.props.role === 'status').text).toMatch(/copied/i)
})

it('shows read-only selectable fallback text when copy is unavailable', async () => {
  vi.stubGlobal('navigator', {})
  const view = mount(TaskRationale, { labTitle: 'Receive orders', taskText: 'Complete an order', rationale })
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  await view.button('Copy explanation prompt').props.onClick(); await Vue.nextTick()
  const fallback = view.find(child => child.type === 'textarea')
  expect(fallback.props.readonly).not.toBeUndefined()
  expect(fallback.props['aria-label']).toBe('Explanation prompt')
  expect(fallback.props.value).toContain('PeekLock')
  expect(view.find(child => child.props.role === 'status').text).toMatch(/copy.*unavailable/i)
})

it('ignores delayed clipboard completion after a Task switch', async () => {
  let finish
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise(resolve => { finish = resolve }) } })
  const view = taskRow()
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  const copying = view.button('Copy explanation prompt').props.onClick()
  view.props.task = { ...view.props.task, id: 'next', text: 'Publish a notification', rationale: { ...rationale, concept: 'Event Grid' } }
  await Vue.nextTick()
  finish(); await copying; await Vue.nextTick()
  expect(view.button('Why this?').props['aria-expanded']).toBe(false)
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  expect(view.find(child => child.props.role === 'status').text).toBe('')
  expect(view.find(child => child.type === 'textarea')).toBeUndefined()
})

it('ignores delayed clipboard completion after unmount', async () => {
  let finish
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise(resolve => { finish = resolve }) } })
  const view = mount(TaskRationale, { labTitle: 'Receive orders', taskText: 'Complete an order', rationale })
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  const copying = view.button('Copy explanation prompt').props.onClick()
  view.app.unmount(); apps.splice(apps.indexOf(view.app), 1)
  finish(); await copying; await Vue.nextTick()
  expect(view.text()).toBe('')
})

it('clears prior copy state and ignores delayed completion when the same component changes context', async () => {
  let finish
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise(resolve => { finish = resolve }) } })
  const view = mount(TaskRationale, { labTitle: 'Receive orders', taskText: 'Complete an order', rationale })
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  const copying = view.button('Copy explanation prompt').props.onClick()
  view.props.taskText = 'Reject an invalid order'
  await Vue.nextTick()
  finish(); await copying; await Vue.nextTick()
  expect(view.button('Why this?').props['aria-expanded']).toBe(false)
  view.button('Why this?').props.onClick(); await Vue.nextTick()
  expect(view.find(child => child.props.role === 'status').text).toBe('')
  expect(view.button('Copy explanation prompt').props.disabled).toBe(false)
  expect(view.find(child => child.type === 'textarea')).toBeUndefined()
})

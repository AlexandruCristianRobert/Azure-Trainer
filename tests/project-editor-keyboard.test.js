import { describe, expect, it } from 'vitest'
import { editProjectText } from '../src/lib/project/editor-keyboard.js'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import editorSource from '../src/components/lab/ProjectEditor.vue?raw'

const edit = (text, start, end, key, path = 'app.py', shiftKey = false) =>
  editProjectText({ text, start, end, key, path, shiftKey })

describe('project editor keyboard edits', () => {
  it('indents the current row and keeps the caret with its code using file-specific widths', () => {
    expect(edit('abc', 1, 1, 'Tab')).toEqual({ text: '    abc', start: 5, end: 5 })
    expect(edit('abc', 1, 1, 'Tab', 'Program.cs')).toEqual({ text: '    abc', start: 5, end: 5 })
    for (const path of ['app.yaml', 'app.json', 'main.bicep']) {
      expect(edit('abc', 1, 1, 'Tab', path)).toEqual({ text: '  abc', start: 3, end: 3 })
    }
  })

  it('indents selected rows but excludes a row whose start is the selection end', () => {
    expect(edit('a\nb\nc', 0, 4, 'Tab')).toEqual({ text: '    a\n    b\nc', start: 4, end: 12 })
    expect(edit('a\nb', 0, 0, 'Tab')).toEqual({ text: '    a\nb', start: 4, end: 4 })
  })

  it('unindents partial space prefixes or a leading tab and clamps the selection', () => {
    expect(edit('  a\n\tb\nc', 0, 7, 'Tab', 'app.py', true)).toEqual({ text: 'a\nb\nc', start: 0, end: 4 })
    expect(edit('    abc', 2, 2, 'Tab', 'app.py', true)).toEqual({ text: 'abc', start: 0, end: 0 })
    expect(edit('abc', 1, 1, 'Tab', 'app.py', true)).toEqual({ text: 'abc', start: 1, end: 1 })
  })

  it('preserves indentation and adds a Python block indent before trailing comments', () => {
    expect(edit('  if ready: # go', 16, 16, 'Enter')).toEqual({ text: '  if ready: # go\n      ', start: 23, end: 23 })
    expect(edit('if "#" == tag:', 14, 14, 'Enter')).toEqual({ text: 'if "#" == tag:\n    ', start: 19, end: 19 })
    expect(edit('value = "text:"', 15, 15, 'Enter')).toEqual({ text: 'value = "text:"\n', start: 16, end: 16 })
  })

  it('uses only pre-caret code and replaces the selected text on Enter', () => {
    expect(edit('  abcd', 4, 6, 'Enter')).toEqual({ text: '  ab\n  ', start: 7, end: 7 })
    expect(edit('if ready:', 2, 2, 'Enter')).toEqual({ text: 'if\n ready:', start: 3, end: 3 })
    expect(edit('  key:', 6, 6, 'Enter', 'app.yaml')).toEqual({ text: '  key:\n  ', start: 9, end: 9 })
  })

  it('preserves CRLF line endings when indenting and inserting a newline', () => {
    expect(edit('a\r\nb', 0, 3, 'Tab')).toEqual({ text: '    a\r\nb', start: 4, end: 7 })
    expect(edit('  a\r\nb', 3, 3, 'Enter')).toEqual({ text: '  a\r\n  \r\nb', start: 7, end: 7 })
  })

  it('leaves unrelated keys and modified Enter to native editing', () => {
    expect(edit('abc', 1, 1, 'ArrowLeft')).toBeNull()
    expect(edit('abc', 1, 1, 'Enter', 'app.py', true)).toBeNull()
  })

  it('dispatches editable keys, preserves native escape/modifier/IME keys, and guards stale selection restoration', async () => {
    // Execute the actual setup/handler; no DOM host or browser dependencies needed.
    const compiled = compileScript(parse(editorSource).descriptor, { id: 'editor-keyboard' }).content
      .replace(/import \{([^}]+)\} from ['"]vue['"];?/g, (_, names) => `const {${names}} = Vue;`)
      .replace(/^import .*$/gm, '')
      .replace('export default', 'return')
    const drafts = []
    const run = Vue.reactive({ labId: 'lab', behavioralRun: { attemptId: 'attempt', project: { draftFiles: { 'app.py': 'abc' } } },
      dispatchBehavioral: async payload => { drafts.push(payload) } })
    const manifest = { files: ['app.py', 'other.py'], fixedFiles: {} }
    const component = new Function('Vue', 'useLabRunStore', 'getProjectManifest', 'parseKubernetesYaml', 'kubeJson', 'editProjectText', compiled)(
      Vue, () => run, () => manifest, () => ({ documents: [], diagnostics: [] }), JSON.stringify, editProjectText)
    const editor = component.setup({}, { expose() {} })
    const target = { value: 'abc', selectionStart: 1, selectionEnd: 1, selectionDirection: 'backward',
      setSelectionRange(start, end, direction) { this.selection = [start, end, direction] } }
    target.ownerDocument = { activeElement: target }
    let prevented = 0
    const key = (key, extra = {}) => editor.editorKeydown({ key, target, preventDefault() { prevented++ }, ...extra })
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) key('Tab', extra)
    run.readOnly = true; key('Tab'); run.readOnly = false
    manifest.fixedFiles['app.py'] = 'abc'; editor.selectFile('other.py'); editor.selectFile('app.py'); key('Tab')
    delete manifest.fixedFiles['app.py']; editor.selectFile('other.py'); editor.selectFile('app.py')
    key('Escape'); key('Tab')
    expect(prevented).toBe(0)
    expect(drafts).toEqual([])
    key('Tab')
    await Vue.nextTick()
    expect(prevented).toBe(1)
    expect(drafts).toEqual([{ type: 'draft', path: 'app.py', text: '    abc' }])
    expect(editor.text.value).toBe('    abc')
    expect(target.selection).toEqual([5, 5, 'backward'])
    delete target.selection
    key('Tab')
    editor.selectFile('other.py')
    await Vue.nextTick()
    expect(target.selection).toBeUndefined()
  })
})

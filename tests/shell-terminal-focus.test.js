import { expect, it, vi } from 'vitest'
import { createRenderer, nextTick, reactive } from 'vue'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import source from '../src/components/shell/ShellTerminal.vue?raw'

const fixture = { run: null }
// Vitest's Node environment normally requests an SSR transform. Compile the
// actual client component instead; substitute only the asynchronous store edge.
const compiled = compileScript(parse(source).descriptor, { id: 'terminal-focus', inlineTemplate: true }).content
const clientCode = compiled
  .replace(/import \{([\s\S]*?)\} from ['"]vue['"];?/g, (_, names) => `const {${names.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = Vue;`)
  .replace(/import \{ useLabRunStore \} from ['"][^'"]+['"];?/, 'const useLabRunStore = getRun;')
  .replace('export default', 'return')
const ShellTerminal = new Function('Vue', 'getRun', clientCode)(Vue, () => fixture.run)

// Exercise the actual Vue component and scheduler without a browser or DOM
// dependency. Removing a focused subtree models the input's v-if unmount.
function terminalHost() {
  let active = null
  const node = type => Vue.markRaw({ type, tagName: type.toUpperCase(), value: '', children: [], parent: null, props: {}, scrollHeight: 0,
    addEventListener() {},
    getRootNode() { return document },
    focus() { active = this } })
  function insert(child, parent, anchor = null) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  }
  const renderer = createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }),
    createComment: text => ({ ...node('#comment'), text }),
    insert,
    remove(child) {
      for (let current = active; current; current = current.parent) {
        if (current === child) { active = null; break }
      }
      child.parent.children.splice(child.parent.children.indexOf(child), 1)
      child.parent = null
    },
    setText: (child, text) => { child.text = text },
    setElementText: (child, text) => { child.text = text; child.children = [] },
    patchProp: (child, key, _previous, value) => { child.props[key] = value },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    insertStaticContent(content, parent, anchor) {
      const child = node('#static'); child.text = content; insert(child, parent, anchor)
      return [child, child]
    },
  })
  const root = node('root')
  const findInput = parent => parent.type === 'input' ? parent : parent.children.map(findInput).find(Boolean)
  return { renderer, root, input: () => findInput(root), active: () => active }
}

it('refocuses the replacement terminal prompt after Enter, including a failed command', async () => {
  for (const fails of [false, true]) {
    let finish
    const completed = new Promise(resolve => { finish = resolve })
    fixture.run = reactive({
      lab: { engineVersion: 2 }, running: false, busy: false, loading: false,
      readOnly: false, completedAt: null, storageError: null, scrollback: [], history: [],
      async execute() {
        this.running = true
        await completed
        this.running = false
        if (fails) throw new Error('Session error')
      },
    })
    const host = terminalHost()
    class HostDocument { get activeElement() { return host.active() } }
    vi.stubGlobal('Document', HostDocument)
    vi.stubGlobal('ShadowRoot', class {})
    vi.stubGlobal('document', new HostDocument())
    const app = host.renderer.createApp(ShellTerminal)
    app.mount(host.root)
    try {
      await nextTick()
      const original = host.input()
      expect(host.active()).toBe(original)
      original.props['onUpdate:modelValue']('az group list')
      original.props.onKeydown({ key: 'Enter', preventDefault() {} })
      await nextTick()
      expect(host.input()).toBeUndefined()
      expect(host.active()).toBeNull()
      finish()
      await new Promise(resolve => setImmediate(resolve))
      await nextTick()
      const replacement = host.input()
      expect(replacement).toBeDefined()
      expect(replacement).not.toBe(original)
      expect(host.active() === replacement).toBe(true)
      expect(replacement.value).toBe('')
      replacement.props['onUpdate:modelValue']('pwd')
      await nextTick()
      expect(host.input().value).toBe('pwd')
    } finally { finish(); app.unmount(); vi.unstubAllGlobals() }
  }
})

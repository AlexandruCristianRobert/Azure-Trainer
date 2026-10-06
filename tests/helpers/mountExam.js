import { createApp, h, nextTick, reactive } from 'vue'

const mounts = new Set()

export function mountExam(component, initialProps) {
  const host = document.createElement('div')
  document.body.append(host)
  const props = reactive({ ...initialProps })
  const answers = []
  const app = createApp({
    render: () => h(component, {
      ...props,
      'onUpdate:value': (value) => { answers.push(value); props.value = value },
    }),
  })
  const warnings = []
  app.config.warnHandler = (message) => warnings.push(message)
  app.mount(host)
  const mounted = {
    host, props, answers, warnings,
    async setProps(values) { Object.assign(props, values); await nextTick() },
    unmount() { app.unmount(); host.remove(); mounts.delete(mounted) },
  }
  mounts.add(mounted)
  return mounted
}

export function cleanupExam() { [...mounts].forEach((mounted) => mounted.unmount()) }

export async function change(element, value) {
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

export async function click(element) { element.click(); await nextTick() }

export async function key(element, key, options = {}) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }))
  await nextTick()
}

export async function drop(source, target) {
  const values = new Map()
  const dataTransfer = { setData: (type, value) => values.set(type, value), getData: (type) => values.get(type) ?? '' }
  for (const [type, element] of [['dragstart', source], ['drop', target]]) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    element.dispatchEvent(event)
  }
  await nextTick()
}

export async function dropData(target, candidateId) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { getData: () => candidateId } })
  target.dispatchEvent(event)
  await nextTick()
}

// Manual browser regression: run Vite, then open the Capstone Lab in Chrome with
// --remote-debugging-port=9223 and run this with Node 22+ (global WebSocket).
// CDP_PORT and APP_URL override the defaults below.
// This checks the mounted input across multiple one-second Lab ticks.
const port = process.env.CDP_PORT ?? '9223'
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:5175/lab/aca-capstone'
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const tab = tabs.find((item) => item.type === 'page' && item.url === appUrl)
if (!tab) throw new Error(`Open ${appUrl} in the debugging browser first.`)

const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let sequence = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 100; i++) {
      const input = document.querySelector('input[aria-label="Cloud Shell command input"]')
      if (input) {
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
        window.__focusProbeInput = input
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  })()`)
  if (!ready) throw new Error('Cloud Shell input did not appear.')

  for (const character of 'az group list') {
    await send('Input.insertText', { text: character })
    await delay(180)
  }
  const typed = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Cloud Shell command input"]')
    return { sameNode: input === window.__focusProbeInput,
      focused: document.activeElement === input, value: input?.value }
  })()`)
  if (!typed.sameNode || !typed.focused || typed.value !== 'az group list') {
    throw new Error(`Typing lost Cloud Shell focus or draft: ${JSON.stringify(typed)}`)
  }

  await send('Input.insertText', { text: ' --output json' })
  await delay(1200)
  const pasted = await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Cloud Shell command input"]')
    return { sameNode: input === window.__focusProbeInput,
      focused: document.activeElement === input, value: input?.value }
  })()`)
  if (!pasted.sameNode || !pasted.focused || pasted.value !== 'az group list --output json') {
    throw new Error(`Pasted text lost Cloud Shell focus or draft: ${JSON.stringify(pasted)}`)
  }
  console.log('Cloud Shell input kept the same focused DOM node and full draft across multiple Lab ticks; text insertion remained intact.')
} finally {
  socket.close()
}

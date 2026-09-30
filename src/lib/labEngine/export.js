// Recovery data can be a structured clone that is not a valid run. Preserve normal
// JSON exactly and label values that JSON itself cannot represent.
export function encodeRunExport(value) {
  const seen = new WeakMap()
  function encode(input, path) {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : `[non-finite number: ${input}]`
    if (typeof input === 'undefined') return '[undefined]'
    if (typeof input === 'bigint') return `[BigInt: ${input}]`
    if (typeof input === 'symbol') return `[Symbol: ${String(input.description)}]`
    if (typeof input === 'function') return '[function]'
    if (seen.has(input)) return `[reference to ${seen.get(input)}]`
    seen.set(input, path)
    if (input instanceof Date) return `[Date: ${Number.isNaN(input.valueOf()) ? 'Invalid' : input.toISOString()}]`
    if (input instanceof RegExp) return `[RegExp: ${input}]`
    if (input instanceof Map) return { '[Map]': [...input.entries()].map(([key, item], index) => [encode(key, `${path}.key${index}`), encode(item, `${path}.value${index}`)]) }
    if (input instanceof Set) return { '[Set]': [...input.values()].map((item, index) => encode(item, `${path}.${index}`)) }
    if (input instanceof ArrayBuffer) return `[ArrayBuffer: ${input.byteLength} bytes]`
    if (ArrayBuffer.isView(input)) return `[${input.constructor.name}: ${input.byteLength} bytes]`
    if (Array.isArray(input)) return Array.from({ length: input.length }, (_, index) => index in input ? encode(input[index], `${path}[${index}]`) : '[array hole]')
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return `[unsupported ${input.constructor?.name ?? 'object'}]`
    const result = {}
    for (const key of Object.keys(input)) {
      try { result[key] = encode(input[key], `${path}.${key}`) }
      catch (error) { result[key] = `[unreadable property: ${error.message}]` }
    }
    return result
  }
  return JSON.stringify(encode(value, '$'), null, 2)
}

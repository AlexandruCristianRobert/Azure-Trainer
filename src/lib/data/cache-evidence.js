import { canonicalize } from '../labEngine/evidence.js'
const same = (a, b) => canonicalize(a) === canonicalize(b)
const owned = key => key.startsWith('ka:answer:') || key.startsWith('ka:sem:')
function decodePayload(value) {
  try {
    const text = value?.redisKind === 'bytes' ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))) : value
    return typeof text === 'string' ? JSON.parse(text) : undefined
  } catch { return undefined }
}
function acceptedSearch(call, body) {
  if (call.command !== 'FT.SEARCH' || call.error || !Array.isArray(call.value)) return []
  const candidates = []
  for (let position = 1; position < call.value.length; position += 2) {
    const fields = call.value[position + 1]
    if (!Array.isArray(fields)) continue
    const payloadPosition = fields.indexOf('payload')
    const payload = payloadPosition >= 0 ? decodePayload(fields[payloadPosition + 1]) : undefined
    if (payload !== undefined && same(payload, body)) candidates.push(call.value[position])
  }
  return candidates
}
export function acceptedReads(calls, provenance, body, beforeKeys, nowMs) {
  const writtenAt = new Map(Object.entries(beforeKeys).map(([key, entry]) => [key, entry.writtenAtMs]))
  const gets = []
  const searches = []
  for (const [callIndex, call] of calls.entries()) {
    if (call.error) continue
    // Capture age at the read, not from the request's initial or final state.
    // A later write cannot retroactively refresh an already returned payload.
    if (call.command === 'SET' && call.value === 'OK' || call.command === 'HSET' && Number.isInteger(call.value) && call.value >= 0) writtenAt.set(String(call.args[0]), nowMs)
    else if (call.command === 'DEL') for (const key of call.args) writtenAt.delete(String(key))
    else if (call.command === 'EXPIRE' && call.value === 1 && call.args[1] <= 0) writtenAt.delete(String(call.args[0]))
    else if (provenance?.callIndex === callIndex && provenance.kind === 'get' && call.command === 'GET' && call.value !== null
      && provenance.key === String(call.args[0]) && decodePayload(call.value) !== undefined && same(decodePayload(call.value), body)) {
      gets.push({ key: provenance.key, writtenAtMs: writtenAt.get(provenance.key) })
    } else if (provenance?.callIndex === callIndex && provenance.kind === 'search' && call.command === 'FT.SEARCH') {
      searches.push(...acceptedSearch(call, body).filter(key => String(key) === provenance.key).map(key => ({ key, writtenAtMs: writtenAt.get(String(key)) })))
    }
  }
  return { gets, searches }
}
// Separate bounded grading facts from the capped presentation trace. Replaying
// successful mutations identifies the keys actually removed, including DEL
// with absent/duplicate arguments, while HSET preserves an existing expiry.
export function cacheEffects(calls, beforeKeys, afterKeys, nowMs, complete) {
  const entries = new Map(Object.entries(beforeKeys).filter(([, entry]) => entry.expiresAtMs === null || entry.expiresAtMs > nowMs)
    .map(([key, entry]) => [key, { type: entry.type, expiresAtMs: entry.expiresAtMs }]))
  const writes = new Set()
  const removed = new Map()
  const scanPatterns = new Set()
  const hashWrittenKeys = new Set()
  let searchedSemanticDialect2 = false
  let setWithExpiry = false
  let expiryApplied = false
  let bounded = true
  const noteRemoval = (key, entry, command) => {
    if (!owned(key)) return
    const identity = JSON.stringify([key, command])
    if (!removed.has(identity) && removed.size >= 256) { bounded = false; return }
    removed.set(identity, { key, type: entry.type, command })
  }
  for (const call of calls) {
    if (call.error) continue
    const key = String(call.args[0])
    if (call.command === 'SCAN') {
      const matchIndex = call.args.indexOf('MATCH')
      if (matchIndex >= 0) scanPatterns.add(String(call.args[matchIndex + 1]))
    }
    if (call.command === 'FT.SEARCH' && call.args[0] === 'idx:semantic' && call.args.at(-2) === 'DIALECT' && Number(call.args.at(-1)) === 2) searchedSemanticDialect2 = true
    if (call.command === 'SET' && call.value === 'OK') {
      entries.set(key, { type: 'string', expiresAtMs: call.args[2] === 'EX' ? nowMs + Number(call.args[3]) * 1000 : null })
      setWithExpiry ||= call.args[2] === 'EX'
      if (owned(key)) writes.add(key)
    } else if (call.command === 'HSET' && Number.isInteger(call.value) && call.value >= 0) {
      hashWrittenKeys.add(key)
      entries.set(key, { type: 'hash', expiresAtMs: entries.get(key)?.expiresAtMs ?? null })
      if (owned(key)) writes.add(key)
    } else if (call.command === 'EXPIRE' && call.value === 1 && entries.has(key)) {
      expiryApplied = true
      if (Number(call.args[1]) <= 0) {
        noteRemoval(key, entries.get(key), 'EXPIRE')
        entries.delete(key)
      } else entries.get(key).expiresAtMs = nowMs + Number(call.args[1]) * 1000
    } else if (call.command === 'DEL' && Number.isInteger(call.value) && call.value > 0) {
      for (const argument of call.args) {
        const name = String(argument)
        if (!entries.has(name)) continue
        noteRemoval(name, entries.get(name), 'DEL')
        entries.delete(name)
      }
    }
  }
  if (writes.size > 256 || scanPatterns.size > 256 || hashWrittenKeys.size > 256) bounded = false
  const writtenKeys = [...writes].slice(0, 256).filter(key => afterKeys[key]
    && (afterKeys[key].expiresAtMs === null || afterKeys[key].expiresAtMs > nowMs))
    .map(key => ({ key, type: afterKeys[key].type }))
  let persistentKeys = 0
  let maxRemainingTtlSeconds = 0
  for (const entry of Object.values(afterKeys)) {
    if (entry.expiresAtMs === null) persistentKeys++
    else if (entry.expiresAtMs > nowMs) maxRemainingTtlSeconds = Math.max(maxRemainingTtlSeconds, (entry.expiresAtMs - nowMs) / 1000)
  }
  return { complete: complete && bounded, writtenKeys, removedKeys: [...removed.values()], persistentKeys, maxRemainingTtlSeconds,
    scanPatterns: [...scanPatterns].slice(0, 256), hashWrittenKeys: [...hashWrittenKeys].slice(0, 256), searchedSemanticDialect2, setWithExpiry, expiryApplied }
}

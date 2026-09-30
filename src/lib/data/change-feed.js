// Change feed log (ADR-0003, Task 7): a per-container append-only log that
// backs `query_items_change_feed` / `last_continuation` in runtime.js. Pure
// functions over a Sandbox container's `changeLog` array; no Azure calls.
//
// Latest-version mode: every write appends its own log entry (recordChange
// never coalesces at write time), but a read that spans several changes to
// the same id surfaces only the latest one in that scanned range - exactly
// like Cosmos DB's "Latest version" change feed mode. Deletes are never
// recorded (runtime.js has no delete_item write path into this log), so
// deletes are never surfaced.
import { cloneSandbox } from '../sandbox/model.js'
import { findContainer, partitionValue } from './cosmos-store.js'

const stripInternal = (item) => Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !key.startsWith('_')))

// Appends `{ lsn, id, partition, ts, body }` to `containerRef`'s change log
// and returns the updated Sandbox. `item` is the just-written internal item
// (as produced by cosmos-store's upsertItem), so it still carries `_ts`.
export function recordChange(sandbox, containerRef, item) {
  const next = cloneSandbox(sandbox)
  const container = findContainer(next, containerRef)
  if (!container) return sandbox
  if (!Array.isArray(container.changeLog)) container.changeLog = []
  const lsn = container.changeLog.reduce((max, entry) => Math.max(max, entry.lsn), 0) + 1
  container.changeLog.push({ lsn, id: item.id, partition: partitionValue(container, item), ts: item._ts ?? null, body: stripInternal(item) })
  return next
}

function collapseLatestVersion(entries, continuation) {
  const latestById = new Map()
  for (const entry of entries) latestById.set(entry.id, entry)
  return { items: [...latestById.values()].map((entry) => entry.body), continuation }
}

// `startTime`: 'Beginning' | 'Now' | a millisecond timestamp. `continuation`
// (a `"lsn:<n>"` token from a previous read, or from `last_continuation`)
// always wins over `startTime` when supplied. Every read scans up through
// the log's current end, so the returned continuation always resumes at
// "now" regardless of how the read's starting point was chosen.
export function readChangeFeed(container, { startTime, continuation } = {}) {
  const log = container?.changeLog ?? []
  const latestLsn = log.length ? log.at(-1).lsn : 0
  const nextContinuation = `lsn:${latestLsn}`
  if (typeof continuation === 'string') {
    const match = /^lsn:(\d+)$/.exec(continuation)
    const afterLsn = match ? Number(match[1]) : 0
    return collapseLatestVersion(log.filter((entry) => entry.lsn > afterLsn), nextContinuation)
  }
  if (startTime === 'Now') return { items: [], continuation: nextContinuation }
  if (typeof startTime === 'number') return collapseLatestVersion(log.filter((entry) => entry.ts !== null && entry.ts >= startTime), nextContinuation)
  // 'Beginning', or no starting point supplied at all: scan the whole log.
  return collapseLatestVersion(log, nextContinuation)
}

// The `changeFeed` hook shape runtime.js expects (see its module comment).
export const CHANGE_FEED_HOOK = { read: readChangeFeed, recordChange }

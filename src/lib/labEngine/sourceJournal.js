import { getProjectManifest } from '../project/manifests.js'
import { fail } from './errors.js'

export const MAX_SOURCE_SAVES = 512

export function sourceTextHash(text) {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 0x01000193) >>> 0
    second = Math.imul(second ^ first, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`.repeat(4)
}

export function sourceVersionsAt(journal, sequence) {
  const versions = {}
  for (const event of journal) {
    if (event.sequence >= sequence) break
    versions[event.path] = event.version
  }
  return versions
}

export function validateSourceJournal(run, lab) {
  const journal = run.project.sourceJournal
  const manifest = getProjectManifest(run.project.manifestId)
  if (!Array.isArray(journal) || journal.length > MAX_SOURCE_SAVES) fail('INVALID_RUN', 'Capstone source save journal is missing or oversized.')
  const versions = {}
  const lastHashes = {}
  let previousSequence = 0
  for (const event of journal) {
    if (!event || typeof event !== 'object' || Array.isArray(event)
      || Object.keys(event).sort().join('|') !== 'hash|path|sequence|version'
      || !manifest.files.includes(event.path)
      || !Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence || event.sequence >= run.nextSequence
      || !Number.isSafeInteger(event.version) || event.version !== (versions[event.path] ?? 0) + 1
      || typeof event.hash !== 'string' || !/^[0-9a-f]{64}$/.test(event.hash)) {
      fail('INVALID_RUN', 'Capstone source save journal has invalid causal records.')
    }
    versions[event.path] = event.version
    lastHashes[event.path] = event.hash
    previousSequence = event.sequence
  }
  if (JSON.stringify(Object.entries(versions).sort()) !== JSON.stringify(Object.entries(run.project.fileVersions).sort()))
    fail('INVALID_RUN', 'Capstone saved file versions disagree with source history.')
  const initial = lab.initialProjectFiles ?? {}
  if (JSON.stringify(Object.keys(initial).sort()) !== JSON.stringify(Object.keys(run.project.savedFiles).sort()))
    fail('INVALID_RUN', 'Capstone saved file paths disagree with the Lab source.')
  for (const [path, text] of Object.entries(run.project.savedFiles)) {
    if (typeof text !== 'string' || (lastHashes[path]
      ? sourceTextHash(text) !== lastHashes[path]
      : text !== initial[path])) fail('INVALID_RUN', 'Capstone saved source disagrees with its save history.')
  }
  return journal
}

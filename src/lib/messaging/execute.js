import { parseMessagingProject } from './python.js'
import { executeMessagingProgram } from './vm.js'
import { MESSAGING_RUNTIME_FILES } from '../../data/templates/messaging-python/runtime.js'
import { finiteJson, plainObject } from './state.js'

/** Source execution only. Shell/evidence/grading integration is owned by later adapters. */
export function executeMessagingEntry(run, lab, entry, mode = 'script', internalInput = {}) {
  if (!plainObject(internalInput) || !finiteJson(internalInput) || Object.keys(internalInput).some(key => key !== 'deliveryId')
    || (internalInput.deliveryId !== undefined && (mode !== 'eventgrid-handler' || typeof internalInput.deliveryId !== 'string' || !/^eg-delivery-[1-9]\d*$/.test(internalInput.deliveryId)))) {
    const diagnostic = { code: 'MESSAGING_CONFIG', message: 'Internal handler input accepts only an actual deliveryId.', path: entry, line: 1, column: 1 }
    return { run, lines: [`${entry}:1:1 ${diagnostic.code}: ${diagnostic.message}`], portalEvents: [], diagnostics: [diagnostic] }
  }
  const parsed = parseMessagingProject(run.project.savedFiles, { entry, mode, fixedFiles: MESSAGING_RUNTIME_FILES })
  if (parsed.diagnostics.length) return { run, lines: parsed.diagnostics.map(d => `${d.path}:${d.line}:${d.column} ${d.code}: ${d.message}`), portalEvents: [], diagnostics: parsed.diagnostics }
  const result = executeMessagingProgram({ program: parsed.program, state: run.runtime.messaging, sandbox: run.sandbox, input: { ...(lab.messagingInput ?? {}), ...internalInput } })
  const next = result.state === run.runtime.messaging ? run : { ...run, runtime: { ...run.runtime, messaging: result.state } }
  const lines = [...result.output, ...result.trace.map(record => `${record.kind}: ${record.messageId ?? record.entityId ?? record.deliveryId ?? record.eventRecordId ?? ''}${record.timing ? ' (logical simulator ticks)' : ''}`)]
  lines.push(...result.diagnostics.map(d => `${d.path}:${d.line}:${d.column} ${d.code}: ${d.message}`))
  if (!result.diagnostics.length) lines.push(`${entry}: completed in the bounded messaging simulator.`)
  return { run: next, lines, portalEvents: [], diagnostics: result.diagnostics }
}

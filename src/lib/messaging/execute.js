import { parseMessagingProject } from './python.js'
import { executeMessagingProgram } from './vm.js'
import { MESSAGING_RUNTIME_FILES } from '../../data/templates/messaging-python/runtime.js'

/** Source execution only. Shell/evidence/grading integration is owned by later adapters. */
export function executeMessagingEntry(run, lab, entry, mode = 'script') {
  const parsed = parseMessagingProject(run.project.savedFiles, { entry, mode, fixedFiles: MESSAGING_RUNTIME_FILES })
  if (parsed.diagnostics.length) return { run, lines: parsed.diagnostics.map(d => `${d.path}:${d.line}:${d.column} ${d.code}: ${d.message}`), portalEvents: [], diagnostics: parsed.diagnostics }
  const result = executeMessagingProgram({ program: parsed.program, state: run.runtime.messaging, sandbox: run.sandbox, input: lab.messagingInput ?? {} })
  const next = result.state === run.runtime.messaging ? run : { ...run, runtime: { ...run.runtime, messaging: result.state } }
  const lines = [...result.output, ...result.trace.map(record => `${record.kind}: ${record.messageId ?? record.entityId ?? ''}`)]
  lines.push(...result.diagnostics.map(d => `${d.path}:${d.line}:${d.column} ${d.code}: ${d.message}`))
  if (!result.diagnostics.length) lines.push(`${entry}: completed in the bounded messaging simulator.`)
  return { run: next, lines, portalEvents: [], diagnostics: result.diagnostics }
}

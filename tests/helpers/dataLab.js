// Thin wrapper over the existing behavioral replay helper (see
// tests/helpers/aks.js's `executeAksSolution`/`act`), for the Data journey's
// `data-request`/`data-worker` scenario kind instead of `aks-request`.
import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { createBehavioralRun } from '../../src/lib/labEngine/run.js'
import { evaluateLab } from '../../src/lib/labEngine/evaluate.js'

function act(run, lab, action) {
  const result = applyRunAction(run, action, lab)
  if (result.diagnostics.length || result.lines.some((line) => line.kind === 'err')) {
    throw new Error(`Data Lab action failed ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines.filter((line) => line.kind === 'err') })}`)
  }
  return result.run
}

/** Creates a run for the Lab, applies every Task's Solution steps in Task
 * order (`file` -> save-file, `command` -> command, `scenario` -> the
 * data-request/data-worker dispatch named by the scenario it targets), then
 * evaluates the Lab. Mirrors `executeAksSolution`'s step kinds. */
export function replaySolution(lab, { attemptId = `${lab.id}-replay` } = {}) {
  let run = createBehavioralRun(lab, { attemptId })
  for (const task of lab.tasks) {
    for (const step of task.solution?.steps ?? []) {
      if (step.kind === 'file') run = act(run, lab, { type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') run = act(run, lab, { type: 'command', line: step.line })
      else if (step.kind === 'scenario') {
        const scenarioKind = lab.scenarios?.[step.scenarioId]?.kind ?? 'data-request'
        run = act(run, lab, { type: scenarioKind, scenarioId: step.scenarioId })
      } else throw new Error(`Unsupported data Lab solution step: ${step.kind}`)
    }
  }
  return { run, state: evaluateLab(lab, run) }
}

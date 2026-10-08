import { describe, expect, it } from 'vitest'
import { MESSAGING_LABS } from '../src/data/labs/messaging-journey/index.js'
import { SECURITY_OBSERVABILITY_LABS } from '../src/data/labs/security-journey/index.js'
import { HTTP_FUNCTIONS_LABS } from '../src/data/labs/http-functions-journey/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { taskExamNote } from '../src/lib/taskExamNote.js'

describe('learner progression through messaging and newer journeys', () => {
  for (const lab of [...MESSAGING_LABS, ...SECURITY_OBSERVABILITY_LABS, ...HTTP_FUNCTIONS_LABS]) {
    it(`${lab.id} unlocks each next task using only the current task solution`, () => {
      let run = createBehavioralRun(lab, { attemptId: `progression-${lab.id}` })
      for (const [index, task] of lab.tasks.entries()) {
        for (const step of task.solution.steps) {
          expect(['file', 'command']).toContain(step.kind)
          run = applyRunAction(run, step.kind === 'file'
            ? { type: 'save-file', path: step.path, text: step.content }
            : { type: 'command', line: step.line }, lab).run
        }
        const evaluation = evaluateLab(lab, run)
        expect(evaluation.tasks[index].done, `${task.id}: ${evaluation.tasks[index].reason}`).toBe(true)
        expect(evaluation.tasks.slice(0, index + 1).every(row => row.done), `${task.id} invalidated earlier tasks`).toBe(true)
        expect(taskExamNote(task)).toBeTruthy()
        run = deserializeRun(serializeRun(run, lab), lab)
        expect(evaluateLab(lab, run).tasks[index].done).toBe(true)
      }
      expect(evaluateLab(lab, run).isComplete).toBe(true)
    })
  }
})

import { getProjectManifest } from '../project/manifests.js'
import { finiteJson, plainObject } from './state.js'

const entries = ['producer.py', 'worker.py', 'events.py', 'handler.py', 'function_app.py']
export function messagingCommandAllowed(run, lab, entry, mode) {
  return lab?.capabilities?.messaging === true && getProjectManifest(run?.project?.manifestId)?.runtimeFamily === 'messaging'
    && entries.includes(entry) && (mode === 'script' && entry !== 'function_app.py' || mode === 'functions' && entry === 'function_app.py')
    && lab.messagingExercise?.commands?.some(command => command.entry === entry && command.mode === mode) === true
}

export function validateMessagingExercise(lab) {
  const exercise = lab.messagingExercise
  if (exercise === undefined) return true
  if (lab.capabilities?.messaging !== true || !plainObject(exercise)
    || Object.keys(exercise).some(key => !['commands', 'tasks', 'expectedFailures'].includes(key))
    || !Array.isArray(exercise.commands) || exercise.commands.length < 1 || exercise.commands.length > 5
    || !Array.isArray(exercise.tasks) || exercise.tasks.length > lab.tasks.length) return false
  const commands = new Set()
  for (const command of exercise.commands) {
    if (!finiteJson(command) || !plainObject(command) || Object.keys(command).length !== 2
      || !entries.includes(command.entry) || !['entry', 'mode'].every(key => Object.hasOwn(command, key))
      || !(command.mode === 'script' && command.entry !== 'function_app.py' || command.mode === 'functions' && command.entry === 'function_app.py'
        || lab.capabilities?.httpFunctions === true && command.mode === 'http-handler' && command.entry === 'function_app.py')) return false
    const key = `${command.mode}:${command.entry}`
    if (commands.has(key)) return false
    commands.add(key)
  }
  const tasks = new Set()
  for (const item of exercise.tasks) {
    const task = lab.tasks.find(task => task.id === item?.taskId)
    if (!plainObject(item) || Object.keys(item).length !== 6
      || Object.keys(item).some(key => !['taskId', 'scenarioId', 'scenarioVersion', 'entry', 'mode', 'check'].includes(key))
      || !task?.verification || task.verification.scenarioId !== item.scenarioId || task.verification.scenarioVersion !== item.scenarioVersion
      || !commands.has(`${item.mode}:${item.entry}`) || typeof item.check !== 'function' || tasks.has(item.taskId)) return false
    tasks.add(item.taskId)
  }
  const failures = exercise.expectedFailures ?? []
  return Array.isArray(failures) && failures.length <= 50 && failures.every(item => plainObject(item) && finiteJson(item)
    && (item.kind === 'servicebus' ? Object.keys(item).sort().join(',') === 'entityId,kind,messageId'
      && typeof item.entityId === 'string' && typeof item.messageId === 'string'
      : item.kind === 'eventgrid' && Object.keys(item).sort().join(',') === 'eventId,kind,subscriptionId'
        && typeof item.subscriptionId === 'string' && typeof item.eventId === 'string'))
}

/** Shell declares intent only. Saved source execution belongs to the engine. */
export function runMessagingShell(sandbox, command, args, context) {
  const entry = command === 'func' ? 'function_app.py' : args[0]
  const mode = command === 'func' ? 'functions' : 'script'
  const accepted = args.length === 1 && (command !== 'func' || args[0] === 'start')
    && messagingCommandAllowed(context.run, context.lab, entry, mode)
  return { sandbox, events: [], latencyMs: 0, clear: false,
    lines: accepted ? [] : [{ text: 'messaging: use a declared Python entry or func start.', kind: 'err' }],
    effects: accepted ? [{ type: 'messaging-execution', entry, mode }] : [] }
}

import { parser } from '@lezer/python'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const blocked = new Set(['__proto__', 'constructor', 'prototype'])
export function messagingError(code, message, loc = {}) {
  return Object.assign(new Error(message), { diagnostic: { code, message, path: loc.path ?? '', line: loc.line ?? null, column: loc.column ?? null } })
}
export function safeKey(key, loc) {
  if (typeof key !== 'string' && !Number.isSafeInteger(key)) throw messagingError('MESSAGING_RUNTIME', 'An index must be a string or integer.', loc)
  if (blocked.has(String(key))) throw messagingError('MESSAGING_UNSUPPORTED', `Unsafe property '${key}' is not supported.`, loc)
  return key
}

// Shared static/runtime call contract. Later SDK adapters add explicit signatures,
// imported exports and dispatch branches here; arbitrary host objects are never callable.
export const SDK_SIGNATURES = Object.freeze({
  DefaultAzureCredential: [[], 0, 'credential'],
  ServiceBusClient: [['fully_qualified_namespace', 'credential'], 2, 'bus'],
  ServiceBusMessage: [['body', 'message_id', 'session_id', 'application_properties'], 1, 'outgoing'],
  EventGridPublisherClient: [['endpoint', 'credential'], 2, 'publisher'],
  EventGridEvent: [['subject', 'event_type', 'data', 'data_version', 'id'], 4, 'event'],
  'publisher.send': [['events'], 1, 'data'],
  deliver_events: [['handler'], 1, 'data'],
  FunctionApp: [[], 0, 'functionapp'],
  'functionmessage.get_body': [[], 0, 'bytes'],
  'functionevent.get_json': [[], 0, 'data'],
  'functionapp.function_name': [['name'], 1, 'data'],
  'functionapp.service_bus_queue_trigger': [['arg_name', 'queue_name', 'connection'], 3, 'data'],
  'functionapp.event_grid_trigger': [['arg_name'], 1, 'data'],
  'bus.get_queue_sender': [['queue_name'], 1, 'sender'],
  'bus.get_topic_sender': [['topic_name'], 1, 'sender'],
  'bus.get_queue_receiver': [['queue_name', 'sub_queue', 'session_id', 'max_wait_time'], 1, 'receiver'],
  'bus.get_subscription_receiver': [['topic_name', 'subscription_name', 'sub_queue', 'max_wait_time'], 2, 'receiver'],
  'sender.send_messages': [['messages'], 1, 'data'],
  'receiver.receive_messages': [['max_message_count', 'max_wait_time'], 0, 'receipts'],
  'receiver.complete_message': [['message'], 1, 'data'],
  'receiver.abandon_message': [['message'], 1, 'data'],
  'receiver.dead_letter_message': [['message', 'reason', 'error_description'], 1, 'data'],
  'bytes.decode': [['encoding'], 0, 'data'],
  'json.dumps': [['obj'], 1, 'data'],
  'json.loads': [['s'], 1, 'data'],
  str: [['object'], 1, 'data'], len: [['object'], 1, 'data'],
  print: [null, 0, 'data'], ValueError: [['message'], 1, 'error'],
  perform_order_work: [['order'], 1, 'data'], record_processed: [['order'], 1, 'data'],
  was_processed: [['order_id'], 1, 'data'], record_notification: [['event_id', 'order_id'], 2, 'data'],
  handler_status: [['order_id'], 1, 'data'],
})
export const SDK_EXPORTS = Object.freeze({
  'azure.identity': ['DefaultAzureCredential'],
  'azure.servicebus': ['ServiceBusClient', 'ServiceBusMessage', 'ServiceBusSubQueue'],
  'azure.eventgrid': ['EventGridPublisherClient', 'EventGridEvent'],
  'azure.functions': ['FunctionApp', 'ServiceBusMessage', 'EventGridEvent'],
  json: ['dumps', 'loads'],
  training_runtime: ['perform_order_work', 'record_processed', 'was_processed', 'record_notification', 'handler_status', 'deliver_events'],
})
export function bindArguments(names, required, args, kwargs, loc) {
  if (names === null) {
    if (Object.keys(kwargs).length) throw messagingError('MESSAGING_UNSUPPORTED', 'Keyword arguments are not supported for print.', loc)
    return args
  }
  if (args.length > names.length) throw messagingError('MESSAGING_UNSUPPORTED', 'Too many positional arguments.', loc)
  const bound = Object.create(null)
  args.forEach((value, index) => { bound[names[index]] = value })
  for (const [key, value] of Object.entries(kwargs)) {
    if (!names.includes(key) || own(bound, key)) throw messagingError('MESSAGING_UNSUPPORTED', `Unknown or repeated argument '${key}'.`, loc)
    bound[key] = value
  }
  for (const name of names.slice(0, required)) if (!own(bound, name)) throw messagingError('MESSAGING_UNSUPPORTED', `Missing argument '${name}'.`, loc)
  return bound
}

const children = node => { const result = []; for (let c = node.firstChild; c; c = c.nextSibling) if (c.name !== 'Comment') result.push(c); return result }
const data = Object.freeze({ type: 'data' })
const typed = type => type === 'receipts' ? { type: 'list', element: { type: 'receipt' } } : { type }
const callable = name => ({ type: 'callable', name })
const external = module => ({ type: 'module', module })
const mergeTypes = values => {
  if (!values.length) return data
  const first = values[0] ?? data
  return values.every(value => JSON.stringify(value ?? data) === JSON.stringify(first)) ? first : data
}

export function parseMessagingProject(files, { entry, mode = 'script', fixedFiles = {} } = {}) {
  const program = { entry, mode, functions: Object.create(null), globals: Object.create(null), imports: Object.create(null), sourcePaths: [], handlers: [] }
  const modules = new Map(), definitions = new Map(), analyzing = new Map()
  let location = { path: entry, line: 1, column: 1 }, analysisSteps = 0, moduleScope = false
  const unsupported = (message, loc = location) => { throw messagingError('MESSAGING_UNSUPPORTED', message, loc) }
  const tick = loc => { if (++analysisSteps > 10000) throw messagingError('MESSAGING_LIMIT', 'Source analysis exceeds 10,000 steps.', loc) }
  const text = (node, path) => files[path].slice(node.from, node.to)
  const loc = (node, path) => {
    const before = files[path].slice(0, node.from), lines = before.split('\n')
    return { path, line: lines.length, column: lines.at(-1).length + 1 }
  }
  function stringValue(raw, at) {
    const match = /^([bB]?)("""|'''|"|')/.exec(raw)
    if (!match) unsupported('Only ordinary strings and byte literals are supported.', at)
    const quote = match[2], body = raw.slice(match[0].length, -quote.length)
    let value = ''
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '\\') { value += body[i]; continue }
      const c = body[++i], escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" }
      if (own(escapes, c)) value += escapes[c]
      else if ((c === 'u' || c === 'x') && new RegExp(`^[0-9a-fA-F]{${c === 'u' ? 4 : 2}}$`).test(body.slice(i + 1, i + 1 + (c === 'u' ? 4 : 2)))) {
        const count = c === 'u' ? 4 : 2; value += String.fromCharCode(parseInt(body.slice(i + 1, i + count + 1), 16)); i += count
      } else unsupported('Unsupported string escape.', at)
    }
    return { kind: match[1] ? 'bytes' : 'literal', value, loc: at }
  }
  function expr(node, path, depth = 0) {
    const at = loc(node, path); tick(at)
    if (depth > 100) throw messagingError('MESSAGING_LIMIT', 'Expression nesting exceeds 100.', at)
    const c = children(node), lower = n => expr(n, path, depth + 1), source = text(node, path)
    switch (node.name) {
      case 'VariableName': safeKey(source, at); return { kind: 'name', name: source, loc: at }
      case 'String': return stringValue(source, at)
      case 'Number': {
        const value = Number(source.replace(/_/g, ''))
        if (!Number.isSafeInteger(value)) unsupported('Only safe integer literals are supported.', at)
        return { kind: 'literal', value, loc: at }
      }
      case 'Boolean': return { kind: 'literal', value: source === 'True', loc: at }
      case 'None': return { kind: 'literal', value: null, loc: at }
      case 'ParenthesizedExpression': return lower(c[1])
      case 'ArrayExpression': return { kind: 'list', items: c.filter(n => !['[', ']', ','].includes(n.name)).map(lower), loc: at }
      case 'DictionaryExpression': {
        const items = c.filter(n => !['{', '}', ',', ':'].includes(n.name))
        if (items.length % 2) unsupported('Dictionary unpacking is unsupported.', at)
        const entries = []
        for (let i = 0; i < items.length; i += 2) {
          const key = lower(items[i])
          if (key.kind === 'literal') safeKey(key.value, key.loc)
          entries.push([key, lower(items[i + 1])])
        }
        return { kind: 'dict', entries, loc: at }
      }
      case 'MemberExpression': {
        if (c[1]?.name === '.') { const name = text(c[2], path); safeKey(name, at); return { kind: 'attribute', object: lower(c[0]), name, loc: at } }
        if (c.length !== 4) unsupported('Slices are not supported.', at)
        const index = lower(c[2]); if (index.kind === 'literal') safeKey(index.value, at)
        return { kind: 'index', object: lower(c[0]), index, loc: at }
      }
      case 'CallExpression': {
        const parts = children(c[1]).filter(n => !['(', ')', ','].includes(n.name)), args = [], kwargs = Object.create(null)
        for (let i = 0; i < parts.length; i++) {
          if (parts[i + 1]?.name === 'AssignOp') {
            const name = text(parts[i], path); safeKey(name, at)
            if (own(kwargs, name)) unsupported(`Repeated keyword '${name}'.`, at)
            kwargs[name] = lower(parts[i + 2]); i += 2
          } else {
            if (Object.keys(kwargs).length) unsupported('Positional argument after keyword.', at)
            args.push(lower(parts[i]))
          }
        }
        return { kind: 'call', callee: lower(c[0]), args, kwargs, loc: at }
      }
      case 'BinaryExpression': {
        const op = c.slice(1, -1).map(n => text(n, path)).join(' ')
        if (c.length !== 3 && !(c.length === 4 && ['not in', 'is not'].includes(op))) unsupported('Chained comparisons are not supported.', at)
        if (!['+', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'in', 'not in', 'is', 'is not'].includes(op)) unsupported(`Operator '${op}' is not supported.`, at)
        return { kind: 'binary', op, left: lower(c[0]), right: lower(c.at(-1)), loc: at }
      }
      case 'UnaryExpression': {
        const op = text(c[0], path); if (!['not', '-', '+'].includes(op)) unsupported(`Operator '${op}' is not supported.`, at)
        return { kind: 'unary', op, value: lower(c[1]), loc: at }
      }
      default: unsupported(`Unsupported expression: ${node.name}.`, at)
    }
  }
  function statements(node, path, depth = 0) {
    if (depth > 100) throw messagingError('MESSAGING_LIMIT', 'Statement nesting exceeds 100.', loc(node, path))
    return (Array.isArray(node) ? node : children(node)).filter(n => ![':', 'Comment'].includes(n.name)).map(n => {
      const c = children(n), at = loc(n, path), e = x => expr(x, path), body = x => statements(x, path, depth + 1)
      switch (n.name) {
        case 'AssignStatement': {
          const op = c.findIndex(x => x.name === 'AssignOp')
          if (op < 1 || text(c[op], path) !== '=' || c.length !== op + 2 || c.slice(1, op).some(x => x.name !== 'TypeDef')) unsupported('Only simple assignments are supported.', at)
          c.slice(1, op).forEach(annotation => simpleAnnotation(annotation, path))
          const target = e(c[0]); if (!['name', 'index'].includes(target.kind)) unsupported('Only names and dictionary/list indices can be assigned.', at)
          return { kind: 'assign', target, value: e(c[op + 1]), loc: at }
        }
        case 'ExpressionStatement': return { kind: 'expression', value: e(c[0]), loc: at }
        case 'PassStatement': return { kind: 'pass', loc: at }
        case 'ReturnStatement': return { kind: 'return', value: c[1] ? e(c[1]) : { kind: 'literal', value: null, loc: at }, loc: at }
        case 'RaiseStatement': return { kind: 'raise', value: e(c[1]), loc: at }
        case 'WithStatement': {
          if (c.length !== 5 || c[2].name !== 'as' || c[3].name !== 'VariableName') unsupported('Use one with resource and an explicit alias.', at)
          return { kind: 'with', value: e(c[1]), name: text(c[3], path), body: body(c[4]), loc: at }
        }
        case 'ForStatement': {
          if (c.length !== 5 || c[1].name !== 'VariableName') unsupported('Use a simple bounded for loop.', at)
          return { kind: 'for', name: text(c[1], path), value: e(c[3]), body: body(c[4]), loc: at }
        }
        case 'IfStatement': {
          const branches = []; let otherwise = []
          for (let i = 0; i < c.length;) {
            if (c[i].name === 'else') { otherwise = body(c[i + 1]); i += 2 }
            else { branches.push({ test: e(c[i + 1]), body: body(c[i + 2]) }); i += 3 }
          }
          return { kind: 'if', branches, otherwise, loc: at }
        }
        default: unsupported(`Unsupported statement: ${n.name}.`, at)
      }
    })
  }
  function imports(node, path) {
    const c = children(node), split = c.findIndex(n => n.name === 'import'), from = c[0].name === 'from'
    const module = from ? c.slice(1, split).map(n => text(n, path)).join('') : null
    const parts = c.slice(split + 1).filter(n => !['(', ')'].includes(n.name)), result = []
    for (let i = 0; i < parts.length;) {
      const names = []
      while (i < parts.length && ![',', 'as'].includes(parts[i].name)) names.push(text(parts[i++], path))
      const name = names.join(''); let alias = from ? name : name.split('.')[0]
      if (parts[i]?.name === 'as') { alias = text(parts[i + 1], path); i += 2 }
      if (parts[i]?.name === ',') i++
      if (!name || name === '*') unsupported('Star imports are unsupported.', loc(node, path))
      safeKey(alias, loc(node, path)); safeKey(name, loc(node, path))
      result.push({ module: module ?? name, name: from ? name : null, alias, loc: loc(node, path) })
    }
    return result
  }
  function importedType(item) {
    if (own(SDK_EXPORTS, item.module)) {
      if (item.module === 'training_runtime' && !program.sourcePaths.includes('training_runtime.py')) program.sourcePaths.push('training_runtime.py')
      if (!item.name) return external(item.module.startsWith(`${item.alias}.`) ? item.alias : item.module)
      if (!SDK_EXPORTS[item.module].includes(item.name)) unsupported(`Unsupported import '${item.name}'.`, item.loc)
      if (item.module === 'azure.functions' && item.name !== 'FunctionApp') return typed(item.name === 'ServiceBusMessage' ? 'functionmessageType' : 'functioneventType')
      if (item.name === 'ServiceBusSubQueue') return typed('subqueue')
      return callable(item.module === 'json' ? `json.${item.name}` : item.name)
    }
    const path = `${item.module.replace(/\./g, '/')}.py`
    if (!own(files, path)) unsupported(`Unsupported or missing module '${item.module}'.`, item.loc)
    const env = loadModule(path)
    if (!item.name) return { type: 'localmodule', path }
    if (!env.has(item.name)) unsupported(`Module '${item.module}' has no '${item.name}'.`, item.loc)
    return env.get(item.name)
  }
  function infer(node, env, path) {
    tick(node.loc)
    switch (node.kind) {
      case 'literal': return { type: 'data', constant: node.value }
      case 'bytes': return typed('bytes')
      case 'name': {
        if (env.has(node.name)) return env.get(node.name)
        if (['str', 'len', 'print', 'ValueError'].includes(node.name)) return callable(node.name)
        unsupported(`Unbound name '${node.name}'.`, node.loc); break
      }
      case 'list': { const items = node.items.map(item => infer(item, env, path)); return { type: 'list', element: mergeTypes(items) } }
      case 'dict': node.entries.forEach(pair => pair.forEach(item => infer(item, env, path))); return data
      case 'index': { const object = infer(node.object, env, path); infer(node.index, env, path); return object.element ?? data }
      case 'unary': infer(node.value, env, path); return data
      case 'binary': infer(node.left, env, path); infer(node.right, env, path); return data
      case 'attribute': {
        const object = infer(node.object, env, path)
        if (object.type === 'module') {
          if (own(SDK_EXPORTS, `${object.module}.${node.name}`)) return external(`${object.module}.${node.name}`)
          return importedType({ module: object.module, name: node.name, loc: node.loc })
        }
        if (object.type === 'localmodule') {
          const member = modules.get(object.path)?.get(node.name)
          if (member) return member
        }
        if (object.type === 'subqueue' && node.name === 'DEAD_LETTER') return data
        if (object.type === 'receipt' && ['body', 'message_id', 'session_id', 'application_properties', 'delivery_count', 'dead_letter_reason', 'dead_letter_error_description'].includes(node.name)) return node.name === 'body' ? typed('bytes') : data
        if (object.type === 'event' && ['id', 'data', 'subject', 'event_type', 'data_version'].includes(node.name)) return data
        if (object.type === 'functionevent' && ['id', 'subject', 'event_type', 'data_version'].includes(node.name)) return data
        if (object.type === 'functionmessage' && ['message_id', 'delivery_count', 'application_properties'].includes(node.name)) return data
        const name = `${object.type}.${node.name}`
        if (own(SDK_SIGNATURES, name)) return callable(name)
        unsupported(`Unsupported member '${node.name}' on ${object.type}.`, node.loc); break
      }
      case 'call': {
        const target = infer(node.callee, env, path), args = node.args.map(arg => infer(arg, env, path))
        const kwargs = Object.fromEntries(Object.entries(node.kwargs).map(([key, value]) => [key, infer(value, env, path)]))
        if (moduleScope && (target.type !== 'callable' || !['DefaultAzureCredential', 'ServiceBusClient', 'ServiceBusMessage', 'EventGridPublisherClient', 'EventGridEvent', 'FunctionApp', 'bus.get_queue_sender', 'bus.get_topic_sender', 'bus.get_queue_receiver', 'bus.get_subscription_receiver', 'json.dumps', 'json.loads', 'str', 'len'].includes(target.name))) unsupported('Module scope allows constants and supported constructors, not application effects.', node.loc)
        if (target.type === 'function') return analyzeFunction(target.id, args, kwargs, node.loc)
        if (target.type !== 'callable' || !own(SDK_SIGNATURES, target.name)) unsupported('Only resolved local functions and supported SDK calls are callable.', node.loc)
        if (target.name.startsWith('functionapp.')) unsupported('Functions decorator factories are supported only as registration metadata.', node.loc)
        const [names, required, returns] = SDK_SIGNATURES[target.name]
        const bound = bindArguments(names, required, args, kwargs, node.loc)
        if (target.name === 'deliver_events') {
          if (bound.handler?.type !== 'function') unsupported('deliver_events requires an actual local handler function.', node.loc)
          analyzeFunction(bound.handler.id, [typed('event')], {}, node.loc)
        }
        return typed(returns)
      }
    }
    unsupported('Unknown expression record.', node.loc)
  }
  function analyzeStatements(body, env, path) {
    const returns = []
    let fallsThrough = true
    for (const statement of body) {
      tick(statement.loc)
      if (statement.kind === 'pass') continue
      if (statement.kind === 'if') {
        // Validate every possible branch before any broker operations can run.
        const branches = [], flows = []
        for (const branch of statement.branches) {
          infer(branch.test, env, path)
          const local = new Map(env), result = analyzeStatements(branch.body, local, path)
          if (fallsThrough) returns.push(...result.returns)
          flows.push(result.fallsThrough)
          branches.push(local)
        }
        const local = new Map(env), result = analyzeStatements(statement.otherwise, local, path)
        if (fallsThrough) returns.push(...result.returns)
        flows.push(result.fallsThrough)
        branches.push(local)
        for (const key of new Set(branches.flatMap(branch => [...branch.keys()]))) env.set(key, mergeTypes(branches.map(branch => branch.get(key))))
        fallsThrough = fallsThrough && flows.some(Boolean)
        continue
      }
      const value = infer(statement.value, env, path)
      if (statement.kind === 'assign') {
        if (statement.target.kind === 'name') env.set(statement.target.name, value)
        else {
          const object = infer(statement.target.object, env, path)
          infer(statement.target.index, env, path)
          // List aliases share their abstract element record; writing through any
          // alias must not preserve a stale callable/SDK receiver type.
          if (object.type === 'list') object.element = mergeTypes([object.element, value])
        }
      } else if (statement.kind === 'for' || statement.kind === 'with') {
        safeKey(statement.name, statement.loc)
        if (statement.kind === 'with' && !['bus', 'sender', 'receiver'].includes(value.type)) unsupported('Only SDK resources support with.', statement.loc)
        if (statement.kind === 'for' && value.type !== 'list' && value.type !== 'data') unsupported('For requires a bounded list.', statement.loc)
        const before = new Map(env)
        env.set(statement.name, statement.kind === 'for' ? value.element ?? data : value)
        const result = analyzeStatements(statement.body, env, path)
        if (fallsThrough) returns.push(...result.returns)
        if (statement.kind === 'with') fallsThrough = fallsThrough && result.fallsThrough
        if (statement.kind === 'for') for (const key of env.keys()) env.set(key, mergeTypes([before.get(key), env.get(key)]))
      } else if (statement.kind === 'return') {
        if (fallsThrough) returns.push(value)
        fallsThrough = false
      } else if (statement.kind === 'raise') {
        if (value.type !== 'error') unsupported('Only raise ValueError is supported.', statement.loc)
        fallsThrough = false
      }
    }
    return { returns, fallsThrough }
  }
  function analyzeFunction(id, args, kwargs, at) {
    const definition = definitions.get(id)
    if (!own(program.functions, id)) {
      const c = children(definition.node)
      if (c.some(n => n.name === 'async')) unsupported('Async functions are not supported.', loc(definition.node, definition.path))
      const paramsNode = c.find(n => n.name === 'ParamList'), params = children(paramsNode).filter(n => !['(', ')', ',', 'TypeDef'].includes(n.name))
      const annotations = Object.create(null)
      for (const annotation of c.filter(n => n.name === 'TypeDef')) simpleAnnotation(annotation, definition.path)
      const paramParts = children(paramsNode)
      for (let index = 0; index < paramParts.length; index++) if (paramParts[index].name === 'TypeDef') {
        const annotation = paramParts[index], parts = children(annotation).filter(n => n.name !== ':')
        if (mode === 'functions') {
          if (parts.length !== 1 || !['VariableName', 'MemberExpression'].includes(parts[0].name)) unsupported('Functions annotations must resolve supported type names.', loc(annotation, definition.path))
          const lowered = expr(parts[0], definition.path)
          annotations[text(paramParts[index - 1], definition.path)] = { expression: lowered, type: infer(lowered, modules.get(definition.path), definition.path).type, loc: loc(annotation, definition.path) }
        } else simpleAnnotation(annotation, definition.path)
      }
      if (params.some(n => n.name !== 'VariableName')) unsupported('Only simple named parameters are supported.', loc(paramsNode, definition.path))
      const names = params.map(n => safeKey(text(n, definition.path), loc(n, definition.path)))
      program.functions[id] = { name: definition.name, path: definition.path, params: names, annotations, decorators: definition.decorators ?? [], body: statements(c.find(n => n.name === 'Body'), definition.path), loc: loc(definition.node, definition.path) }
    }
    const fn = program.functions[id], bound = bindArguments(fn.params, fn.params.length, args, kwargs, at)
    const argumentTypes = JSON.stringify(bound, (key, value) => key === 'constant' ? undefined : value)
    if (analyzing.has(id)) {
      if (analyzing.get(id) !== argumentTypes) unsupported('Recursive calls must preserve their argument types.', at)
      return data
    }
    if (analyzing.size >= 100) throw messagingError('MESSAGING_LIMIT', 'Local call analysis exceeds 100 frames.', at)
    analyzing.set(id, argumentTypes)
    const env = new Map(modules.get(fn.path)); Object.entries(bound).forEach(([key, value]) => env.set(key, value))
    const result = analyzeStatements(fn.body, env, fn.path)
    analyzing.delete(id)
    return mergeTypes([...result.returns, ...(result.fallsThrough ? [data] : [])])
  }
  const loading = new Set()
  function simpleAnnotation(node, path) {
    const parts = children(node).filter(n => n.name !== ':')
    if (parts.length !== 1 || !['VariableName', 'None'].includes(parts[0].name)) unsupported('Only simple type-name annotations are supported.', loc(node, path))
    safeKey(text(parts[0], path), loc(parts[0], path))
  }
  function lowerDecorator(node, path) {
    const parts = children(node), at = loc(node, path), argumentList = parts.find(n => n.name === 'ArgList')
    if (!argumentList || parts[1]?.name !== 'VariableName') unsupported('Only explicit Functions v2 decorators are supported.', at)
    let callee = expr(parts[1], path)
    for (let i = 2; parts[i] !== argumentList; i += 2) {
      if (parts[i]?.name !== '.' || parts[i + 1]?.name !== 'VariableName') unsupported('Unsupported decorator target.', at)
      callee = { kind: 'attribute', object: callee, name: safeKey(text(parts[i + 1], path), at), loc: at }
    }
    const arguments_ = children(argumentList).filter(n => !['(', ')', ','].includes(n.name)), kwargs = Object.create(null)
    for (let i = 0; i < arguments_.length; i += 3) {
      if (arguments_[i]?.name !== 'VariableName' || arguments_[i + 1]?.name !== 'AssignOp' || !arguments_[i + 2]) unsupported('Functions decorators require explicit keyword bindings.', at)
      const key = safeKey(text(arguments_[i], path), at)
      if (own(kwargs, key)) unsupported('Repeated decorator argument.', at)
      kwargs[key] = expr(arguments_[i + 2], path)
    }
    return { kind: 'call', callee, args: [], kwargs, loc: at }
  }
  function registerHandlers() {
    const names = new Set()
    for (const [id, definition] of definitions) {
      if (!definition.decorators?.length) continue
      const env = modules.get(definition.path), binding = { functionName: definition.name, functionId: id, path: definition.path }
      let trigger = false, named = false
      for (const decorator of definition.decorators) {
        const target = infer(decorator.callee, env, definition.path)
        if (target.type !== 'callable' || !['functionapp.function_name', 'functionapp.service_bus_queue_trigger', 'functionapp.event_grid_trigger'].includes(target.name)) unsupported('Only supported Functions v2 decorators are allowed.', decorator.loc)
        const [parameters, required] = SDK_SIGNATURES[target.name]
        const values = Object.fromEntries(Object.entries(decorator.kwargs).map(([key, value]) => {
          const result = infer(value, env, definition.path)
          if (result.type !== 'data' || typeof result.constant !== 'string' || !result.constant) unsupported('Decorator bindings require resolved nonempty string constants.', value.loc)
          return [key, result.constant]
        }))
        const args = bindArguments(parameters, required, [], values, decorator.loc)
        if (target.name === 'functionapp.function_name') {
          if (named) unsupported('Repeated function_name decorator.', decorator.loc)
          named = true; binding.functionName = args.name
        } else {
          if (trigger) unsupported('A Function requires exactly one trigger.', decorator.loc)
          trigger = true; binding.kind = target.name === 'functionapp.event_grid_trigger' ? 'eventgrid' : 'servicebus'
          binding.argName = args.arg_name
          if (binding.kind === 'servicebus') { binding.queueName = args.queue_name; binding.connection = args.connection }
        }
      }
      if (!trigger || !/^[A-Za-z][A-Za-z0-9_]*$/.test(binding.functionName) || names.has(binding.functionName.toLowerCase())) unsupported('Missing trigger or duplicate/invalid Function registration.', loc(definition.node, definition.path))
      names.add(binding.functionName.toLowerCase())
      analyzeFunction(id, [typed(binding.kind === 'servicebus' ? 'functionmessage' : 'functionevent')], {}, loc(definition.node, definition.path))
      const fn = program.functions[id]
      if (fn.params.length !== 1 || fn.params[0] !== binding.argName || fn.annotations[binding.argName]?.type !== `${binding.kind === 'servicebus' ? 'functionmessage' : 'functionevent'}Type`) unsupported('Trigger argument and supported Functions annotation must match the handler parameter.', fn.loc)
      if (program.handlers.length >= 50) throw messagingError('MESSAGING_LIMIT', 'A host supports at most 50 registered handlers.', fn.loc)
      program.handlers.push(binding)
    }
    if (!program.handlers.length) unsupported('The Functions entry must register a supported v2 trigger.')
  }
  function loadModule(path) {
    if (loading.has(path)) unsupported('Circular local imports are unsupported.', { path, line: 1, column: 1 })
    if (modules.has(path)) return modules.get(path)
    if (modules.size >= 16) throw messagingError('MESSAGING_LIMIT', 'A messaging project supports at most 16 reachable modules.', { path, line: 1, column: 1 })
    const source = files[path]; location = { path, line: 1, column: 1 }
    if (typeof source !== 'string') throw messagingError('MESSAGING_CONFIG', 'Source file is missing.', location)
    if (new TextEncoder().encode(source).length > 128 * 1024) throw messagingError('MESSAGING_LIMIT', 'Source exceeds 128 KiB per file.', location)
    const root = parser.parse(source).topNode
    const cursor = root.cursor(); do { if (cursor.type.isError) unsupported('Invalid Python syntax.', loc(cursor.node, path)) } while (cursor.next())
    loading.add(path)
    const env = new Map(); modules.set(path, env); program.sourcePaths.push(path)
    program.imports[path] = []; program.globals[path] = []
    for (const top of children(root)) {
      const node = top.name === 'DecoratedStatement' ? children(top).find(n => n.name === 'FunctionDefinition') : top
      if (node?.name === 'FunctionDefinition') {
        if (top.name === 'DecoratedStatement' && mode !== 'functions') unsupported('Decorators require Functions host mode.', loc(top, path))
        const nameNode = children(node).find(n => n.name === 'VariableName'), name = safeKey(text(nameNode, path), loc(nameNode, path)), id = `${path}:${name}`
        if (definitions.has(id)) unsupported('Duplicate function definition.', loc(node, path))
        definitions.set(id, { name, node, path, decorators: top.name === 'DecoratedStatement' ? children(top).filter(n => n.name === 'Decorator').map(n => lowerDecorator(n, path)) : [] }); env.set(name, { type: 'function', id })
      }
    }
    for (const node of children(root)) {
      if (['FunctionDefinition', 'DecoratedStatement'].includes(node.name)) continue
      if (node.name === 'ImportStatement') {
        for (const item of imports(node, path)) { env.set(item.alias, importedType(item)); program.imports[path].push(item) }
      } else {
        const record = statements([node], path)
        if (record.some(s => !['assign', 'expression', 'pass'].includes(s.kind))) unsupported('Only constants and constructors are allowed at module level.', loc(node, path))
        moduleScope = true
        try { analyzeStatements(record, env, path) } finally { moduleScope = false }
        program.globals[path].push(...record)
      }
    }
    loading.delete(path)
    return env
  }
  try {
    if (!['script', 'eventgrid-handler', 'functions'].includes(mode)) unsupported(`Mode '${mode}' is not supported by the messaging adapter.`)
    for (const [path, expected] of Object.entries(fixedFiles)) if (!own(files, path) || files[path] !== expected) throw messagingError('MESSAGING_CONFIG', 'Protected scaffold content was changed or removed.', { path, line: 1, column: 1 })
    const env = loadModule(entry)
    if (mode === 'functions') { registerHandlers(); return { program, diagnostics: [] } }
    const main = env.get(mode === 'eventgrid-handler' ? 'handle_event' : 'main')
    if (main?.type !== 'function') unsupported(`The entry must define ${mode === 'eventgrid-handler' ? 'handle_event(event)' : 'main()'}.`)
    analyzeFunction(main.id, mode === 'eventgrid-handler' ? [typed('event')] : [], {}, { path: entry, line: 1, column: 1 })
    program.main = main.id
    return { program, diagnostics: [] }
  } catch (error) {
    return { program: null, diagnostics: [error.diagnostic ?? { code: 'MESSAGING_UNSUPPORTED', message: 'Unable to lower this Python source.', ...location }] }
  }
}

import { parser } from '@lezer/python'

const digest = source => { let hash = 2166136261; for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `sha256:${(hash >>> 0).toString(16)}` }
const kids = node => { const items = []; for (let child = node?.firstChild; child; child = child.nextSibling) items.push(child); return items }
const raw = (node, text) => text.slice(node.from, node.to)
const descendants = node => [node, ...kids(node).flatMap(descendants)]
const variableNames = (node, text) => descendants(node).filter(child => child.name === 'VariableName').map(child => raw(child, text))
const binderNames = (node, text) => {
  const children = kids(node)
  const before = name => children.slice(0, children.findIndex(child => child.name === name))
  if (node.name === 'AssignStatement') return children.flatMap((child, index) => children[index + 1]?.name === 'AssignOp' ? variableNames(child, text) : [])
  if (['UpdateStatement', 'NamedExpression'].includes(node.name)) return variableNames(children[0], text)
  if (node.name === 'ForStatement') return before('in').slice(1).flatMap(child => variableNames(child, text))
  if (node.name === 'WithStatement' || node.name === 'TryStatement') return children.flatMap((child, index) => child.name === 'as' ? variableNames(children[index + 1], text) : [])
  if (node.name === 'DeleteStatement') return children.slice(1).flatMap(child => variableNames(child, text))
  if (node.name === 'ImportStatement') return variableNames(node, text)
  if (node.name === 'FunctionDefinition' || node.name === 'ClassDefinition') return variableNames(children.find(child => child.name === 'VariableName'), text)
  if (node.name === 'ScopeStatement') return variableNames(node, text)
  return []
}
const diagnostic = (text, node, message, code = 'PYTHON_UNSUPPORTED') => {
  const prefix = text.slice(0, node?.from ?? 0)
  return { code, message, path: 'app.py', line: prefix.split('\n').length, column: (node?.from ?? 0) - prefix.lastIndexOf('\n') }
}
const named = node => kids(node).filter(child => !['(', ')', ',', ':', '=', 'AssignOp', 'def', 'return', '\n'].includes(child.name))

export function parsePythonWorkload(files, manifest = {}) {
  const app = files?.['app.py']
  if (typeof app !== 'string') return { workloadSpec: null, diagnostics: [{ code: 'MISSING_FILE', message: 'A required Python source file is missing.', path: 'app.py', line: 1, column: 1 }] }
  const diagnostics = []
  if (files['training_workload.py'] !== manifest.fixedFiles?.['training_workload.py']) diagnostics.push(diagnostic(app, null, 'The supplied workload fixture adapter is fixed.', 'SCAFFOLD_MODIFIED'))
  const tree = parser.parse(app); let syntaxError = null; let count = 0
  tree.iterate({ enter(node) { count++; if (!syntaxError && node.type.isError) syntaxError = node } })
  if (count > (manifest.maxTokens ?? 20_000)) return { workloadSpec: null, diagnostics: [...diagnostics, diagnostic(app, null, 'Python source exceeds the supported syntax limit.', 'TOKEN_LIMIT')] }
  if (syntaxError) return { workloadSpec: null, diagnostics: [...diagnostics, diagnostic(app, syntaxError, 'Python source contains a syntax error.', 'PYTHON_SYNTAX')] }

  const imports = []; const assignments = new Map(); const workFunctions = []; const protectedWrites = []; const writes = []
  const targetName = statement => {
    const target = kids(statement)[0]
    return target ? raw(target, app).replace(/\s/g, '') : ''
  }
  for (const statement of kids(tree.topNode)) {
    if (statement.name === 'ImportStatement') {
      if (raw(statement, app).replace(/\s/g, '') === 'importtraining_workload') imports.push(statement)
      else if (kids(statement).some(child => child.name === 'VariableName' && raw(child, app) === 'training_workload')) protectedWrites.push(statement)
      continue
    }
    if (statement.name === 'AssignStatement') {
      const parts = named(statement); const variables = parts.filter(part => part.name === 'VariableName')
      const name = variables.length === 1 ? raw(variables[0], app) : null
      const last = parts.at(-1); const value = last?.name === 'Number' && /^\d+$/.test(raw(last, app)) ? Number(raw(last, app)) : null
      if (name) assignments.set(name, [...(assignments.get(name) ?? []), { statement, value }])
      if (variables.length !== 1 && variables.some(part => ['training_workload', 'work'].includes(raw(part, app)))) protectedWrites.push(statement)
      continue
    }
    if (statement.name === 'FunctionDefinition') {
      const name = kids(statement).find(child => child.name === 'VariableName')
      if (name && raw(name, app) === 'work') workFunctions.push(statement)
      else if (name && raw(name, app) === 'training_workload') protectedWrites.push(statement)
    }
  }
  tree.iterate({ enter(cursor) {
    if (!['AssignStatement', 'UpdateStatement'].includes(cursor.name)) return
    const node = cursor.node; const target = targetName(node); writes.push({ target, node })
    if (['training_workload', 'work', 'training_workload.process_batch'].includes(target)) protectedWrites.push(node)
  } })
  if (imports.length !== 1) diagnostics.push(diagnostic(app, imports[1] ?? tree.topNode, 'Import training_workload exactly once at module scope.'))
  if (workFunctions.length !== 1) diagnostics.push(diagnostic(app, workFunctions[1] ?? tree.topNode, 'Define work() exactly once.'))
  const work = workFunctions[0]
  const params = work && kids(work).find(child => child.name === 'ParamList')
  const body = work && kids(work).find(child => child.name === 'Body')
  const statements = kids(body).filter(child => ![':', '\n', 'Comment'].includes(child.name))
  const returned = statements.length === 1 && statements[0].name === 'ReturnStatement'
    ? kids(statements[0]).find(child => child.name === 'CallExpression') : null
  const call = returned && kids(returned).find(child => child.name === 'MemberExpression')
  const args = returned && kids(returned).find(child => child.name === 'ArgList')
  const values = args ? kids(args).filter(child => !['(', ')', ','].includes(child.name)) : []
  const bindingNames = values.length === 2 && values.every(child => child.name === 'VariableName') ? values.map(child => raw(child, app)) : []
  if (!work || !params || named(params).length || !returned || !call || raw(call, app).replace(/\s/g, '') !== 'training_workload.process_batch' || bindingNames.length !== 2) {
    diagnostics.push(diagnostic(app, work ?? tree.topNode, 'work() must directly return training_workload.process_batch with two module-level integer bindings.'))
  }
  const valuesByBinding = bindingNames.map(name => assignments.get(name) ?? [])
  const protectedNames = new Set(['training_workload', 'work', ...bindingNames])
  const localScopes = []
  tree.iterate({ enter(cursor) {
    if (!['FunctionDefinition', 'ClassDefinition'].includes(cursor.name)) return
    const body = kids(cursor.node).find(child => child.name === 'Body')
    if (body) localScopes.push(body)
  } })
  const isModuleBinding = node => !localScopes.some(scope => node.from >= scope.from && node.to <= scope.to)
  const sameNode = (left, right) => left && right && left.from === right.from && left.to === right.to
  const allowedAssignments = valuesByBinding.flatMap(entries => entries.map(entry => entry.statement))
  tree.iterate({ enter(cursor) {
    const node = cursor.node
    const bindsProtectedName = binderNames(node, app).some(name => protectedNames.has(name))
    if (node.name === 'ScopeStatement' && bindsProtectedName) { protectedWrites.push(node); return }
    if (!isModuleBinding(node)) return
    const allowed = sameNode(node, imports[0]) || sameNode(node, work) || allowedAssignments.some(item => sameNode(node, item))
    if (bindsProtectedName && !allowed) protectedWrites.push(node)
  } })
  if (bindingNames.length === 2 && (valuesByBinding.some(entries => entries.length !== 1 || !Number.isInteger(entries[0].value))
    || bindingNames.some(name => writes.filter(item => item.target === name).length !== 1))) {
    diagnostics.push(diagnostic(app, work, 'The work-unit and scratch bindings must each be assigned once to integer literals.'))
  }
  if (protectedWrites.length) diagnostics.push(diagnostic(app, protectedWrites[0], 'The workload module, operation, and work() binding cannot be reassigned or shadowed.'))
  const [units, scratchMiB] = valuesByBinding.map(entries => entries[0]?.value)
  if (Number.isInteger(units) && (units < 1 || units > 100)) diagnostics.push(diagnostic(app, work, 'Work units must be an integer from 1 through 100.'))
  if (Number.isInteger(scratchMiB) && (scratchMiB < 1 || scratchMiB > 512)) diagnostics.push(diagnostic(app, work, 'Scratch MiB must be an integer from 1 through 512.'))
  if (diagnostics.length) return { workloadSpec: null, diagnostics }
  return { workloadSpec: { version: 1, route: '/api/work', units, scratchMiB, helperDigest: digest(files['training_workload.py']), operation: 'process_batch' }, diagnostics: [] }
}

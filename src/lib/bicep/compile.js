import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { bicepDiagnostic } from './lexer.js'
import { parseBicepProject } from './parser.js'
import { bicepType, evaluateExpression } from './evaluate.js'

const MODULE_DEPTH_LIMIT = 4
const GRAPH_NODE_LIMIT = 32
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

class CompileFailure extends Error {
  constructor(diagnostic) { super(diagnostic.message); this.diagnostic = diagnostic }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

function stableIdentityUuid(domain, armId) {
  const source = `${domain}:${armId.toLowerCase()}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const character of source) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (character.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map(word => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

function resourceValue(type, armId, name, location, body) {
  const value = { ...body, id: armId, name, location }
  const properties = { ...(object(body.properties) ? body.properties : {}) }
  if (type === 'Microsoft.ContainerRegistry/registries') properties.loginServer = `${name.toLowerCase()}.azurecr.io`
  if (type === 'Microsoft.ManagedIdentity/userAssignedIdentities') {
    properties.clientId = stableIdentityUuid('client', armId)
    properties.principalId = stableIdentityUuid('principal', armId)
    value.clientId = properties.clientId
    value.principalId = properties.principalId
  }
  if (type === 'Microsoft.CognitiveServices/accounts') {
    properties.endpoint = `https://${name.toLowerCase()}.services.ai.azure.com/openai/v1/`
    value.endpoint = properties.endpoint
  }
  value.properties = properties
  return value
}

function typeOf(value, expected, fail, at) {
  if (bicepType(value) !== expected) fail('BICEP_TYPE', `Expected ${expected}; received ${bicepType(value)}.`, at)
}

/** Compile saved text into a fully evaluated, immutable, resource-group DAG. */
export function compileBicepProject(savedFiles, manifest, target = {}) {
  const parsed = parseBicepProject(savedFiles, manifest, target.parameterPath)
  if (parsed.diagnostics.length) return { graph: null, diagnostics: parsed.diagnostics }
  const group = target.resourceGroup
  const groupName = typeof group === 'string' ? group : group?.name
  const location = target.location ?? (typeof group === 'object' ? group?.location : undefined)
  if (typeof groupName !== 'string' || !/^[A-Za-z0-9_().-]{1,90}$/.test(groupName) || groupName === '.' || groupName === '..' || groupName.endsWith('.')
    || typeof location !== 'string' || !/^[a-z][a-z0-9]{1,30}$/.test(location))
    return { graph: null, diagnostics: [bicepDiagnostic('BICEP_TARGET', 'An existing resource group name and location are required.', 'infra/main.bicep', 1, 1)] }
  const subscriptionId = target.subscriptionId ?? SUBSCRIPTION_ID
  if (typeof subscriptionId !== 'string' || !/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/.test(subscriptionId))
    return { graph: null, diagnostics: [bicepDiagnostic('BICEP_TARGET', 'A valid subscription ID is required.', 'infra/main.bicep', 1, 1)] }
  const resourceGroup = { name: groupName, location, id: `/subscriptions/${subscriptionId}/resourceGroups/${groupName}` }
  const rootPath = parsed.rootPath ?? 'infra/main.bicep'
  const root = parsed.files[rootPath]
  if (!root) return { graph: null, diagnostics: [bicepDiagnostic('MISSING_FILE', `${rootPath} is required.`, rootPath, 1, 1)] }
  const nodes = []
  const nodeById = new Map()
  const fail = (code, message, at = root) => { throw new CompileFailure(bicepDiagnostic(code, message, at.path, at.line, at.column)) }
  const assign = Object.fromEntries((parsed.params?.declarations ?? []).map(item => [item.name, item]))
  const mainParameters = Object.create(null)

  function compileFile(ast, supplied, instance, depth, importStack) {
    const declarations = new Map(ast.declarations.map(declaration => [declaration.name, declaration]))
    const status = new Map()
    const values = new Map()
    const parameters = Object.create(null)
    const outputs = Object.create(null)
    const outputExpressions = Object.create(null)
    const outputBindings = Object.create(null)
    let activeNode = null
    let resolutionDepth = 0
    const expressionContext = {
      resourceGroup, subscriptionId, fail,
      resolve(name, at) {
        const declaration = declarations.get(name)
        if (!declaration) fail('MISSING_BICEP_REFERENCE', `Unknown symbol ${name}.`, at)
        const value = resolve(declaration, at)
        if (activeNode && ['resource', 'module'].includes(declaration.kind) && activeNode.id !== `${instance}#${name}`)
          activeNode.dependencies.add(`${instance}#${name}`)
        return value
      },
    }
    const evaluate = expression => evaluateExpression(expression, expressionContext)

    function bindings(expression, path = '') {
      const found = []
      const visit = (current, destination) => {
        if (current.kind === 'member') {
          const members = []; let head = current
          while (head.kind === 'member') { members.unshift(head.property); head = head.object }
          if (head.kind === 'identifier' && ['resource', 'module'].includes(declarations.get(head.name)?.kind)) {
            const source = `${instance}#${head.name}`
            found.push({ path: destination, source, property: members.join('.') })
            if (declarations.get(head.name).kind === 'module' && members[0] === 'outputs' && members[1]) {
              for (const origin of nodeById.get(source)?.outputBindings?.[members[1]] ?? [])
                found.push({ ...origin, path: destination, via: source })
            }
            return
          }
          visit(head, destination); return
        }
        if (current.kind === 'identifier' && ['resource', 'module'].includes(declarations.get(current.name)?.kind)) {
          found.push({ path: destination, source: `${instance}#${current.name}`, property: '' }); return
        }
        if (current.kind === 'identifier' && declarations.get(current.name)?.kind === 'var') {
          visit(declarations.get(current.name).value, destination); return
        }
        if (current.kind === 'identifier' && declarations.get(current.name)?.kind === 'param') {
          for (const origin of (Object.hasOwn(supplied, current.name) ? supplied[current.name].bindings : []) ?? []) found.push({ ...origin, path: destination })
          return
        }
        if (current.kind === 'object') for (const property of current.properties) {
          if (property.keyExpression) visit(property.keyExpression, destination)
          visit(property.value, `${destination}/${property.key.replaceAll('~', '~0').replaceAll('/', '~1')}`)
        }
        else if (current.kind === 'array') current.items.forEach((item, index) => visit(item, `${destination}/${index}`))
        else if (current.kind === 'call') current.args.forEach(item => visit(item, destination))
        else if (current.kind === 'interpolatedString') for (const segment of current.segments) if (segment.kind === 'expression') visit(segment.expression, destination)
      }
      visit(expression, path)
      return found
    }

    function resolve(declaration, at = declaration) {
      if (status.get(declaration.name) === 'done') return values.get(declaration.name)
      if (status.get(declaration.name) === 'visiting') fail('BICEP_CYCLE', `Cycle through ${declaration.name}.`, at)
      if (resolutionDepth >= 128) fail('BICEP_DEPTH_LIMIT', 'Symbol reference depth exceeds 128.', at)
      resolutionDepth++
      status.set(declaration.name, 'visiting')
      let value
      if (declaration.kind === 'param') {
        const provided = Object.hasOwn(supplied, declaration.name) ? supplied[declaration.name] : undefined
        if (!provided && declaration.default === undefined) fail('MISSING_BICEP_PARAMETER', `Required parameter ${declaration.name} is missing.`, declaration)
        value = provided ? provided.value : evaluate(declaration.default)
        typeOf(value, declaration.type, fail, provided?.source ?? declaration.default ?? declaration)
        for (const decorator of declaration.decorators) {
          if (decorator.name === 'description') { typeOf(evaluate(decorator.value), 'string', fail, decorator); continue }
          const bound = evaluate(decorator.value)
          if (decorator.name === 'allowed') {
            typeOf(bound, 'array', fail, decorator)
            if (!bound.every(item => bicepType(item) === declaration.type)) fail('BICEP_TYPE', '@allowed values must match the parameter type.', decorator)
            if (!bound.some(item => JSON.stringify(item) === JSON.stringify(value))) fail('BICEP_PARAMETER_CONSTRAINT', `${declaration.name} is outside @allowed.`, provided?.source ?? declaration)
          } else {
            if (declaration.type !== 'int') fail('BICEP_TYPE', `@${decorator.name} requires an int parameter.`, decorator)
            typeOf(bound, 'int', fail, decorator)
            if (decorator.name === 'minValue' && value < bound || decorator.name === 'maxValue' && value > bound)
              fail('BICEP_PARAMETER_CONSTRAINT', `${declaration.name} violates @${decorator.name}.`, provided?.source ?? declaration)
          }
        }
        parameters[declaration.name] = value
      } else if (declaration.kind === 'var') value = evaluate(declaration.value)
      else if (declaration.kind === 'output') {
        value = evaluate(declaration.value)
        typeOf(value, declaration.type, fail, declaration.value)
        outputs[declaration.name] = value
        outputExpressions[declaration.name] = declaration.value
        outputBindings[declaration.name] = bindings(declaration.value)
      } else {
        const node = { id: `${instance}#${declaration.name}`, kind: declaration.kind, symbol: declaration.name,
          source: { path: declaration.path, line: declaration.line, column: declaration.column }, dependencies: new Set() }
        const prior = activeNode; activeNode = node
        const body = evaluate(declaration.value)
        if (!object(body)) fail('BICEP_TYPE', `${declaration.kind} body must be an object.`, declaration.value)
        if (declaration.kind === 'resource') {
          const match = /^([^@]+)@([^@]+)$/.exec(declaration.reference)
          if (!match) fail('UNSUPPORTED_BICEP', 'Resource type must include an API version.', declaration)
          const [, type, apiVersion] = match
          typeOf(body.name, 'string', fail, declaration.value)
          if (!body.name || body.name.includes('/')) fail('UNSUPPORTED_BICEP', 'Resource name must be a nonempty single segment.', declaration)
          if (body.location !== undefined) typeOf(body.location, 'string', fail, declaration.value)
          const parent = declaration.value.properties.find(property => property.key === 'parent')
          const scope = declaration.value.properties.find(property => property.key === 'scope')
          if (parent && (parent.value.kind !== 'identifier' || declarations.get(parent.value.name)?.kind !== 'resource'))
            fail('UNSUPPORTED_BICEP', 'Resource parent must be a local resource reference.', parent.value)
          if (scope && (scope.value.kind !== 'identifier' || declarations.get(scope.value.name)?.kind !== 'resource' || type !== 'Microsoft.Authorization/roleAssignments'))
            fail('UNSUPPORTED_BICEP', 'Resource scope must be a local extension-resource target.', scope.value)
          const parts = type.split('/')
          if (parts.length < 2 || parts.length > 3) fail('UNSUPPORTED_BICEP', 'Resource type shape is outside this subset.', declaration)
          if (parent && (parts.length !== 3 || nodeById.get(`${instance}#${parent.value.name}`)?.type !== parts.slice(0, 2).join('/')))
            fail('UNSUPPORTED_BICEP', 'Parent resource type does not match child resource type.', parent.value)
          const armId = parent ? `${body.parent.id}/${parts[2]}/${body.name}`
            : scope ? `${body.scope.id}/providers/${type}/${body.name}`
              : `${resourceGroup.id}/providers/${type}/${body.name}`
          Object.assign(node, { type, apiVersion, name: body.name, location: body.location ?? location, existing: !!declaration.existing,
            armId, body, expression: declaration.value })
          value = resourceValue(type, armId, body.name, node.location, body)
        } else {
          if (depth >= MODULE_DEPTH_LIMIT) fail('BICEP_MODULE_DEPTH_LIMIT', 'Module nesting exceeds four.', declaration)
          const modulePath = ast.path.slice(0, ast.path.lastIndexOf('/') + 1) + declaration.reference.slice(2)
          if (importStack.includes(modulePath)) fail('BICEP_CYCLE', 'Module import cycle.', declaration)
          const moduleAst = parsed.files[modulePath]
          if (!moduleAst || moduleAst.kind !== 'bicep') fail('UNSUPPORTED_BICEP', 'Module must resolve to a manifest-listed local Bicep file.', declaration)
          typeOf(body.name, 'string', fail, declaration.value)
          if (!body.name) fail('BICEP_TYPE', 'Module name must be nonempty.', declaration.value)
          typeOf(body.params, 'object', fail, declaration.value)
          const paramsProperty = declaration.value.properties.find(prop => prop.key === 'params')
          const suppliedChild = Object.fromEntries(Object.entries(body.params).map(([key, item]) => {
            const paramExpression = paramsProperty?.value.properties.find(prop => prop.key === key)
            return [key, { value: item, source: paramExpression ?? paramsProperty ?? declaration,
              bindings: paramExpression ? bindings(paramExpression.value) : [] }]
          }))
          Object.assign(node, { name: body.name, path: modulePath, params: body.params, body, expression: declaration.value })
          const child = compileFile(moduleAst, suppliedChild, `${node.id}:${modulePath}`, depth + 1, [...importStack, modulePath])
          for (const childNode of child.topNodes) node.dependencies.add(childNode.id)
          node.outputs = child.outputs
          node.outputBindings = child.outputBindings
          value = { name: body.name, outputs: child.outputs }
        }
        const explicit = declaration.value.properties.find(property => property.key === 'dependsOn')
        if (explicit) {
          if (explicit.value.kind !== 'array') fail('BICEP_TYPE', 'dependsOn must be an array.', explicit.value)
          for (const item of explicit.value.items) {
            if (item.kind !== 'identifier' || !['resource', 'module'].includes(declarations.get(item.name)?.kind))
              fail('BICEP_TYPE', 'dependsOn entries must name a resource or module.', item)
            expressionContext.resolve(item.name, item)
          }
        }
        activeNode = prior
        node.bindings = bindings(declaration.value)
        for (const binding of node.bindings) if (binding.source !== node.id) node.dependencies.add(binding.source)
        node.dependsOn = [...node.dependencies]
        delete node.dependencies
        if (nodes.length >= GRAPH_NODE_LIMIT) fail('BICEP_GRAPH_LIMIT', 'Bicep graph exceeds 32 resource/module nodes.', declaration)
        nodes.push(node); nodeById.set(node.id, node)
      }
      values.set(declaration.name, value)
      status.set(declaration.name, 'done')
      resolutionDepth--
      return value
    }

    for (const name of Object.keys(supplied)) if (!declarations.has(name) || declarations.get(name).kind !== 'param')
      fail('UNKNOWN_BICEP_PARAMETER', `Unknown parameter ${name}.`, supplied[name].source)
    for (const declaration of ast.declarations) if (declaration.kind === 'param') resolve(declaration)
    for (const declaration of ast.declarations) if (declaration.kind === 'var') resolve(declaration)
    for (const declaration of ast.declarations) if (declaration.kind === 'resource' || declaration.kind === 'module') resolve(declaration)
    for (const declaration of ast.declarations) if (declaration.kind === 'output') resolve(declaration)
    return { outputs, outputExpressions, outputBindings, parameters, topNodes: ast.declarations.filter(item => ['resource', 'module'].includes(item.kind)).map(item => nodeById.get(`${instance}#${item.name}`)) }
  }

  try {
    const supplied = Object.fromEntries(Object.entries(assign).map(([name, item]) => [name, { value: literal(item.value), source: item }]))
    const result = compileFile(root, supplied, root.path, 0, [root.path])
    Object.assign(mainParameters, result.parameters)
    const graph = freezeDeep({ target: resourceGroup, subscriptionId, parameters: mainParameters, nodes, order: nodes.slice(),
      outputs: result.outputs, outputExpressions: result.outputExpressions, outputBindings: result.outputBindings, tokenCount: parsed.tokenCount })
    return { graph, diagnostics: [] }
  } catch (error) {
    if (error instanceof CompileFailure) return { graph: null, diagnostics: [error.diagnostic] }
    throw error
  }
}

function literal(node) {
  if (node.kind === 'string') return node.segments.map(segment => segment.value).join('')
  if (['integer', 'boolean', 'null'].includes(node.kind)) return node.value
  if (node.kind === 'array') return node.items.map(literal)
  if (node.kind === 'object') return Object.fromEntries(node.properties.map(property => [property.key, literal(property.value)]))
  throw new Error('Parser permitted a nonliteral .bicepparam value.')
}

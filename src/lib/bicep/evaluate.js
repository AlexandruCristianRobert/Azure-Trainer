import { bicepGuid } from './functions.js'

const scalar = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const RESOURCE_ID_TYPES = new Set([
  'Microsoft.ContainerRegistry/registries', 'Microsoft.ManagedIdentity/userAssignedIdentities',
  'Microsoft.App/managedEnvironments', 'Microsoft.App/containerApps',
  'Microsoft.CognitiveServices/accounts', 'Microsoft.CognitiveServices/accounts/projects',
  'Microsoft.CognitiveServices/accounts/deployments', 'Microsoft.Authorization/roleAssignments',
])

export function bicepType(value) {
  if (Array.isArray(value)) return 'array'
  if (plain(value)) return 'object'
  if (Number.isInteger(value)) return 'int'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'string') return 'string'
  return value === null ? 'null' : 'invalid'
}

export function evaluateExpression(node, context) {
  const fail = (code, message, at = node) => context.fail(code, message, at)
  const evaluate = child => evaluateExpression(child, context)
  switch (node.kind) {
    case 'integer': case 'number': case 'boolean': case 'null': return node.value
    case 'string': return node.segments.map(segment => segment.value).join('')
    case 'interpolatedString': return node.segments.map(segment => {
      if (segment.kind === 'text') return segment.value
      const value = evaluate(segment.expression)
      if (!scalar(value)) fail('BICEP_TYPE', 'Interpolation requires a scalar value.', segment.expression)
      return String(value).toLowerCase() === 'true' && typeof value === 'boolean' ? 'true' : String(value)
    }).join('')
    case 'array': return node.items.map(evaluate)
    case 'object': {
      const value = Object.create(null)
      for (const property of node.properties) {
        const key = property.keyExpression ? evaluate(property.keyExpression) : property.key
        if (typeof key !== 'string' || !key || key === '__proto__' || key === 'constructor' || key === 'prototype')
          fail('BICEP_TYPE', 'Computed object key must be a safe nonempty string.', property)
        if (Object.hasOwn(value, key)) fail('DUPLICATE_BICEP_PROPERTY', `Duplicate property ${key}.`, property)
        value[key] = evaluate(property.value)
      }
      return { ...value }
    }
    case 'identifier': return context.resolve(node.name, node)
    case 'member': {
      const value = evaluate(node.object)
      if (!plain(value) || !Object.hasOwn(value, node.property)) fail('MISSING_BICEP_OUTPUT', `Member ${node.property} does not exist.`, node)
      return value[node.property]
    }
    case 'call': {
      if (node.name === 'uniqueString') fail('UNSUPPORTED_BICEP', 'uniqueString is outside this simulation.', node)
      if (node.name === 'resourceGroup' || node.name === 'subscription') {
        if (node.args.length) fail('UNSUPPORTED_BICEP', `${node.name} takes no arguments.`, node)
        return node.name === 'resourceGroup' ? context.resourceGroup : { subscriptionId: context.subscriptionId }
      }
      if (node.name === 'guid') {
        if (node.args.length < 1 || node.args.length > 5) fail('UNSUPPORTED_BICEP', 'guid requires one to five strings.', node)
        const args = node.args.map(evaluate)
        if (args.some(value => typeof value !== 'string')) fail('BICEP_TYPE', 'guid requires string arguments.', node)
        return bicepGuid(args)
      }
      if (node.name === 'resourceId') {
        if (node.args.length < 2 || node.args.length > 3) fail('UNSUPPORTED_BICEP', 'resourceId requires a type, name and optional child name.', node)
        const args = node.args.map(evaluate)
        if (args.some(value => typeof value !== 'string' || !value)) fail('BICEP_TYPE', 'resourceId requires nonempty strings.', node)
        const [type, name, child] = args
        if (!RESOURCE_ID_TYPES.has(type)) fail('UNSUPPORTED_BICEP', `resourceId type ${type} is outside this subset.`, node)
        const segments = type.split('/')
        if (segments.length < 2 || segments.length > 3 || !/^Microsoft\.[A-Za-z]+$/.test(segments[0]) || segments.length !== args.length)
          fail('UNSUPPORTED_BICEP', 'resourceId type and name shape is outside this subset.', node)
        if (name.includes('/') || child?.includes('/')) fail('UNSUPPORTED_BICEP', 'resourceId names cannot contain path separators.', node)
        return `${context.resourceGroup.id}/providers/${segments[0]}/${segments[1]}/${name}${child ? `/${segments[2]}/${child}` : ''}`
      }
      fail('UNSUPPORTED_BICEP', `Function ${node.name} is outside this Bicep subset.`, node)
    }
    default: fail('UNSUPPORTED_BICEP', `Expression ${node.kind} is outside this Bicep subset.`, node)
  }
}

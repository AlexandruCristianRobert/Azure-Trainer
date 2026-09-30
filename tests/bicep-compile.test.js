import { describe, expect, it } from 'vitest'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { bicepGuid } from '../src/lib/bicep/functions.js'

const main = 'infra/main.bicep'
const params = 'infra/first.bicepparam'
const modulePath = 'infra/modules/child.bicep'
const parameterText = "using './main.bicep'\n"
function compile(source, assignments = '', modules = {}, context = {}) {
  const files = { [main]: source, [params]: parameterText + assignments, ...modules }
  const manifest = { files: Object.keys(files) }
  return compileBicepProject(files, manifest, { resourceGroup: { name: 'demo-rg', location: 'eastus' }, ...context })
}
const codes = result => result.diagnostics.map(item => item.code)

describe('pure typed Bicep compilation', () => {
  it('resolves an interpolated UAMI key and carries key lineage into the app map', () => {
    const source = "resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = { name: 'app-id', location: resourceGroup().location }\nresource app 'Microsoft.App/containerApps@2025-07-01' = { name: 'api', location: resourceGroup().location, identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } } }"
    const result = compile(source)
    expect(result.diagnostics).toEqual([])
    const identity = result.graph.order.find(item => item.name === 'app-id')
    const app = result.graph.order.find(item => item.name === 'api')
    expect(Object.keys(app.body.identity.userAssignedIdentities)).toEqual([identity.armId])
    expect(app.bindings).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/identity/userAssignedIdentities', source: 'infra/main.bicep#identity', property: 'id' })]))
  })
  it('reports a located unsupported decimal parameter instead of throwing', () => {
    const result = compile('param cpu int', 'param cpu = 0.5')
    expect(result.diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_BICEP', path: params, line: 2 })
  })
  it('keeps computed object keys to one safe interpolation and rejects duplicates', () => {
    expect(codes(compile("output x object = { '${resourceGroup().id}-suffix': {} }"))).toContain('UNSUPPORTED_BICEP')
    expect(codes(compile("output x object = { '${resourceGroup().name}': {}, 'demo-rg': {} }"))).toContain('DUPLICATE_BICEP_PROPERTY')
  })
  it('resolves defaults, overrides, decorators, variables and immutable outputs', () => {
    const source = `@allowed(['dev', 'prod'])\nparam env string = 'dev'\n@minValue(2)\n@maxValue(4)\nparam count int = 2\nvar label = '${'${env}'}-${'${resourceGroup().name}'}'\noutput name string = label\noutput countOut int = count`
    const result = compile(source, "param env = 'prod'\nparam count = 4")
    expect(result.diagnostics).toEqual([])
    expect(result.graph.outputs).toEqual({ name: 'prod-demo-rg', countOut: 4 })
    expect(result.graph.parameters).toEqual({ env: 'prod', count: 4 })
    expect(Object.isFrozen(result.graph)).toBe(true)
    expect(Object.isFrozen(result.graph.outputs)).toBe(true)
    expect(compile(source, "param env = 'dev'\nparam count = 2").graph.outputs.name).toBe('dev-demo-rg')
  })

  it('rejects missing, extra, wrong-type, disallowed and out-of-range parameters at their source', () => {
    const source = `@allowed(['dev', 'prod'])\nparam env string\n@minValue(2)\n@maxValue(4)\nparam count int = 2`
    expect(codes(compile(source))).toContain('MISSING_BICEP_PARAMETER')
    expect(codes(compile(source, "param env = 'dev'\nparam extra = 1"))).toContain('UNKNOWN_BICEP_PARAMETER')
    expect(compile(source, 'param env = 1').diagnostics[0]).toMatchObject({ code: 'BICEP_TYPE', path: params, line: 2 })
    expect(codes(compile(source, "param env = 'qa'"))).toContain('BICEP_PARAMETER_CONSTRAINT')
    expect(codes(compile(source, "param env = 'dev'\nparam count = 5"))).toContain('BICEP_PARAMETER_CONSTRAINT')
    expect(codes(compile('param count int = 1\noutput value string = count'))).toContain('BICEP_TYPE')
  })

  it('resolves local module params and outputs, forward resource references, and DAG order', () => {
    const child = `param registryName string\nresource reg 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: registryName }\noutput id string = reg.id\noutput server string = reg.properties.loginServer`
    const source = `param registryName string = 'sampleacr'\nmodule child './modules/child.bicep' = { name: 'child'; params: { registryName: registryName } }\nresource app 'Microsoft.App/containerApps@2025-07-01' = { name: 'api'; location: resourceGroup().location; properties: { registryId: child.outputs.id; server: child.outputs.server }; dependsOn: [child] }\noutput appId string = app.id`
    const result = compile(source.replaceAll(';', '\n'), '', { [modulePath]: child })
    expect(result.diagnostics).toEqual([])
    expect(result.graph.order.map(node => node.symbol)).toEqual(['reg', 'child', 'app'])
    expect(result.graph.nodes[2]).toMatchObject({ kind: 'resource', type: 'Microsoft.App/containerApps', name: 'api', location: 'eastus', source: { path: main, line: 4 } })
    expect(result.graph.nodes[2].dependsOn).toContain(result.graph.nodes[1].id)
    expect(result.graph.nodes[2].bindings).toContainEqual(expect.objectContaining({ path: '/properties/registryId', source: result.graph.nodes[1].id, property: 'outputs.id' }))
    expect(result.graph.nodes[2].bindings).toContainEqual(expect.objectContaining({ path: '/properties/registryId', source: result.graph.nodes[0].id, property: 'id', via: result.graph.nodes[1].id }))
    expect(result.graph.outputs.appId).toBe(`/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/demo-rg/providers/Microsoft.App/containerApps/api`)
  })

  it('reports missing symbols, outputs, duplicate declarations, and cycles with locations', () => {
    expect(compile('output value string = missing').diagnostics[0]).toMatchObject({ code: 'MISSING_BICEP_REFERENCE', path: main, line: 1 })
    expect(codes(compile("module child './modules/child.bicep' = { name: 'c', params: {} }\noutput x string = child.outputs.lost", '', { [modulePath]: "output found string = 'ok'" }))).toContain('MISSING_BICEP_OUTPUT')
    expect(codes(compile('var x = 1\nvar x = 2'))).toContain('DUPLICATE_BICEP_DECLARATION')
    expect(codes(compile("resource a 'Microsoft.App/containerApps@2025-07-01' = { name: 'a', dependsOn: [b] }\nresource b 'Microsoft.App/containerApps@2025-07-01' = { name: 'b', dependsOn: [a] }"))).toContain('BICEP_CYCLE')
    expect(codes(compile('var a = b\nvar b = a\noutput x string = a'))).toContain('BICEP_CYCLE')
  })

  it('supports scoped functions and official UUID-v5 guid vectors', () => {
    expect(bicepGuid(['hello'])).toBe('520f8434-fe3a-5d99-888d-450a827486a1')
    expect(bicepGuid(['hello', 'world'])).toBe('a5b868f8-11fe-567a-ace0-e77cc87f104e')
    expect(bicepGuid(['world', 'hello'])).toBe('b1db13b3-4ca6-5782-bf9e-8495c3532f9d')
    const result = compile("output group string = resourceGroup().id\noutput sub string = subscription().subscriptionId\noutput id string = resourceId('Microsoft.App/containerApps', 'api')\noutput unique string = guid('hello', 'world')")
    expect(result.diagnostics).toEqual([])
    expect(result.graph.outputs).toMatchObject({ group: '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/demo-rg', sub: '7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37', unique: 'a5b868f8-11fe-567a-ace0-e77cc87f104e' })
    expect(result.graph.outputs.id).toMatch(/providers\/Microsoft.App\/containerApps\/api$/)
    expect(codes(compile("output x string = uniqueString('a')"))).toContain('UNSUPPORTED_BICEP')
    expect(codes(compile("output x string = mystery('a')"))).toContain('UNSUPPORTED_BICEP')
    expect(codes(compile("output x string = guid('a', 2)"))).toContain('BICEP_TYPE')
    expect(codes(compile("output x string = resourceId('Microsoft.App/containerApps', 'a', 'b')"))).toContain('UNSUPPORTED_BICEP')
    expect(codes(compile("output x string = resourceId('Microsoft.Storage/storageAccounts', 'a')"))).toContain('UNSUPPORTED_BICEP')
    expect(codes(compile("output x string = 'prefix-${{ a: 2 }}'"))).toContain('BICEP_TYPE')
  })

  it('enforces bounded local imports and graph size', () => {
    const child = "module next './child.bicep' = { name: 'next', params: {} }"
    expect(codes(compile("module child './modules/child.bicep' = { name: 'child', params: {} }", '', { [modulePath]: child }))).toContain('BICEP_CYCLE')
    const resources = Array.from({ length: 33 }, (_, i) => `resource r${i} 'Microsoft.App/containerApps@2025-07-01' = { name: 'r${i}' }`).join('\n')
    expect(compile(resources.split('\n').slice(0, 32).join('\n')).graph.nodes).toHaveLength(32)
    expect(codes(compile(resources))).toContain('BICEP_GRAPH_LIMIT')
    expect(codes(compile("module lost './modules/child.bicep' = { name: 'lost', params: {} }"))).toContain('UNSUPPORTED_BICEP')
  })

  it('accepts local resource scope for role extensions and child parent links', () => {
    const source = `resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = { name: 'foundry' }\nresource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = { parent: account, name: 'chat' }\nresource role 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: account, name: '520f8434-fe3a-5d99-888d-450a827486a1' }`
    const result = compile(source)
    expect(result.diagnostics).toEqual([])
    expect(result.graph.nodes.map(node => node.armId)).toEqual([
      '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/demo-rg/providers/Microsoft.CognitiveServices/accounts/foundry',
      '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/demo-rg/providers/Microsoft.CognitiveServices/accounts/foundry/projects/chat',
      '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/demo-rg/providers/Microsoft.CognitiveServices/accounts/foundry/providers/Microsoft.Authorization/roleAssignments/520f8434-fe3a-5d99-888d-450a827486a1',
    ])
    expect(result.graph.nodes[2].dependsOn).toContain(result.graph.nodes[0].id)
    expect(codes(compile("resource role 'Microsoft.Authorization/roleAssignments@2022-04-01' = { scope: resourceGroup(), name: 'x' }"))).toContain('UNSUPPORTED_BICEP')
  })

  it('orders a module’s children after its explicit dependency even when declared first', () => {
    const result = compile(`module child './modules/child.bicep' = { name: 'child', params: {}, dependsOn: [before] }\nresource before 'Microsoft.App/managedEnvironments@2025-07-01' = { name: 'before' }`, '', {
      [modulePath]: "resource inside 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = { name: 'inside' }",
    })
    expect(result.diagnostics).toEqual([])
    expect(result.graph.order.map(node => node.symbol)).toEqual(['before', 'inside', 'child'])
  })

  it('validates unused variables and module parameter interfaces', () => {
    expect(codes(compile('var bad = missing'))).toContain('MISSING_BICEP_REFERENCE')
    expect(codes(compile('param __proto__ string'))).toContain('MISSING_BICEP_PARAMETER')
    expect(codes(compile("module child './modules/child.bicep' = { name: 'c', params: {} }", '', { [modulePath]: 'param required string' }))).toContain('MISSING_BICEP_PARAMETER')
    expect(codes(compile("module child './modules/child.bicep' = { name: 'c', params: {extra: 1} }", '', { [modulePath]: 'param required string' }))).toContain('UNKNOWN_BICEP_PARAMETER')
  })

  it('keeps resource-property provenance through variables and interpolation', () => {
    const result = compile(`resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = { name: 'identity' }\nvar client = identity.properties.clientId\nresource app 'Microsoft.App/containerApps@2025-07-01' = { name: 'api', properties: { client: client, label: 'id-${'${client}'}' } }`)
    expect(result.diagnostics).toEqual([])
    expect(result.graph.nodes[1].bindings).toContainEqual(expect.objectContaining({ path: '/properties/client', source: result.graph.nodes[0].id, property: 'properties.clientId' }))
    expect(result.graph.nodes[1].bindings).toContainEqual(expect.objectContaining({ path: '/properties/label', source: result.graph.nodes[0].id, property: 'properties.clientId' }))
    expect(result.graph.nodes[1].dependsOn).toContain(result.graph.nodes[0].id)
  })

  it('keeps resource-property provenance across explicit module parameters', () => {
    const result = compile(`resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = { name: 'identity' }\nmodule child './modules/child.bicep' = { name: 'child', params: { client: identity.properties.clientId } }\noutput client string = child.outputs.clientOut`, '', {
      [modulePath]: `param client string\noutput clientOut string = client`,
    })
    expect(result.diagnostics).toEqual([])
    expect(result.graph.outputBindings.client).toContainEqual(expect.objectContaining({ source: result.graph.nodes[0].id, property: 'properties.clientId' }))
  })

  it('bounds symbol resolution recursion', () => {
    const chain = Array.from({ length: 130 }, (_, i) => `var v${i} = ${i === 129 ? '1' : `v${i + 1}`}`).join('\n')
    expect(codes(compile(chain))).toContain('BICEP_DEPTH_LIMIT')
  })

  it('rejects malformed target group paths before producing ARM IDs', () => {
    expect(codes(compile("output id string = resourceGroup().id", '', {}, { resourceGroup: { name: '../other', location: 'eastus' } }))).toContain('BICEP_TARGET')
  })

  it('limits module nesting to four local imports', () => {
    const modules = {}
    for (const name of ['a', 'b', 'c', 'd', 'e']) modules[`infra/modules/${name}.bicep`] = "output ok string = 'ok'"
    for (const [name, next] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) modules[`infra/modules/${name}.bicep`] = `module next './${next}.bicep' = { name: '${next}', params: {} }`
    const source = "module first './modules/a.bicep' = { name: 'a', params: {} }"
    expect(compile(source, '', modules).diagnostics).toEqual([])
    modules['infra/modules/d.bicep'] = "module next './e.bicep' = { name: 'e', params: {} }"
    expect(codes(compile(source, '', modules))).toContain('BICEP_MODULE_DEPTH_LIMIT')
  })
})

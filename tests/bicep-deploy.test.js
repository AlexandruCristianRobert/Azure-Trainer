import { describe, expect, it } from 'vitest'
import { applyBicepDeployment } from '../src/lib/bicep/deploy.js'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { reconcileCpuRuntime } from '../src/lib/simulation/cpu.js'
import { appArmId } from '../src/lib/simulation/runtime.js'
import { createBehavioralRun, validateBehavioralRun, contextFor } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { appendBicepPreview, latestBicepAttempt, validBicepProvenance } from '../src/lib/bicep/provenance.js'

const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/demo-rg`
const source = { path: 'infra/main.bicep', line: 1, column: 1 }
const resource = (type, name, body = {}) => ({ id: `main#${name}`, kind: 'resource', type, apiVersion: {
  'Microsoft.ManagedIdentity/userAssignedIdentities': '2024-11-30',
  'Microsoft.App/managedEnvironments': '2025-07-01',
  'Microsoft.CognitiveServices/accounts': '2025-06-01',
}[type], name, armId: `${root}/providers/${type}/${name}`, location: 'eastus', source,
body: { name, location: 'eastus', ...body }, bindings: [] })

function setup() {
  const sandbox = createSandbox()
  sandbox.resourceGroups.push({ name: 'demo-rg', location: 'eastus' })
  const graph = { target: { id: root, name: 'demo-rg', location: 'eastus' }, subscriptionId: SUBSCRIPTION_ID,
    order: [resource('Microsoft.ManagedIdentity/userAssignedIdentities', 'app-id'),
      resource('Microsoft.App/managedEnvironments', 'app-env', { properties: { appLogsConfiguration: { destination: 'none' } } })] }
  const run = { sandbox, artifacts: { publishedTags: {}, buildsById: {} }, runtime: { deploymentsByApp: {}, bicep: { nextAttempt: 1, nextPreview: 1, attempts: [], previews: [], currentByTarget: {}, retired: {} } },
    project: { fileVersions: { 'infra/main.bicep': 1 } }, dependencyGenerations: {}, nextSequence: 1 }
  return { run, graph }
}

describe('Bicep incremental deployment', () => {
  it('applies graph order and records a successful attempt; reapply is a no-op', () => {
    const { run, graph } = setup()
    const first = applyBicepDeployment(run, graph, { name: 'first', sourceHash: 'a', parameterHash: 'b' })
    expect(first.record.status).toBe('succeeded')
    expect(first.record.operations.map(item => item.changeType)).toEqual(['create', 'create'])
    expect(first.run.sandbox.managedIdentities).toHaveLength(1)
    expect(first.run.sandbox.containerAppEnvironments).toHaveLength(1)
    const second = applyBicepDeployment(first.run, graph, { name: 'first', sourceHash: 'a', parameterHash: 'b' })
    expect(second.record.operations.map(item => item.changeType)).toEqual(['no-change', 'no-change'])
    expect(second.run.sandbox).toEqual(first.run.sandbox)
    expect(second.record.id).not.toBe(first.record.id)
    expect(latestBicepAttempt(second.run.runtime.bicep, 'DEMO-RG', 'FIRST').id).toBe(second.record.id)
  })

  it('prunes detail while preserving latest and successful summaries and monotonic IDs', () => {
    const { run, graph } = setup()
    let current = run
    for (let index = 0; index < 22; index++) current = applyBicepDeployment(current, graph,
      { name: 'first', sourceHash: `source-${index}`, parameterHash: 'params' }).run
    expect(current.runtime.bicep.attempts).toHaveLength(20)
    expect(current.runtime.bicep.attempts[0].id).toBe('bicep-attempt-3')
    expect(current.runtime.bicep.nextAttempt).toBe(23)
    expect(current.runtime.bicep.currentByTarget['demo-rg/first'].successful.id).toBe('bicep-attempt-22')
    expect(validBicepProvenance(current.runtime.bicep)).toBe(true)
    const withFailure = structuredClone(current)
    for (let index = 0; index < 21; index++) {
      const bad = structuredClone(graph)
      bad.order[0].name = '-invalid'
      bad.order[0].body.name = '-invalid'
      bad.order[0].armId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/-invalid`
      withFailure.runtime.bicep = applyBicepDeployment(withFailure, bad,
        { name: 'first', sourceHash: `broken-${index}`, parameterHash: 'params' }).run.runtime.bicep
    }
    expect(withFailure.runtime.bicep.currentByTarget['demo-rg/first'].successful.id).toBe('bicep-attempt-22')
    expect(validBicepProvenance(withFailure.runtime.bicep)).toBe(true)
    const forgedPruned = structuredClone(withFailure.runtime.bicep)
    forgedPruned.currentByTarget['demo-rg/first'].successful.id = 'bicep-attempt-1'
    expect(validBicepProvenance(forgedPruned)).toBe(false)
    const changedContent = structuredClone(withFailure.runtime.bicep)
    changedContent.currentByTarget['demo-rg/first'].successful.sourceHash = 'forged'
    expect(validBicepProvenance(changedContent)).toBe(false)
  })

  it('validates and migrates an applied native run with persisted provenance', () => {
    const { run: fixtureRun, graph } = setup()
    const lab = { id: 'bicep-native', engineVersion: 2, contentVersion: 1,
      capabilities: { bicepDeployment: true }, tasks: [], seed: () => structuredClone(fixtureRun.sandbox) }
    const run = createBehavioralRun(lab, { attemptId: 'native' })
    const deployed = applyBicepDeployment(run, graph, { name: 'first', sourceHash: 'source', parameterHash: 'params' })
    expect(validateBehavioralRun(deployed.run, lab)).toBe(deployed.run)
    expect(migrateBehavioralRun(structuredClone(deployed.run), lab).runtime.bicep.attempts).toHaveLength(1)
  })

  it('commits a Bicep command effect only with the deployment capability', () => {
    const { run: fixtureRun, graph } = setup()
    const lab = { id: 'bicep-effect', engineVersion: 2, contentVersion: 1,
      capabilities: { bicepDeployment: true }, tasks: [], seed: () => structuredClone(fixtureRun.sandbox) }
    const run = createBehavioralRun(lab, { attemptId: 'effect' })
    const effect = { type: 'bicep-deployment', graph,
      options: { name: 'first', sourceHash: 'source', parameterHash: 'params' } }
    const applied = applyCommandEffects(run, [effect], lab)
    expect(applied.run.runtime.bicep.attempts[0].status).toBe('succeeded')
    expect(validateBehavioralRun(applied.run, lab)).toBe(applied.run)
    expect(() => applyCommandEffects(run, [effect], { capabilities: {} })).toThrow()
    const before = structuredClone(run)
    for (const badVersions of [[], { 'infra/main.bicep': -1 }, { 'infra/main.bicep': '1' }]) {
      expect(() => applyCommandEffects(run, [{ ...effect, options: { ...effect.options, fileVersions: badVersions } }], lab)).toThrow()
      expect(run).toEqual(before)
    }
  })

  it('rejects forged current summaries and missing or reused preview IDs', () => {
    const { run, graph } = setup()
    const applied = applyBicepDeployment(run, graph, { name: 'first', sourceHash: 'source', parameterHash: 'params' }).run
    const valid = state => validateBehavioralRun({ ...createBehavioralRun({ id: 'provenance-check', engineVersion: 2,
      contentVersion: 1, capabilities: { bicepDeployment: true }, tasks: [] }, { attemptId: 'check' }),
      runtime: { ...createBehavioralRun({ id: 'provenance-check', engineVersion: 2,
        contentVersion: 1, capabilities: { bicepDeployment: true }, tasks: [] }, { attemptId: 'check' }).runtime, bicep: state } })
    const forged = structuredClone(applied.runtime.bicep)
    forged.currentByTarget['demo-rg/first'].successful.sourceHash = 'forged'
    expect(() => valid(forged)).toThrow()
    const disconnected = structuredClone(applied.runtime.bicep)
    disconnected.currentByTarget['demo-rg/first'].latest.id = 'bicep-attempt-999'
    expect(() => valid(disconnected)).toThrow()
    const preview = { key: 'demo-rg/first', target: 'demo-rg', name: 'first', sourceHash: 'source',
      parameterHash: 'params', fileVersions: {}, operations: [] }
    const withPreview = appendBicepPreview(applied.runtime.bicep, preview)
    expect(withPreview.previews[0].id).toBe('bicep-preview-1')
    expect(() => valid(withPreview)).not.toThrow()
    const duplicate = structuredClone(withPreview)
    duplicate.previews.push(structuredClone(duplicate.previews[0]))
    expect(() => valid(duplicate)).toThrow()
    const missing = structuredClone(withPreview)
    delete missing.previews[0].id
    expect(() => valid(missing)).toThrow()
  })

  it('keeps completed non-app steps in a failed attempt and never mutates the input', () => {
    const { run, graph } = setup()
    graph.order.push(resource('Microsoft.CognitiveServices/accounts', '-bad-account', {
      kind: 'AIServices', sku: { name: 'S0' }, identity: { type: 'SystemAssigned' },
      properties: { allowProjectManagement: true, customSubDomainName: '-bad-account' },
    }))
    const before = structuredClone(run)
    const applied = applyBicepDeployment(run, graph, { name: 'first', sourceHash: 'a', parameterHash: 'b' })
    expect(applied.record.status).toBe('failed')
    expect(applied.record.operations.map(item => item.changeType)).toEqual(['create', 'create'])
    expect(applied.run.sandbox.managedIdentities).toHaveLength(1)
    expect(applied.run.sandbox.foundryAccounts).toHaveLength(0)
    expect(run).toEqual(before)
  })

  it('uses captured scale policy while a mutable Sandbox app differs', () => {
    const { run } = setup()
    const app = { name: 'api', resourceGroup: 'demo-rg', location: 'eastus', environment: 'app-env',
      environmentResourceGroup: 'demo-rg', cpu: 0.5, memory: '1Gi', minReplicas: 1, maxReplicas: 9,
      scaleRules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }] }
    run.sandbox.containerApps.push(app)
    const id = appArmId(app)
    run.runtime.deploymentsByApp[id] = { status: 'succeeded', active: { generation: 'old',
      scalePolicy: { cpu: 0.5, memory: '1Gi', minReplicas: 1, maxReplicas: 3, scaleRules: app.scaleRules } } }
    const measured = reconcileCpuRuntime(run, { capabilities: { cpuScaling: true } })
    expect(JSON.parse(measured.runtime.cpuByApp[id].policyFingerprint).maxReplicas).toBe(3)
    expect(measured.runtime.cpuByApp[id].readyReplicas).toBe(1)
    expect(reconcileCpuRuntime(measured, { capabilities: { cpuScaling: true } }).dependencyGenerations[`scaling:${id}`]).toBe(1)
  })

  it('initializes bounded provenance, exposes it in context and rejects corrupt records', () => {
    const lab = { id: 'bicep-test', engineVersion: 2, contentVersion: 1,
      capabilities: { bicepDeployment: true }, tasks: [] }
    const run = createBehavioralRun(lab, { attemptId: 'first' })
    expect(contextFor(run).runtime.bicep).toMatchObject({ nextAttempt: 1, attempts: [], previews: [] })
    contextFor(run).runtime.bicep.nextAttempt = 99
    expect(run.runtime.bicep.nextAttempt).toBe(1)
    const old = structuredClone(run); delete old.runtime.bicep
    expect(validateBehavioralRun(old, lab)).toBe(old)
    expect(migrateBehavioralRun(old, lab).runtime.bicep).toMatchObject({ nextAttempt: 1, attempts: [] })
    const corrupt = structuredClone(run)
    corrupt.runtime.bicep.attempts = [{ id: 'bicep-attempt-1' }, { id: 'bicep-attempt-1' }]
    expect(() => validateBehavioralRun(corrupt, lab)).toThrow()
    const oversized = structuredClone(run)
    oversized.runtime.bicep.previews = Array(11).fill({})
    expect(() => validateBehavioralRun(oversized, lab)).toThrow()
  })
})

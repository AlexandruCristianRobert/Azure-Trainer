import { describe, it, expect } from 'vitest'
import { seedAksCapstoneAt } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { inspectAksOwnership, validateAksDeletion } from '../src/lib/kubernetes/capstone/ownership.js'
import { createRegistry } from '../src/lib/sandbox/registry.js'

const command = (run, lab, line) => applyRunAction(run, { type: 'command', line }, lab)
const create = (run, lab) => command(run, lab, 'az group create -n rgcap -l eastus').run

describe('AKS capstone ownership', () => {
  it('starts with only protected prerequisites', () => {
    const { run } = seedAksCapstoneAt()
    expect(run.sandbox.aksClusters).toEqual([])
    expect(run.sandbox.containerRegistries).toEqual([])
    expect(run.artifacts.publishedTags).toEqual({})
    expect(inspectAksOwnership(run).owned).toEqual([])
    expect(inspectAksOwnership(run).protected.length).toBeGreaterThan(0)
  })
  it('rejects protected deletion and create-as-update atomically', () => {
    const { run, lab } = seedAksCapstoneAt()
    for (const line of ['az group delete -n rg-aks-prerequisites --yes', 'az group create -n rg-aks-prerequisites -l westus']) {
      const result = command(run, lab, line)
      expect(result.diagnostics[0].code).toBe('AKS_PROTECTED_RESOURCE')
      expect(result.run).toEqual(run)
    }
  })
  it('records exact groups, registry, cluster and automatic node resources', () => {
    let { run, lab } = seedAksCapstoneAt()
    for (const line of ['az group create -n rgcap -l eastus', 'az acr create -g rgcap -n acrcapstone --sku Basic',
      'az aks create -g rgcap -n akscap --enable-managed-identity --generate-ssh-keys --attach-acr acrcapstone']) {
      const result = command(run, lab, line)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    expect(inspectAksOwnership(run).owned).toHaveLength(6)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toEqual(run)
    const removed = command(run, lab, 'az group delete -n rgcap --yes')
    expect(removed.diagnostics).toEqual([])
    expect(inspectAksOwnership(removed.run).remaining).toEqual([])
    expect(removed.run.runtime.kubernetes.clusters).toEqual({})
    expect(removed.run.stages.aks.deletionReceipts).toHaveLength(6)
  })
  it('does not transfer ownership across same-name resource incarnations', () => {
    let { run, lab } = seedAksCapstoneAt()
    run = create(run, lab)
    const first = inspectAksOwnership(run).owned[0]
    run = command(run, lab, 'az group delete -n rgcap --yes').run
    run = create(run, lab)
    const second = inspectAksOwnership(run).owned[0]
    expect(second.resourceId).toBe(first.resourceId)
    expect(second.sequence).toBeGreaterThan(first.sequence)
    expect(run.stages.aks.creationReceipts).toHaveLength(2)
  })
  it('rejects group cascades containing a foreign child before effects commit', () => {
    let { run, lab } = seedAksCapstoneAt()
    run = create(run, lab)
    run.sandbox = createRegistry(run.sandbox, { resourceGroup: 'rgcap', name: 'acrforeign', sku: 'Basic' }).sandbox
    const id = inspectAksOwnership(run).owned[0].resourceId
    expect(validateAksDeletion(run, [id])[0].code).toBe('AKS_RESOURCE_NOT_OWNED')
    const result = command(run, lab, 'az group delete -n rgcap --yes')
    expect(result.diagnostics[0].code).toBe('AKS_RESOURCE_NOT_OWNED')
    expect(result.run).toEqual(run)
  })
  it('never acquires an existing resource through an update', () => {
    let { run, lab } = seedAksCapstoneAt()
    run = create(run, lab)
    run.sandbox = createRegistry(run.sandbox, { resourceGroup: 'rgcap', name: 'acrforeign', sku: 'Basic' }).sandbox
    run = command(run, lab, 'az acr create -g rgcap -n acrforeign --sku Basic').run
    expect(inspectAksOwnership(run).owned).toHaveLength(1)
  })
  it('rejects ownership from a different attempt', () => {
    let { run, lab } = seedAksCapstoneAt()
    run = create(run, lab)
    run.stages.aks.ownership[0].attemptId = 'foreign'
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
  it('owns an applied application namespace and deletes its descendants with its cluster', () => {
    let { run, lab } = seedAksCapstoneAt()
    for (const line of ['az group create -n rgcap -l eastus',
      'az aks create -g rgcap -n akscap --enable-managed-identity --generate-ssh-keys',
      'az aks get-credentials -g rgcap -n akscap', 'kubectl apply -f k8s/namespace.yaml']) {
      const result = command(run, lab, line)
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    const namespace = inspectAksOwnership(run).owned.find(item => item.type === 'Namespace')
    expect(namespace.parentId).toBe(run.sandbox.aksClusters[0].id)
    run = command(run, lab, 'az group delete -n rgcap --yes').run
    expect(inspectAksOwnership(run).remaining).toEqual([])
    expect(run.stages.aks.deletionReceipts.some(item => item.resourceId === namespace.resourceId)).toBe(true)
  })
  it('rejects a cluster deletion that would strand a foreign node-group child', () => {
    let { run, lab } = seedAksCapstoneAt()
    run = create(run, lab)
    run = command(run, lab, 'az aks create -g rgcap -n akscap --enable-managed-identity --generate-ssh-keys').run
    run.sandbox = createRegistry(run.sandbox, { resourceGroup: run.sandbox.aksClusters[0].nodeResourceGroup, name: 'acrforeign', sku: 'Basic' }).sandbox
    const result = command(run, lab, 'az aks delete -g rgcap -n akscap --yes')
    expect(result.diagnostics[0].code).toBe('AKS_RESOURCE_NOT_OWNED')
    expect(result.run).toEqual(run)
  })
  it('rejects creation beyond the ownership bound before committing', () => {
    let { run, lab } = seedAksCapstoneAt()
    for (let index = 0; index < 128; index++) run = command(run, lab, `az group create -n rgcap${index} -l eastus`).run
    expect(inspectAksOwnership(run).owned).toHaveLength(128)
    const result = command(run, lab, 'az group create -n rgexcess -l eastus')
    expect(result.diagnostics[0].code).toBe('AKS_OWNERSHIP_LIMIT')
    expect(result.run).toEqual(run)
  })
})

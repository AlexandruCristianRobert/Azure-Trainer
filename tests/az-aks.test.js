import { expect, it } from 'vitest'
import { createAksTestRun, act } from './helpers/aks.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'

it('creates a kubelet grant and keeps it separate from application access', () => {
  let { run, lab } = createAksTestRun()
  for (const line of [
    'az group create -n rg-aks-test -l eastus',
    'az acr create -g rg-aks-test -n acrakstest --sku Basic',
    'az aks create -g rg-aks-test -n aks-test --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys --attach-acr acrakstest',
    'az aks get-credentials -g rg-aks-test -n aks-test',
  ]) run = act(run, lab, { type: 'command', line }).run
  const cluster = run.sandbox.aksClusters[0]
  expect(run.sandbox.roleAssignments).toEqual([expect.objectContaining({ principalId: cluster.identityProfile.kubeletidentity.objectId, roleName: 'AcrPull' })])
  expect(run.runtime.kubernetes.contexts['aks-test']).toMatchObject({ clusterId: cluster.id, namespace: 'default' })
  expect(run.runtime.kubernetes.clusters[cluster.id].resources).toHaveProperty('Namespace//default')
  expect(validateBehavioralRun(run, lab)).toBe(run)
})

it('does not mutate for conflicting cluster creation or help', () => {
  let { run, lab } = createAksTestRun()
  run = act(run, lab, { type: 'command', line: 'az group create -n rg-aks-test -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rg-aks-test -n AKS-Test --enable-managed-identity --generate-ssh-keys' }).run
  const before = structuredClone(run)
  const failed = act(run, lab, { type: 'command', line: 'az aks create -g rg-aks-test -n aks-test --node-count 3 --enable-managed-identity --generate-ssh-keys' })
  expect(failed.run.sandbox).toEqual(before.sandbox)
  expect(act(run, lab, { type: 'command', line: 'az aks create --help' }).run.sandbox).toEqual(run.sandbox)
})

it('detaches and reattaches an ACR and removes contexts on cluster deletion', () => {
  let { run, lab } = createAksTestRun()
  for (const line of ['az group create -n rg-aks-test -l eastus', 'az acr create -g rg-aks-test -n acrakstest --sku Basic', 'az aks create -g rg-aks-test -n aks-test --enable-managed-identity --generate-ssh-keys --attach-acr acrakstest', 'az aks get-credentials -g rg-aks-test -n aks-test', 'az aks update -g rg-aks-test -n aks-test --detach-acr acrakstest']) run = act(run, lab, { type: 'command', line }).run
  expect(run.sandbox.roleAssignments).toEqual([])
  run = act(run, lab, { type: 'command', line: 'az aks update -g rg-aks-test -n aks-test --attach-acr acrakstest' }).run
  expect(run.sandbox.roleAssignments).toHaveLength(1)
  run = act(run, lab, { type: 'command', line: 'az aks delete -g rg-aks-test -n aks-test --yes' }).run
  expect(run.sandbox.aksClusters).toEqual([])
  expect(run.runtime.kubernetes.contexts).toEqual({})
})

it('does not adopt a pre-existing deterministic node resource group', () => {
  let { run, lab } = createAksTestRun()
  run = act(run, lab, { type: 'command', line: 'az group create -n rg-aks-test -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az group create -n MC_rg-aks-test_aks-test_eastus -l eastus' }).run
  const result = act(run, lab, { type: 'command', line: 'az aks create -g rg-aks-test -n aks-test --enable-managed-identity --generate-ssh-keys' })
  expect(result.run.sandbox.aksClusters).toEqual([])
  expect(result.run.sandbox.resourceGroups.some(group => group.name === 'MC_rg-aks-test_aks-test_eastus')).toBe(true)
})

import { expect, it } from 'vitest'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { emptyKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { createAksTestRun, act } from './helpers/aks.js'

it('initializes versioned Kubernetes state only for Kubernetes Labs', () => {
  const { lab, run } = createAksTestRun()
  expect(run.runtime.kubernetes).toEqual(emptyKubernetesRuntime())
  expect(validateBehavioralRun(run, lab)).toBe(run)
})

it('keeps legacy non-AKS runs without optional AKS fields valid', () => {
  const { lab, run } = createAksTestRun({ capabilities: { acrBuild: true } })
  const legacy = structuredClone(run)
  delete legacy.runtime.kubernetes
  delete legacy.sandbox.aksClusters
  expect(validateBehavioralRun(legacy, lab)).toBe(legacy)
  expect(migrateBehavioralRun(legacy, lab).runtime.kubernetes).toBeUndefined()
})

it('does not migrate a Kubernetes Lab whose runtime extension is missing', () => {
  const { lab, run } = createAksTestRun()
  const corrupt = structuredClone(run)
  delete corrupt.runtime.kubernetes
  expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
  expect(() => migrateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
})

it('rejects malformed Kubernetes cluster state instead of healing it', () => {
  const { lab, run } = createAksTestRun()
  const corrupt = structuredClone(run)
  corrupt.runtime.kubernetes.clusters = { forged: {} }
  expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
})

it('rejects malformed Kubernetes resource collections and request records', () => {
  const { lab, run } = createAksTestRun()
  const corrupt = structuredClone(run)
  corrupt.runtime.kubernetes.requests = ['forged']
  expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
})

it('rejects an invalid Kubernetes context namespace', () => {
  const { lab, run } = createAksTestRun()
  let created = act(run, lab, { type: 'command', line: 'az group create -n rg-context -l eastus' }).run
  created = act(created, lab, { type: 'command', line: 'az aks create -g rg-context -n aks-context --enable-managed-identity --generate-ssh-keys' }).run
  const corrupt = structuredClone(created)
  corrupt.runtime.kubernetes.contexts.current = { clusterId: corrupt.sandbox.aksClusters[0].id, namespace: 'bad name' }
  corrupt.runtime.kubernetes.currentContext = 'current'
  expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
})

it('rejects a cluster state missing its required default namespaces', () => {
  const { lab, run } = createAksTestRun()
  let created = run
  // Create state through the reducer so the test has a real cluster record.
  created = act(created, lab, { type: 'command', line: 'az group create -n rg-aks-test -l eastus' }).run
  created = act(created, lab, { type: 'command', line: 'az aks create -g rg-aks-test -n aks-test --enable-managed-identity --generate-ssh-keys' }).run
  const corrupt = structuredClone(created)
  delete corrupt.runtime.kubernetes.clusters[corrupt.sandbox.aksClusters[0].id].resources['Namespace//kube-system']
  expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
})

it('rejects persisted Kubernetes resources with unknown kinds or missing namespaces', () => {
  const { lab, run: initial } = createAksTestRun()
  let run = act(initial, lab, { type: 'command', line: 'az group create -n rg-state -l eastus' }).run
  run = act(run, lab, { type: 'command', line: 'az aks create -g rg-state -n aks-state --enable-managed-identity --generate-ssh-keys' }).run
  const clusterId = run.sandbox.aksClusters[0].id

  const unknownKind = structuredClone(run)
  unknownKind.runtime.kubernetes.clusters[clusterId].resources['CronJob/default/example'] = {
    apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: 'example', namespace: 'default', uid: 'forged-1', resourceVersion: '1' }, spec: {},
  }
  expect(() => validateBehavioralRun(unknownKind, lab)).toThrow(/Kubernetes/)

  const missingNamespace = structuredClone(run)
  missingNamespace.runtime.kubernetes.clusters[clusterId].resources['Service/absent/example'] = {
    apiVersion: 'v1', kind: 'Service', metadata: { name: 'example', namespace: 'absent', uid: 'forged-2', resourceVersion: '1' }, spec: {},
  }
  expect(() => validateBehavioralRun(missingNamespace, lab)).toThrow(/Kubernetes/)
})

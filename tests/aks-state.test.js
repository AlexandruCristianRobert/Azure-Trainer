import { expect, it } from 'vitest'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { emptyKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { createAksTestRun, seedFoundation, act } from './helpers/aks.js'

it('initializes versioned Kubernetes state only for Kubernetes Labs', () => {
  const { lab, run } = createAksTestRun()
  expect(run.runtime.kubernetes).toEqual(emptyKubernetesRuntime())
  expect(validateBehavioralRun(run, lab)).toBe(run)
})

it('migrates an eligible saved rollout run before strict validation without replacing owned resources', () => {
  const { run, lab: baselineLab, clusterId } = seedFoundation()
  const lab = { ...baselineLab, capabilities: { ...baselineLab.capabilities, kubernetesRollouts: true } }
  for (const accept of [saved => validateBehavioralRun(saved, lab), saved => migrateBehavioralRun(saved, lab)]) {
    const saved = JSON.parse(JSON.stringify(run)); const prior = structuredClone(saved.runtime.kubernetes.clusters[clusterId].resources)
    const accepted = accept(saved)
    expect(accepted.nextSequence).toBe(run.nextSequence)
    expect(accepted.runtime.kubernetes.clusters[clusterId].resources).toEqual(prior)
    const deployment = prior['Deployment/assistant/assistant']
    const rs = Object.values(prior).find(item => item.kind === 'ReplicaSet')
    expect(accepted.runtime.kubernetes.clusters[clusterId].rollouts.deployments[deployment.metadata.uid]).toMatchObject({ currentRevision: 1, currentRsUid: rs.metadata.uid, nextRevision: 2 })
    expect(validateBehavioralRun(accepted, lab)).toBe(accepted)
  }
  const corrupt = JSON.parse(JSON.stringify(run)); delete corrupt.runtime.kubernetes.clusters[clusterId].resources['Namespace//kube-system']
  expect(() => migrateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
  expect(corrupt.runtime.kubernetes.clusters[clusterId].rollouts).toBeUndefined()
  const malformed = JSON.parse(JSON.stringify(run)); malformed.runtime.kubernetes.clusters[clusterId].rollouts = null
  expect(() => migrateBehavioralRun(malformed, lab)).toThrow(/Kubernetes/)
  const configured = JSON.parse(JSON.stringify(run))
  configured.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].spec.strategy = { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  expect(migrateBehavioralRun(configured, lab).runtime.kubernetes.clusters[clusterId].rollouts.version).toBe(1)
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

it('accepts a structurally valid Service after its Deployment is deleted', () => {
  let { lab, run, clusterId } = seedFoundation()
  run = act(run, lab, { type: 'command', line: 'kubectl delete deployment assistant -n assistant' }).run
  const resources = run.runtime.kubernetes.clusters[clusterId].resources
  expect(resources['Service/assistant/assistant']).toBeTruthy()
  expect(resources['Deployment/assistant/assistant']).toBeUndefined()
  expect(validateBehavioralRun(run, lab)).toBe(run)
})

import { expect, it } from 'vitest'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { emptyKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { createAksTestRun } from './helpers/aks.js'

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

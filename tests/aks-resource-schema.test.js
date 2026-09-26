import { describe, expect, it } from 'vitest'
import { parseCpuQuantity, parseMemoryQuantity } from '../src/lib/kubernetes/quantities.js'
import { normalizeContainerResources } from '../src/lib/kubernetes/resource-schema.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'
import { RESOURCE_SOLUTION_FILES } from '../src/data/templates/aks-python/resources.js'
import { RESOURCE_MANIFEST } from '../src/data/templates/aks-python/resources.js'
import { act, createAksTestRun } from './helpers/aks.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

describe('AKS resource quantity schema', () => {
  it('normalizes equivalent CPU and memory quantities exactly', () => {
    expect(parseCpuQuantity('0.25')).toMatchObject({ millicores: 250, diagnostics: [] })
    expect(parseCpuQuantity('250m')).toMatchObject({ millicores: 250, diagnostics: [] })
    expect(parseMemoryQuantity('256Mi')).toMatchObject({ bytes: 256 * 1024 * 1024, diagnostics: [] })
    expect(parseMemoryQuantity('256M')).toMatchObject({ bytes: 256_000_000, diagnostics: [] })
  })

  it('defaults missing requests from supplied limits while retaining authored values', () => {
    const result = normalizeContainerResources({ limits: { cpu: '500m', memory: '256Mi' } })
    expect(result.diagnostics).toEqual([])
    expect(result.authored).toEqual({ cpuRequest: null, cpuLimit: '500m', memoryRequest: null, memoryLimit: '256Mi' })
    expect(result.effective).toEqual({ cpuRequestM: 500, cpuLimitM: 500, memoryRequestBytes: 256 * 1024 * 1024, memoryLimitBytes: 256 * 1024 * 1024 })
  })

  it('keeps absent and explicit zero CPU requests distinct for HPA eligibility', () => {
    expect(normalizeContainerResources({}).effective).toMatchObject({ cpuRequestM: null, cpuLimitM: null })
    expect(normalizeContainerResources({ requests: { cpu: '0' } })).toMatchObject({ diagnostics: [], effective: { cpuRequestM: 0, cpuLimitM: null } })
  })

  it.each([
    [{ requests: null }, 'INVALID_RESOURCES'],
    [{ limits: { cpu: null } }, 'INVALID_QUANTITY'],
    [{ requests: { memory: null } }, 'INVALID_QUANTITY'],
  ])('rejects explicit null resource values instead of treating them as omitted: %o', (resources, code) => {
    expect(normalizeContainerResources(resources).diagnostics).toContainEqual(expect.objectContaining({ code }))
  })

  it.each([
    ['sub-millicore CPU precision', () => parseCpuQuantity('0.0005'), 'UNSUPPORTED_QUANTITY'],
    ['valid-but-unmodeled CPU exponent notation', () => parseCpuQuantity('1e-3'), 'UNSUPPORTED_QUANTITY'],
    ['unknown CPU suffix', () => parseCpuQuantity('250x'), 'INVALID_QUANTITY'],
    ['unknown memory suffix', () => parseMemoryQuantity('128MB'), 'INVALID_QUANTITY'],
    ['valid-but-unmodeled milli-byte memory', () => parseMemoryQuantity('1m'), 'UNSUPPORTED_QUANTITY'],
    ['valid-but-unmodeled exponent notation', () => parseMemoryQuantity('1e3'), 'UNSUPPORTED_QUANTITY'],
    ['fractional byte memory', () => parseMemoryQuantity('0.5'), 'UNSUPPORTED_QUANTITY'],
    ['request over limit', () => normalizeContainerResources({ requests: { cpu: '600m' }, limits: { cpu: '500m' } }), 'RESOURCE_REQUEST_EXCEEDS_LIMIT'],
  ])('reports %s', (_name, run, code) => {
    expect(run().diagnostics).toContainEqual(expect.objectContaining({ code }))
  })

  it('accepts resource declarations and six replicas only for resource-enabled Kubernetes Labs', () => {
    const deployment = parseKubernetesYaml(RESOURCE_SOLUTION_FILES['k8s/deployment.yaml']).documents[0]
    expect(validateKubernetesObject(deployment, { namespace: 'assistant', capabilities: { kubernetesConfiguration: true, kubernetesProbes: true } }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_FIELD' }))
    deployment.spec.replicas = 6
    const accepted = validateKubernetesObject(deployment, { namespace: 'assistant', capabilities: { kubernetesConfiguration: true, kubernetesProbes: true, kubernetesResources: true } })
    expect(accepted.diagnostics).toEqual([])
    expect(accepted.object.spec.template.spec.containers[0].resources).toMatchObject({ limits: { cpu: '500m' } })
  })

  it('applies and dry-runs resource workloads only when the Lab enables resource support', () => {
    const seed = resourcesEnabled => {
      const { lab: initialLab, run: initial } = createAksTestRun({
      manifestId: RESOURCE_MANIFEST.id,
      capabilities: { acrBuild: true, kubernetes: true, kubernetesConfiguration: true, kubernetesProbes: true, kubernetesResources: resourcesEnabled },
      initialProjectFiles: structuredClone(RESOURCE_SOLUTION_FILES),
      })
      const lab = { ...initialLab, capabilities: { ...initialLab.capabilities, kubernetesResources: resourcesEnabled }, healthFixture: { initializationSeconds: 24 } }
      let run = initial
      for (const line of [
      'az group create -n rgaksresources -l eastus',
      'az acr create -g rgaksresources -n acraksprobesguided --sku Basic',
      'az acr build --registry acraksprobesguided -t assistant:health-v1 .',
      'az aks create -g rgaksresources -n aksresources --enable-managed-identity --generate-ssh-keys --attach-acr acraksprobesguided',
      'az aks get-credentials -g rgaksresources -n aksresources',
      'kubectl apply -f k8s/namespace.yaml',
      'kubectl apply -f k8s/configmap.yaml',
      'kubectl apply -f k8s/secret.yaml',
    ]) run = act(run, lab, { type: 'command', line }).run
      return { lab, run }
    }
    const { lab, run: seeded } = seed(true)
    let run = act(seeded, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml --dry-run=client -o json' }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run

    expect(validateBehavioralRun(run, lab)).toBe(run)
    const { lab: oldLab, run: oldRun } = seed(false)
    const dryRun = applyRunAction(oldRun, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml --dry-run=client -o json' }, oldLab)
    expect(dryRun.lines).toContainEqual(expect.objectContaining({ kind: 'err', text: expect.stringContaining("field 'resources'") }))
    const apply = applyRunAction(oldRun, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, oldLab)
    expect(apply.lines).toContainEqual(expect.objectContaining({ kind: 'err', text: expect.stringContaining("field 'resources'") }))
  })
})

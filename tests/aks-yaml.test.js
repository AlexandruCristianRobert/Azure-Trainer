import { describe, expect, it } from 'vitest'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'
import { deploymentYaml, namespaceYaml, serviceYaml } from './fixtures/aks/foundation-yaml.js'

const options = { namespace: 'assistant', capabilities: {} }

describe('Kubernetes YAML parsing', () => {
  it('parses ordinary block YAML and retains serializable source locations aligned with documents', () => {
    const parsed = parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.documents).toHaveLength(1)
    expect(parsed.documents[0]).toMatchObject({ kind: 'Deployment', spec: { replicas: 2 } })
    expect(parsed.locations).toEqual([expect.objectContaining({ path: 'k8s/deployment.yaml', line: 1, column: 1 })])
  })

  it('parses multiple YAML documents in input order and ignores empty documents', () => {
    const parsed = parseKubernetesYaml(`${namespaceYaml}\n---\n${serviceYaml}\n---\n# empty\n`, 'k8s/all.yaml')
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.documents.map(document => document.kind)).toEqual(['Namespace', 'Service'])
  })

  it('reports duplicate keys instead of silently choosing the last value', () => {
    const parsed = parseKubernetesYaml('kind: Service\nkind: Deployment\n', 'test.yaml')
    expect(parsed.documents).toEqual([])
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'YAML_PARSE', path: 'test.yaml' })
  })

  it.each([
    ['anchor', 'kind: &kind Service\napiVersion: v1\nmetadata: {name: api}\n'],
    ['custom tag', 'kind: !custom Service\napiVersion: v1\nmetadata: {name: api}\n'],
    ['unsafe map key', '? [unsafe, key]\n: value\n'],
  ])('rejects unsupported %s syntax', (_name, text) => {
    const parsed = parseKubernetesYaml(text, 'test.yaml')
    expect(parsed.documents).toEqual([])
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'YAML_UNSUPPORTED', path: 'test.yaml' })
  })

  it('reports malformed indentation and an all-empty input with located diagnostics', () => {
    const malformed = parseKubernetesYaml('kind: Service\n  metadata:\n    name: api\n', 'bad.yaml')
    const empty = parseKubernetesYaml('# comment only\n---\n', 'empty.yaml')
    expect(malformed.diagnostics[0]).toMatchObject({ code: 'YAML_PARSE', path: 'bad.yaml', line: expect.any(Number), column: expect.any(Number) })
    expect(empty.diagnostics[0]).toMatchObject({ code: 'NO_MANIFESTS', path: 'empty.yaml', line: 1, column: 1 })
  })
})

describe('Kubernetes foundation schema', () => {
  it('uses parser source locations in validation diagnostics without adding metadata to parsed values', () => {
    const parsed = parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml')
    const deployment = structuredClone(parsed.documents[0])
    deployment.spec.template.metadata.labels.app = 'different'
    const checked = validateKubernetesObject(deployment, { ...options, sourceLocation: parsed.locations[0] })
    expect(checked.diagnostics[0]).toMatchObject({ code: 'KUBE_SELECTOR_MISMATCH', path: 'k8s/deployment.yaml', line: 1, column: 1 })
    expect(parsed.documents[0]).not.toHaveProperty('__sourceLocation')
  })

  it('accepts the foundation manifests and resolves a missing namespaced identity from options', () => {
    const namespace = validateKubernetesObject(parseKubernetesYaml(namespaceYaml, 'k8s/namespace.yaml').documents[0], options)
    const deployment = validateKubernetesObject(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0], options)
    const service = validateKubernetesObject(parseKubernetesYaml(serviceYaml, 'k8s/service.yaml').documents[0], options)
    expect(namespace).toMatchObject({ diagnostics: [], object: { kind: 'Namespace', metadata: { name: 'assistant' } } })
    expect(deployment).toMatchObject({ diagnostics: [], object: { metadata: { namespace: 'assistant' } } })
    expect(service).toMatchObject({ diagnostics: [], object: { metadata: { namespace: 'assistant' } } })

    const missingNamespace = structuredClone(deployment.object)
    delete missingNamespace.metadata.namespace
    expect(validateKubernetesObject(missingNamespace, options)).toMatchObject({ diagnostics: [], object: { metadata: { namespace: 'assistant' } } })
  })

  it('rejects selector mismatches, boolean env values, and unsupported fields', () => {
    const deployment = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    deployment.spec.template.metadata.labels.app = 'different'
    expect(validateKubernetesObject(deployment, options).diagnostics[0]).toMatchObject({ code: 'KUBE_SELECTOR_MISMATCH' })

    const booleanEnv = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    booleanEnv.spec.template.spec.containers[0].env[0].value = true
    expect(validateKubernetesObject(booleanEnv, options).diagnostics[0]).toMatchObject({ code: 'INVALID_ENV_VALUE' })

    const field = structuredClone(parseKubernetesYaml(serviceYaml, 'k8s/service.yaml').documents[0])
    field.spec.clusterIP = '10.0.0.1'
    expect(validateKubernetesObject(field, options).diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_FIELD' })
  })

  it('rejects namespace mismatches and namespace fields on cluster-scoped resources', () => {
    const deployment = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    deployment.metadata.namespace = 'other'
    expect(validateKubernetesObject(deployment, options).diagnostics[0]).toMatchObject({ code: 'KUBE_NAMESPACE_MISMATCH' })

    const namespace = structuredClone(parseKubernetesYaml(namespaceYaml, 'k8s/namespace.yaml').documents[0])
    namespace.metadata.namespace = 'assistant'
    expect(validateKubernetesObject(namespace, options).diagnostics[0]).toMatchObject({ code: 'KUBE_CLUSTER_SCOPED' })
  })

  it('accepts a Service named targetPort for per-Pod resolution', () => {
    const deployment = validateKubernetesObject(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0], options).object
    const service = validateKubernetesObject(parseKubernetesYaml(serviceYaml, 'k8s/service.yaml').documents[0], {
      ...options, capabilities: { deployments: [deployment] },
    })
    expect(service.diagnostics).toEqual([])

    const invalid = structuredClone(parseKubernetesYaml(serviceYaml, 'k8s/service.yaml').documents[0])
    invalid.spec.ports[0].targetPort = 'missing'
    expect(validateKubernetesObject(invalid, { ...options, capabilities: { deployments: [deployment] } }).diagnostics).toEqual([])
  })

  it('accepts an unnamed numeric container port and numeric Service targetPort', () => {
    const deployment = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    delete deployment.spec.template.spec.containers[0].ports[0].name
    const service = structuredClone(parseKubernetesYaml(serviceYaml, 'k8s/service.yaml').documents[0])
    service.spec.ports[0].targetPort = 8080
    expect(validateKubernetesObject(deployment, options).diagnostics).toEqual([])
    expect(validateKubernetesObject(service, options).diagnostics).toEqual([])
  })

  it('resolves an explicit manifest namespace without a selected namespace and rejects only explicit conflicts', () => {
    const deployment = parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0]
    expect(validateKubernetesObject(deployment, { capabilities: {} })).toMatchObject({ diagnostics: [], object: { metadata: { namespace: 'assistant' } } })
    expect(validateKubernetesObject(deployment, { namespace: 'other', capabilities: {} }).diagnostics[0])
      .toMatchObject({ code: 'KUBE_NAMESPACE_MISMATCH' })
  })

  it('rejects DNS names and selector labels outside the supported Kubernetes syntax', () => {
    const invalidName = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    invalidName.metadata.name = 'a'.repeat(64)
    expect(validateKubernetesObject(invalidName, options).diagnostics[0]).toMatchObject({ code: 'INVALID_NAME' })
    expect(validateKubernetesObject(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0], {
      namespace: 'a'.repeat(64), capabilities: {},
    }).diagnostics[0]).toMatchObject({ code: 'INVALID_NAMESPACE' })

    const invalidKey = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    invalidKey.spec.selector.matchLabels['bad key'] = 'assistant'
    invalidKey.spec.template.metadata.labels['bad key'] = 'assistant'
    expect(validateKubernetesObject(invalidKey, options).diagnostics[0]).toMatchObject({ code: 'INVALID_LABELS' })

    const invalidValue = structuredClone(parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0])
    invalidValue.spec.selector.matchLabels.app = 'bad value'
    invalidValue.spec.template.metadata.labels.app = 'bad value'
    expect(validateKubernetesObject(invalidValue, options).diagnostics[0]).toMatchObject({ code: 'INVALID_LABELS' })
  })
})

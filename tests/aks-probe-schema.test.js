import { describe, expect, it } from 'vitest'
import { parseHttpProbe } from '../src/lib/kubernetes/probe-schema.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'
import { deploymentYaml } from './fixtures/aks/foundation-yaml.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'

const probe = {
  httpGet: { path: '/health/ready', port: 'http' },
}

describe('AKS HTTP probe schema', () => {
  it('normalizes Kubernetes defaults and preserves a named HTTP port', () => {
    expect(parseHttpProbe(probe, 'readiness', 'k8s/deployment.yaml')).toEqual({
      probe: {
        httpGet: { path: '/health/ready', port: 'http', scheme: 'HTTP' },
        initialDelaySeconds: 0,
        periodSeconds: 10,
        timeoutSeconds: 1,
        failureThreshold: 3,
        successThreshold: 1,
      },
      diagnostics: [],
    })
  })

  it('accepts valid but wrong endpoint paths and ports for runtime probe failure', () => {
    expect(parseHttpProbe({ httpGet: { path: '/health/not-declared', port: 65535 } }, 'liveness', 'k8s/deployment.yaml'))
      .toMatchObject({ diagnostics: [], probe: { httpGet: { path: '/health/not-declared', port: 65535 } } })
    expect(parseHttpProbe({ httpGet: { path: '/health/live', port: 'missing-port' } }, 'liveness', 'k8s/deployment.yaml'))
      .toMatchObject({ diagnostics: [], probe: { httpGet: { port: 'missing-port' } } })
  })

  it.each([
    ['relative path', { httpGet: { path: 'health/ready', port: 8080 } }, 'INVALID_PROBE_PATH'],
    ['zero period', { ...probe, periodSeconds: 0 }, 'INVALID_PROBE_PERIOD'],
    ['startup success threshold above one', { ...probe, successThreshold: 2 }, 'INVALID_PROBE_SUCCESS_THRESHOLD'],
    ['gRPC field', { ...probe, grpc: { port: 8080 } }, 'UNSUPPORTED_PROBE_FIELD'],
    ['HTTP headers', { httpGet: { ...probe.httpGet, httpHeaders: [] } }, 'UNSUPPORTED_HTTP_PROBE_FIELD'],
  ])('reports %s with a located diagnostic', (_name, value, code) => {
    const result = parseHttpProbe(value, 'startup', 'k8s/deployment.yaml')
    expect(result.probe).toBeNull()
    expect(result.diagnostics[0]).toMatchObject({ code, path: 'k8s/deployment.yaml', line: 1, column: 1 })
  })

  it('adds normalized probes and Pod lifecycle defaults to Kubernetes deployments', () => {
    const deployment = parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0]
    deployment.spec.template.spec.terminationGracePeriodSeconds = 1
    deployment.spec.template.spec.restartPolicy = 'Always'
    deployment.spec.template.spec.containers[0].readinessProbe = probe

    const result = validateKubernetesObject(deployment, {
      namespace: 'assistant', capabilities: { kubernetesProbes: true },
    })

    expect(result.diagnostics).toEqual([])
    expect(result.object.spec.template.spec).toMatchObject({
      terminationGracePeriodSeconds: 1,
      restartPolicy: 'Always',
      containers: [{ readinessProbe: { periodSeconds: 10, successThreshold: 1 } }],
    })
  })

  it('leaves the input untouched and locates schema diagnostics at the manifest root', () => {
    const deployment = parseKubernetesYaml(deploymentYaml, 'k8s/deployment.yaml').documents[0]
    deployment.spec.template.spec.containers[0].startupProbe = { httpGet: { path: '/health/startup', port: 8080 }, successThreshold: 2 }
    const original = structuredClone(deployment)

    const invalid = validateKubernetesObject(deployment, {
      namespace: 'assistant', capabilities: { kubernetesProbes: true }, sourceLocation: { path: 'k8s/deployment.yaml', line: 12, column: 3 },
    })

    expect(deployment).toEqual(original)
    expect(invalid.diagnostics[0]).toMatchObject({ code: 'INVALID_PROBE_SUCCESS_THRESHOLD', path: 'k8s/deployment.yaml', line: 12, column: 3 })
  })
})

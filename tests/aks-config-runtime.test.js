import { expect, it } from 'vitest'
import { resolvePodConfiguration } from '../src/lib/kubernetes/configuration.js'
import { kubeObjectKey } from '../src/lib/kubernetes/objects.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'

const configMap = (namespace, data) => ({
  apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'settings', namespace }, data,
})

const secret = (namespace, data) => ({
  apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace }, type: 'Opaque', data,
})

it('does not borrow a Secret from another namespace', () => {
  const resources = {
    [kubeObjectKey('Secret', 'other', 'credentials')]: secret('other', { PGPASSWORD: btoa('fictional') }),
  }
  const podSpec = { containers: [{ name: 'api', env: [{ name: 'PGPASSWORD', valueFrom: {
    secretKeyRef: { name: 'credentials', key: 'PGPASSWORD' },
  } }] }] }

  const result = resolvePodConfiguration(resources, 'assistant', podSpec)

  expect(result.diagnostics[0].code).toBe('KUBE_SECRET_MISSING')
  expect(result.environment.PGPASSWORD).toBeUndefined()
})

it('omits a missing optional environment reference but blocks a required one', () => {
  const podSpec = { containers: [{ name: 'api', env: [
    { name: 'OPTIONAL', valueFrom: { configMapKeyRef: { name: 'settings', key: 'missing', optional: true } } },
    { name: 'REQUIRED', valueFrom: { configMapKeyRef: { name: 'settings', key: 'required' } } },
  ] }] }

  const result = resolvePodConfiguration({ [kubeObjectKey('ConfigMap', 'assistant', 'settings')]: configMap('assistant', {}) }, 'assistant', podSpec)

  expect(result.environment).toEqual({})
  expect(result.diagnostics.map(item => item.code)).toEqual(['KUBE_CONFIGMAP_KEY_MISSING'])
})

it('decodes referenced Secret values and captures mounted ConfigMap files', () => {
  const resources = {
    [kubeObjectKey('Secret', 'assistant', 'credentials')]: secret('assistant', { PGPASSWORD: btoa('fictional-password') }),
    [kubeObjectKey('ConfigMap', 'assistant', 'settings')]: configMap('assistant', { 'settings.json': '{"display_name":"Training"}' }),
  }
  const podSpec = { containers: [{ name: 'api', env: [{ name: 'PGPASSWORD', valueFrom: { secretKeyRef: { name: 'credentials', key: 'PGPASSWORD' } } }], volumeMounts: [{ name: 'settings', mountPath: '/etc/assistant', readOnly: true }] }], volumes: [{ name: 'settings', configMap: { name: 'settings', items: [{ key: 'settings.json', path: 'settings.json' }] } }] }

  const result = resolvePodConfiguration(resources, 'assistant', podSpec)

  expect(result.diagnostics).toEqual([])
  expect(result.environment).toEqual({ PGPASSWORD: 'fictional-password' })
  expect(result.files).toEqual({ '/etc/assistant/settings.json': '{"display_name":"Training"}' })
  expect(result.configRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'Secret', namespace: 'assistant', name: 'credentials', key: 'PGPASSWORD', mode: 'env', target: 'PGPASSWORD' }),
    expect.objectContaining({ kind: 'ConfigMap', namespace: 'assistant', name: 'settings', key: 'settings.json', mode: 'file', target: '/etc/assistant/settings.json' }),
  ]))
})

it('normalizes Secret stringData over encoded data and rejects invalid encoded data', () => {
  const normalized = validateKubernetesObject({
    apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace: 'assistant' }, type: 'Opaque',
    data: { PGPASSWORD: btoa('old') }, stringData: { PGPASSWORD: 'new' },
  }, { capabilities: { kubernetesConfiguration: true } })
  const invalid = validateKubernetesObject({
    apiVersion: 'v1', kind: 'Secret', metadata: { name: 'bad', namespace: 'assistant' }, type: 'Opaque', data: { TOKEN: 'not_base64!' },
  }, { capabilities: { kubernetesConfiguration: true } })

  expect(normalized.diagnostics).toEqual([])
  expect(normalized.object).toMatchObject({ type: 'Opaque', data: { PGPASSWORD: btoa('new') } })
  expect(normalized.object.stringData).toBeUndefined()
  expect(invalid.diagnostics[0].code).toBe('INVALID_SECRET_DATA')
})

it('rejects environment entries that combine a literal and a configuration reference', () => {
  const result = validateKubernetesObject({
    apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'assistant' },
    spec: { replicas: 1, selector: { matchLabels: { app: 'api' } }, template: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'api', image: 'example/api:v1', imagePullPolicy: 'Always', ports: [{ containerPort: 8080 }], env: [{ name: 'APP_ENV', value: 'training', valueFrom: { configMapKeyRef: { name: 'settings', key: 'APP_ENV' } } }] }] } } },
  }, { capabilities: { kubernetesConfiguration: true } })

  expect(result.diagnostics[0].code).toBe('INVALID_ENV_SOURCE')
})

const allowedKinds = new Set(['Namespace', 'Deployment', 'Service', 'ConfigMap', 'Secret'])
const namePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const labelNamePattern = /^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?$/
const validDnsName = value => typeof value === 'string' && value.length <= 63 && namePattern.test(value)

function diag(code, value, object, message = undefined) {
  const source = object?.sourceLocation
  return { code, message: message ?? `${value ?? 'Kubernetes object'} is not supported.`, path: source?.path ?? '', line: source?.line ?? 1, column: source?.column ?? 1 }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function clone(value) { return structuredClone(value) }

function allowed(value, fields, root) {
  if (!object(value)) return diag('INVALID_FIELD', 'Expected an object.', root)
  const unknown = Object.keys(value).find(key => !fields.has(key))
  return unknown ? diag('UNSUPPORTED_FIELD', unknown, root, `The field '${unknown}' is outside the supported Kubernetes subset.`) : null
}

function named(value, root, field = 'name') {
  return validDnsName(value)
    ? null : diag('INVALID_NAME', field, root, `${field} must be a lowercase Kubernetes name.`)
}

function validLabelKey(value) {
  if (typeof value !== 'string') return false
  const slash = value.indexOf('/')
  const prefix = slash < 0 ? null : value.slice(0, slash)
  const name = slash < 0 ? value : value.slice(slash + 1)
  if (slash >= 0 && (!prefix || value.indexOf('/', slash + 1) >= 0 || prefix.length > 253)) return false
  if (prefix && prefix.split('.').some(part => !namePattern.test(part) || part.length > 63)) return false
  return name.length <= 63 && labelNamePattern.test(name)
}

function validLabelValue(value) { return typeof value === 'string' && (value === '' || (value.length <= 63 && labelNamePattern.test(value))) }
function validLabels(labels) { return object(labels) && Object.entries(labels).every(([key, value]) => validLabelKey(key) && validLabelValue(value)) }

function metadata(value, root, namespaced, selectedNamespace) {
  const issue = allowed(value, new Set(['name', 'namespace', 'labels']), root)
  if (issue) return issue
  const nameIssue = named(value?.name, root)
  if (nameIssue) return nameIssue
  if (value.labels !== undefined && !validLabels(value.labels)) {
    return diag('INVALID_LABELS', 'metadata.labels', root, 'Metadata labels must be string key/value pairs.')
  }
  if (!namespaced && value.namespace !== undefined) return diag('KUBE_CLUSTER_SCOPED', value.name, root, 'Cluster-scoped resources cannot declare metadata.namespace.')
  if (namespaced && selectedNamespace !== undefined && value.namespace !== undefined && value.namespace !== selectedNamespace) return diag('KUBE_NAMESPACE_MISMATCH', value.namespace, root, 'Manifest namespace does not match the selected namespace.')
  return null
}

function configurationReference(value, root, kind) {
  const issue = allowed(value, new Set(['name', 'key', 'optional']), root)
  if (issue) return issue
  if (named(value?.name, root) || typeof value?.key !== 'string' || !value.key || value.key.includes('/')) return diag('INVALID_CONFIG_REFERENCE', value?.name, root, 'Configuration references require a name and key.')
  if (value.optional !== undefined && typeof value.optional !== 'boolean') return diag('INVALID_CONFIG_OPTIONAL', value.optional, root, 'Configuration optional must be a boolean.')
  return null
}

function validateContainer(container, root, configuration) {
  let issue = allowed(container, new Set(['name', 'image', 'imagePullPolicy', 'ports', 'env', ...(configuration ? ['volumeMounts'] : [])]), root)
  if (issue) return issue
  issue = named(container?.name, root, 'container name')
  if (issue) return issue
  if (typeof container.image !== 'string' || !container.image.includes(':')) return diag('INVALID_IMAGE', container?.image, root, 'A tagged container image is required.')
  if (container.imagePullPolicy !== 'Always') return diag('INVALID_IMAGE_PULL_POLICY', container?.imagePullPolicy, root, 'imagePullPolicy must be Always.')
  if (!Array.isArray(container.ports) || container.ports.length !== 1) return diag('INVALID_CONTAINER_PORTS', 'ports', root, 'Exactly one container port is required.')
  const port = container.ports[0]
  issue = allowed(port, new Set(['name', 'containerPort']), root)
  if (issue) return issue
  if (port.name !== undefined) {
    issue = named(port.name, root, 'port name')
    if (issue) return issue
  }
  if (!Number.isInteger(port.containerPort) || port.containerPort < 1 || port.containerPort > 65535) return diag('INVALID_CONTAINER_PORT', port?.containerPort, root)
  if (container.env !== undefined) {
    if (!Array.isArray(container.env)) return diag('INVALID_ENV', 'env', root)
    const names = new Set()
    for (const entry of container.env) {
      issue = allowed(entry, new Set(['name', 'value', ...(configuration ? ['valueFrom'] : [])]), root)
      if (issue) return issue
      if (typeof entry.name !== 'string' || !entry.name || names.has(entry.name)) return diag('INVALID_ENV_NAME', entry?.name, root, 'Environment names must be unique strings.')
      names.add(entry.name)
      if ((entry.value === undefined) === (entry.valueFrom === undefined)) return diag('INVALID_ENV_SOURCE', entry.name, root, 'Environment entries require exactly one literal value or valueFrom.')
      if (entry.value !== undefined && typeof entry.value !== 'string') return diag('INVALID_ENV_VALUE', entry?.value, root, 'Environment values must be strings.')
      if (entry.valueFrom !== undefined) {
        issue = allowed(entry.valueFrom, new Set(['configMapKeyRef', 'secretKeyRef']), root)
        if (issue || (entry.valueFrom.configMapKeyRef === undefined) === (entry.valueFrom.secretKeyRef === undefined)) return issue ?? diag('INVALID_ENV_SOURCE', entry.name, root, 'valueFrom requires exactly one supported key reference.')
        issue = configurationReference(entry.valueFrom.configMapKeyRef ?? entry.valueFrom.secretKeyRef, root)
        if (issue) return issue
      }
    }
  }
  if (container.volumeMounts !== undefined) {
    if (!Array.isArray(container.volumeMounts)) return diag('INVALID_VOLUME_MOUNTS', 'volumeMounts', root)
    const names = new Set(); const paths = new Set()
    for (const mount of container.volumeMounts) {
      issue = allowed(mount, new Set(['name', 'mountPath', 'readOnly']), root)
      if (issue || named(mount?.name, root) || typeof mount?.mountPath !== 'string' || !mount.mountPath.startsWith('/') || mount.mountPath.includes('..') || mount.readOnly !== true || names.has(mount.name) || paths.has(mount.mountPath)) return issue ?? diag('INVALID_VOLUME_MOUNT', mount?.name, root, 'Volume mounts require a unique name, absolute path, and readOnly: true.')
      names.add(mount.name); paths.add(mount.mountPath)
    }
  }
  return null
}

function validateDeployment(value, root, configuration) {
  let issue = allowed(value.spec, new Set(['replicas', 'selector', 'template']), root)
  if (issue) return issue
  if (!Number.isInteger(value.spec?.replicas) || value.spec.replicas < 1 || value.spec.replicas > 3) return diag('INVALID_REPLICAS', value.spec?.replicas, root)
  issue = allowed(value.spec.selector, new Set(['matchLabels']), root)
  if (issue || !validLabels(value.spec.selector?.matchLabels) || !Object.keys(value.spec.selector.matchLabels).length) return issue ?? diag('INVALID_LABELS', 'matchLabels', root)
  issue = allowed(value.spec.template, new Set(['metadata', 'spec']), root)
  if (issue) return issue
  issue = allowed(value.spec.template.metadata, new Set(['labels', 'annotations']), root)
  if (issue || !validLabels(value.spec.template.metadata?.labels)) return issue ?? diag('INVALID_LABELS', 'template labels', root)
  if (value.spec.template.metadata.annotations !== undefined && !validLabels(value.spec.template.metadata.annotations)) return diag('INVALID_ANNOTATIONS', 'template annotations', root)
  for (const [key, label] of Object.entries(value.spec.selector.matchLabels)) {
    if (typeof label !== 'string' || value.spec.template.metadata.labels[key] !== label) return diag('KUBE_SELECTOR_MISMATCH', key, root, 'Deployment selector labels must match Pod-template labels.')
  }
  issue = allowed(value.spec.template.spec, new Set(['containers', ...(configuration ? ['volumes'] : [])]), root)
  if (issue || !Array.isArray(value.spec.template.spec?.containers) || value.spec.template.spec.containers.length !== 1) return issue ?? diag('INVALID_CONTAINERS', 'containers', root, 'Exactly one container is required.')
  issue = validateContainer(value.spec.template.spec.containers[0], root, configuration)
  if (issue) return issue
  if (value.spec.template.spec.volumes !== undefined) {
    if (!Array.isArray(value.spec.template.spec.volumes)) return diag('INVALID_VOLUMES', 'volumes', root)
    const names = new Set(); const mountNames = new Set(value.spec.template.spec.containers[0].volumeMounts?.map(item => item.name) ?? [])
    for (const volume of value.spec.template.spec.volumes) {
      issue = allowed(volume, new Set(['name', 'configMap', 'secret']), root)
      if (issue || named(volume?.name, root) || names.has(volume.name) || !mountNames.has(volume.name) || (volume.configMap === undefined) === (volume.secret === undefined)) return issue ?? diag('INVALID_VOLUME', volume?.name, root, 'Volumes require a unique mounted ConfigMap or Secret.')
      names.add(volume.name)
      const source = volume.configMap ?? volume.secret
      issue = allowed(source, new Set(['name', 'items']), root)
      if (issue || named(source?.name, root)) return issue ?? diag('INVALID_VOLUME_SOURCE', source?.name, root)
      if (source.items !== undefined) {
        if (!Array.isArray(source.items)) return diag('INVALID_VOLUME_ITEMS', 'items', root)
        const paths = new Set()
        for (const item of source.items) {
          issue = allowed(item, new Set(['key', 'path']), root)
          if (issue || typeof item?.key !== 'string' || !item.key || typeof item?.path !== 'string' || !item.path || item.path.startsWith('/') || item.path.includes('..') || paths.has(item.path)) return issue ?? diag('INVALID_VOLUME_ITEM', item?.path, root, 'Volume items require safe unique key paths.')
          paths.add(item.path)
        }
      }
    }
    if ((value.spec.template.spec.containers[0].volumeMounts ?? []).some(mount => !names.has(mount.name))) return diag('INVALID_VOLUME', 'volumeMounts', root, 'Every volumeMount must name a declared volume.')
  }
  if (value.spec.template.spec.containers[0].volumeMounts?.length && value.spec.template.spec.volumes === undefined) return diag('INVALID_VOLUME', 'volumeMounts', root, 'Every volumeMount must name a declared volume.')
  return null
}

function validateConfigMap(value, root) {
  if (!object(value.data) || !Object.values(value.data).every(item => typeof item === 'string')) return diag('INVALID_CONFIGMAP_DATA', 'data', root, 'ConfigMap data must be a string map.')
  return null
}

function validBase64(value) { return typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) }
function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value)
  return btoa(String.fromCharCode(...bytes))
}
function validateSecret(value, root) {
  if (value.type !== undefined && value.type !== 'Opaque') return diag('INVALID_SECRET_TYPE', value.type, root, 'Only Opaque Secrets are supported.')
  if (value.data !== undefined && (!object(value.data) || !Object.values(value.data).every(validBase64))) return diag('INVALID_SECRET_DATA', 'data', root, 'Secret data must use valid base64 values.')
  if (value.stringData !== undefined && (!object(value.stringData) || !Object.values(value.stringData).every(item => typeof item === 'string'))) return diag('INVALID_SECRET_STRING_DATA', 'stringData', root, 'Secret stringData must be a string map.')
  return null
}

function validateService(value, root, capabilities) {
  let issue = allowed(value.spec, new Set(['type', 'selector', 'ports']), root)
  if (issue) return issue
  if (!['ClusterIP', 'LoadBalancer'].includes(value.spec?.type ?? 'ClusterIP')) return diag('INVALID_SERVICE_TYPE', value.spec?.type, root)
  if (!validLabels(value.spec.selector) || !Object.keys(value.spec.selector).length) return diag('INVALID_LABELS', 'selector', root)
  if (!Array.isArray(value.spec.ports) || value.spec.ports.length !== 1) return diag('INVALID_SERVICE_PORTS', 'ports', root, 'Exactly one Service port is required.')
  const port = value.spec.ports[0]
  issue = allowed(port, new Set(['port', 'targetPort', 'protocol']), root)
  if (issue) return issue
  if (!Number.isInteger(port.port) || port.port < 1 || port.port > 65535) return diag('INVALID_SERVICE_PORT', port.port, root)
  if (port.protocol !== 'TCP') return diag('INVALID_SERVICE_PROTOCOL', port.protocol, root)
  if (port.targetPort !== undefined && !(Number.isInteger(port.targetPort) && port.targetPort >= 1 && port.targetPort <= 65535) && typeof port.targetPort !== 'string') return diag('INVALID_TARGET_PORT', port.targetPort, root)
  return null
}

export function validateKubernetesObject(input, { namespace, capabilities = {}, sourceLocation } = {}) {
  const root = { sourceLocation }
  if (!object(input)) return { object: null, diagnostics: [diag('INVALID_OBJECT', 'A Kubernetes object is required.', root)] }
  const configuration = capabilities.kubernetesConfiguration === true
  let issue = allowed(input, new Set(['apiVersion', 'kind', 'metadata', 'spec', ...(configuration ? ['data', 'type', 'stringData'] : [])]), root)
  if (issue) return { object: null, diagnostics: [issue] }
  if (!allowedKinds.has(input.kind) || (['ConfigMap', 'Secret'].includes(input.kind) && !configuration)) return { object: null, diagnostics: [diag('KUBE_UNSUPPORTED_KIND', input.kind, root)] }
  if (!['ConfigMap', 'Secret'].includes(input.kind) && ['data', 'type', 'stringData'].some(key => input[key] !== undefined)) return { object: null, diagnostics: [diag('UNSUPPORTED_FIELD', 'data', root)] }
  const namespaced = input.kind !== 'Namespace'
  const resolvedNamespace = namespaced ? namespace ?? input.metadata?.namespace : undefined
  if (namespaced && !validDnsName(resolvedNamespace)) return { object: null, diagnostics: [diag('INVALID_NAMESPACE', resolvedNamespace, root)] }
  const expectedVersion = input.kind === 'Deployment' ? 'apps/v1' : 'v1'
  if (input.apiVersion !== expectedVersion) return { object: null, diagnostics: [diag('INVALID_API_VERSION', input.apiVersion, root)] }
  issue = metadata(input.metadata, root, namespaced, namespace)
  if (issue) return { object: null, diagnostics: [issue] }
  if (input.kind === 'Namespace') {
    if (input.spec !== undefined) return { object: null, diagnostics: [diag('UNSUPPORTED_FIELD', 'spec', root)] }
  } else if (input.kind === 'ConfigMap') { if (input.spec !== undefined || input.type !== undefined || input.stringData !== undefined) issue = diag('UNSUPPORTED_FIELD', 'spec', root); else issue = validateConfigMap(input, root) }
  else if (input.kind === 'Secret') { if (input.spec !== undefined) issue = diag('UNSUPPORTED_FIELD', 'spec', root); else issue = validateSecret(input, root) }
  else if (!object(input.spec)) return { object: null, diagnostics: [diag('INVALID_FIELD', 'spec', root)] }
  else if (input.kind === 'Deployment') issue = validateDeployment(input, root, configuration)
  else issue = validateService(input, root, capabilities)
  if (issue) return { object: null, diagnostics: [issue] }
  const output = clone(input)
  if (output.kind === 'Service') {
    output.spec.type ??= 'ClusterIP'
    output.spec.ports[0].targetPort ??= output.spec.ports[0].port
  }
  if (output.kind === 'Secret') { output.type ??= 'Opaque'; output.data = { ...(output.data ?? {}), ...(output.stringData ? Object.fromEntries(Object.entries(output.stringData).map(([key, value]) => [key, encodeBase64(value)])) : {}) }; delete output.stringData }
  if (namespaced && output.metadata.namespace === undefined) output.metadata.namespace = resolvedNamespace
  return { object: output, diagnostics: [] }
}

const allowedKinds = new Set(['Namespace', 'Deployment', 'Service'])
const namePattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

function diag(code, value, object, message = undefined) {
  const source = object?.__sourceLocation
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
  return typeof value === 'string' && namePattern.test(value)
    ? null : diag('INVALID_NAME', field, root, `${field} must be a lowercase Kubernetes name.`)
}

function metadata(value, root, namespaced, namespace) {
  const issue = allowed(value, new Set(['name', 'namespace', 'labels']), root)
  if (issue) return issue
  const nameIssue = named(value?.name, root)
  if (nameIssue) return nameIssue
  if (value.labels !== undefined && (!object(value.labels) || Object.entries(value.labels).some(([key, label]) => typeof key !== 'string' || typeof label !== 'string'))) {
    return diag('INVALID_LABELS', 'metadata.labels', root, 'Metadata labels must be string key/value pairs.')
  }
  if (!namespaced && value.namespace !== undefined) return diag('KUBE_CLUSTER_SCOPED', value.name, root, 'Cluster-scoped resources cannot declare metadata.namespace.')
  if (namespaced && value.namespace !== undefined && value.namespace !== namespace) return diag('KUBE_NAMESPACE_MISMATCH', value.namespace, root, 'Manifest namespace does not match the selected namespace.')
  return null
}

function validateContainer(container, root) {
  let issue = allowed(container, new Set(['name', 'image', 'imagePullPolicy', 'ports', 'env']), root)
  if (issue) return issue
  issue = named(container?.name, root, 'container name')
  if (issue) return issue
  if (typeof container.image !== 'string' || !container.image.includes(':')) return diag('INVALID_IMAGE', container?.image, root, 'A tagged container image is required.')
  if (container.imagePullPolicy !== 'Always') return diag('INVALID_IMAGE_PULL_POLICY', container?.imagePullPolicy, root, 'imagePullPolicy must be Always.')
  if (!Array.isArray(container.ports) || container.ports.length !== 1) return diag('INVALID_CONTAINER_PORTS', 'ports', root, 'Exactly one container port is required.')
  const port = container.ports[0]
  issue = allowed(port, new Set(['name', 'containerPort']), root)
  if (issue) return issue
  issue = named(port?.name, root, 'port name')
  if (issue) return issue
  if (!Number.isInteger(port.containerPort) || port.containerPort < 1 || port.containerPort > 65535) return diag('INVALID_CONTAINER_PORT', port?.containerPort, root)
  if (container.env !== undefined) {
    if (!Array.isArray(container.env)) return diag('INVALID_ENV', 'env', root)
    for (const entry of container.env) {
      issue = allowed(entry, new Set(['name', 'value']), root)
      if (issue) return issue
      if (typeof entry.name !== 'string' || !entry.name) return diag('INVALID_ENV_NAME', entry?.name, root)
      if (typeof entry.value !== 'string') return diag('INVALID_ENV_VALUE', entry?.value, root, 'Environment values must be strings.')
    }
  }
  return null
}

function validateDeployment(value, root) {
  let issue = allowed(value.spec, new Set(['replicas', 'selector', 'template']), root)
  if (issue) return issue
  if (!Number.isInteger(value.spec?.replicas) || value.spec.replicas < 1 || value.spec.replicas > 3) return diag('INVALID_REPLICAS', value.spec?.replicas, root)
  issue = allowed(value.spec.selector, new Set(['matchLabels']), root)
  if (issue || !object(value.spec.selector?.matchLabels) || !Object.keys(value.spec.selector.matchLabels).length) return issue ?? diag('INVALID_SELECTOR', 'matchLabels', root)
  issue = allowed(value.spec.template, new Set(['metadata', 'spec']), root)
  if (issue) return issue
  issue = allowed(value.spec.template.metadata, new Set(['labels']), root)
  if (issue || !object(value.spec.template.metadata?.labels)) return issue ?? diag('INVALID_LABELS', 'template labels', root)
  for (const [key, label] of Object.entries(value.spec.selector.matchLabels)) {
    if (typeof label !== 'string' || value.spec.template.metadata.labels[key] !== label) return diag('KUBE_SELECTOR_MISMATCH', key, root, 'Deployment selector labels must match Pod-template labels.')
  }
  issue = allowed(value.spec.template.spec, new Set(['containers']), root)
  if (issue || !Array.isArray(value.spec.template.spec?.containers) || value.spec.template.spec.containers.length !== 1) return issue ?? diag('INVALID_CONTAINERS', 'containers', root, 'Exactly one container is required.')
  return validateContainer(value.spec.template.spec.containers[0], root)
}

function matchingDeployment(deployments, service) {
  return deployments.find(deployment => deployment?.kind === 'Deployment'
    && deployment.metadata?.namespace === service.metadata?.namespace
    && Object.entries(service.spec.selector ?? {}).every(([key, value]) => deployment.spec?.template?.metadata?.labels?.[key] === value))
}

function validateService(value, root, capabilities) {
  let issue = allowed(value.spec, new Set(['type', 'selector', 'ports']), root)
  if (issue) return issue
  if (!['ClusterIP', 'LoadBalancer'].includes(value.spec?.type)) return diag('INVALID_SERVICE_TYPE', value.spec?.type, root)
  if (!object(value.spec.selector) || !Object.keys(value.spec.selector).length || Object.values(value.spec.selector).some(item => typeof item !== 'string')) return diag('INVALID_SELECTOR', 'selector', root)
  if (!Array.isArray(value.spec.ports) || value.spec.ports.length !== 1) return diag('INVALID_SERVICE_PORTS', 'ports', root, 'Exactly one Service port is required.')
  const port = value.spec.ports[0]
  issue = allowed(port, new Set(['port', 'targetPort', 'protocol']), root)
  if (issue) return issue
  if (!Number.isInteger(port.port) || port.port < 1 || port.port > 65535) return diag('INVALID_SERVICE_PORT', port.port, root)
  if (port.protocol !== 'TCP') return diag('INVALID_SERVICE_PROTOCOL', port.protocol, root)
  if (!(Number.isInteger(port.targetPort) && port.targetPort >= 1 && port.targetPort <= 65535) && typeof port.targetPort !== 'string') return diag('INVALID_TARGET_PORT', port.targetPort, root)
  if (typeof port.targetPort === 'string' && Array.isArray(capabilities?.deployments)) {
    const deployment = matchingDeployment(capabilities.deployments, value)
    const ports = deployment?.spec?.template?.spec?.containers?.[0]?.ports ?? []
    if (!ports.some(item => item.name === port.targetPort)) return diag('KUBE_TARGET_PORT_NOT_FOUND', port.targetPort, root, 'Service targetPort does not match a selected named container port.')
  }
  return null
}

export function validateKubernetesObject(input, { namespace, capabilities = {} } = {}) {
  const root = input
  if (!object(input)) return { object: null, diagnostics: [diag('INVALID_OBJECT', 'A Kubernetes object is required.', root)] }
  let issue = allowed(input, new Set(['apiVersion', 'kind', 'metadata', 'spec']), root)
  if (issue) return { object: null, diagnostics: [issue] }
  if (!allowedKinds.has(input.kind)) return { object: null, diagnostics: [diag('KUBE_UNSUPPORTED_KIND', input.kind, root)] }
  const namespaced = input.kind !== 'Namespace'
  const resolvedNamespace = namespaced ? namespace : undefined
  if (namespaced && (typeof resolvedNamespace !== 'string' || !namePattern.test(resolvedNamespace))) return { object: null, diagnostics: [diag('INVALID_NAMESPACE', resolvedNamespace, root)] }
  const expectedVersion = input.kind === 'Deployment' ? 'apps/v1' : 'v1'
  if (input.apiVersion !== expectedVersion) return { object: null, diagnostics: [diag('INVALID_API_VERSION', input.apiVersion, root)] }
  issue = metadata(input.metadata, root, namespaced, resolvedNamespace)
  if (issue) return { object: null, diagnostics: [issue] }
  if (input.kind === 'Namespace') {
    if (input.spec !== undefined) return { object: null, diagnostics: [diag('UNSUPPORTED_FIELD', 'spec', root)] }
  } else if (!object(input.spec)) return { object: null, diagnostics: [diag('INVALID_FIELD', 'spec', root)] }
  else if (input.kind === 'Deployment') issue = validateDeployment(input, root)
  else issue = validateService(input, root, capabilities)
  if (issue) return { object: null, diagnostics: [issue] }
  const output = clone(input)
  if (namespaced && output.metadata.namespace === undefined) output.metadata.namespace = resolvedNamespace
  return { object: output, diagnostics: [] }
}

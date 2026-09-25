import { parseKubernetesYaml } from './yaml.js'
import { applyKubernetesObjects, kubeObjectKey } from './objects.js'
import { reconcileKubernetesResult, restartDeploymentResult, getDeploymentPods, getPodTemplateHash } from './reconcile.js'
import { validateKubernetesObject } from './schema.js'
import { kubeJson, kubeYaml, kubeTable, describeObject } from './format.js'
import { runDiagnosticCommand } from './diagnostics.js'

const kinds = { pod: 'Pod', pods: 'Pod', deployment: 'Deployment', deployments: 'Deployment', deploy: 'Deployment', service: 'Service', services: 'Service', svc: 'Service', endpointslice: 'EndpointSlice', endpointslices: 'EndpointSlice', ep: 'EndpointSlice', eps: 'EndpointSlice', configmap: 'ConfigMap', configmaps: 'ConfigMap', cm: 'ConfigMap', secret: 'Secret', secrets: 'Secret', namespace: 'Namespace', namespaces: 'Namespace', ns: 'Namespace', replicaset: 'ReplicaSet', replicasets: 'ReplicaSet', rs: 'ReplicaSet', node: 'Node', nodes: 'Node', event: 'Event', events: 'Event', ev: 'Event' }
const namespaced = new Set(['Pod', 'Deployment', 'Service', 'EndpointSlice', 'ConfigMap', 'Secret', 'ReplicaSet', 'Event'])
const out = text => ({ text, kind: 'out' }), err = text => ({ text, kind: 'err' })
const response = (sandbox, lines, effects, diagnostics = []) => ({ sandbox, lines, events: [], latencyMs: 0, ...(effects ? { effects } : {}), ...(diagnostics.length ? { diagnostics } : {}) })

function flags(tokens, allowed) {
  const result = { positional: [], values: {} }
  const values = { '-n': 'namespace', '--namespace': 'namespace', '--context': 'context', '-o': 'output', '--output': 'output', '-f': 'file', '--dry-run': 'dryRun', '-l': 'label' }
  const booleans = { '-A': 'allNamespaces', '--all-namespaces': 'allNamespaces', '--current': 'current', '--show-labels': 'showLabels' }
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], key = values[token], inline
    if (!key && token.startsWith('--dry-run=')) { key = 'dryRun'; inline = token.slice(10) }
    if (!key && token.startsWith('--output=')) { key = 'output'; inline = token.slice(9) }
    if (key) {
      if (!allowed.has(key)) return { error: `flag '${token}' is not supported for this command.` }
      const value = inline ?? tokens[++i]
      if (!value) return { error: `argument ${token} requires a value.` }
      if (key === 'file') (result.values.file ??= []).push(value)
      else if (result.values[key] !== undefined) return { error: `duplicate ${token} flag.` }
      else result.values[key] = value
    } else if ((key = booleans[token])) {
      if (!allowed.has(key)) return { error: `flag '${token}' is not supported for this command.` }
      if (result.values[key]) return { error: `duplicate ${token} flag.` }
      result.values[key] = true
    } else if (token.startsWith('-')) return { error: `unknown flag '${token}'.` }
    else result.positional.push(token)
  }
  if (result.values.namespace && result.values.allNamespaces) return { error: '--namespace and --all-namespaces conflict.' }
  if (result.values.output && !['json', 'yaml', 'wide'].includes(result.values.output)) return { error: `unsupported output format '${result.values.output}'.` }
  return result
}

function target(run, options) {
  const name = options.context ?? run.runtime.kubernetes.currentContext
  if (!name) return { error: 'No current Kubernetes context is configured.' }
  const context = run.runtime.kubernetes.contexts[name], state = context && run.runtime.kubernetes.clusters[context.clusterId]
  if (!context) return { error: `Context '${name}' was not found.` }
  if (!state) return { error: 'The selected Kubernetes cluster is unavailable.' }
  return { clusterId: context.clusterId, state, namespace: options.namespace ?? context.namespace }
}
function resources(state, kind, namespace, allNamespaces) {
  if (kind === 'Node') return state.nodes ?? []
  if (kind === 'Event') return state.events.map((event, index) => ({ ...event, metadata: { ...event.metadata, name: event.metadata?.name ?? `event-${index + 1}` } }))
    .filter(event => allNamespaces || event.metadata.namespace === namespace)
  return Object.values(state.resources).filter(item => item.kind === kind && (!namespaced.has(kind) || allNamespaces || item.metadata.namespace === namespace))
}
function namespaceMissing(state, namespace) { return !state.resources[kubeObjectKey('Namespace', '', namespace)] }
function render(items, kind, format) {
  const value = items.length === 1 ? items[0] : { apiVersion: 'v1', kind: `${kind}List`, items }
  return format === 'json' ? kubeJson(value) : format === 'yaml' ? kubeYaml(value) : kubeTable(items, kind, format === 'wide')
}
function stateEffect(run) { return [{ type: 'kubernetes-state', kubernetes: run.runtime.kubernetes, nextSequence: run.nextSequence }] }
function manifests(run, files) {
  const parsed = []
  for (const file of files) {
    const paths = file === 'k8s/' ? Object.keys(run.project.savedFiles).filter(path => path.startsWith('k8s/') && /\.ya?ml$/i.test(path)).sort() : [file]
    if (!paths.length || paths.some(path => typeof run.project.savedFiles[path] !== 'string')) return { error: `Saved manifest '${file}' was not found.` }
    for (const path of paths) {
      const result = parseKubernetesYaml(run.project.savedFiles[path], path)
      if (result.diagnostics.length) return { error: result.diagnostics[0].message }
      parsed.push(result)
    }
  }
  return { documents: parsed.flatMap(item => item.documents), locations: parsed.flatMap(item => item.locations) }
}

function apply(run, selection, options, lab) {
  if (!options.file?.length) return response(run.sandbox, [err('apply requires -f SAVED_PATH.')])
  const source = manifests(run, options.file)
  if (source.error) return response(run.sandbox, [err(`Error: ${source.error}`)])
  if (options.dryRun) {
    if (options.dryRun !== 'client' || !['json', 'yaml'].includes(options.output)) return response(run.sandbox, [err('Only --dry-run=client with -o json or -o yaml is supported.')])
    for (let i = 0; i < source.documents.length; i++) {
      const checked = validateKubernetesObject(source.documents[i], { namespace: options.namespace, capabilities: { kubernetesConfiguration: lab?.capabilities?.kubernetesConfiguration === true }, sourceLocation: source.locations[i] })
      if (checked.diagnostics.length) return response(run.sandbox, [err(`Error: ${checked.diagnostics[0].message}`)])
    }
    const value = source.documents.length === 1 ? source.documents[0] : source.documents
    return response(run.sandbox, [out(options.output === 'json' ? kubeJson(value) : kubeYaml(value))])
  }
  const result = applyKubernetesObjects(run, source.documents, { clusterId: selection.clusterId, namespace: options.namespace, locations: source.locations }, lab)
  const reconciled = reconcileKubernetesResult(result.run, lab)
  if (reconciled.diagnostics.length) return response(run.sandbox, [...result.lines, err(`Error: ${reconciled.diagnostics[0].message}`)], undefined, reconciled.diagnostics)
  const next = reconciled.run
  const lines = result.diagnostics.length ? [...result.lines, err(`Error: ${result.diagnostics[0].message}`)] : result.lines
  return response(run.sandbox, lines, stateEffect(next))
}

export function runKubectl(sandbox, tokens, { run, lab } = {}) {
  if (lab?.capabilities?.kubernetes !== true || !run?.runtime?.kubernetes) return response(sandbox, [err('kubectl is available only in a Kubernetes Lab.')])
  const verb = tokens[0], rest = tokens.slice(1)
  if (verb === 'exec' && lab.capabilities.kubernetesConnectivity === true) {
    const result = runDiagnosticCommand(run, tokens, lab)
    const effects = result.run === run ? undefined : [{ type: 'kubernetes-state', kubernetes: result.run.runtime.kubernetes, nextSequence: result.run.nextSequence }]
    return response(sandbox, [...result.lines.map(out), ...result.diagnostics.map(item => err(`Error: ${item.message}`))], effects)
  }
  if (verb === 'config') {
    const command = rest[0], parsed = flags(rest.slice(1), command === 'set-context' ? new Set(['namespace', 'current']) : new Set())
    if (parsed.error) return response(sandbox, [err(parsed.error)])
    if (command === 'current-context') return parsed.positional.length ? response(sandbox, [err('current-context does not accept arguments.')]) : response(sandbox, [out(run.runtime.kubernetes.currentContext ?? '')])
    if (command === 'get-contexts') return parsed.positional.length ? response(sandbox, [err('get-contexts does not accept arguments.')]) : response(sandbox, [out(Object.entries(run.runtime.kubernetes.contexts).map(([name, item]) => `${name === run.runtime.kubernetes.currentContext ? '*' : ' '} ${name}\t${item.clusterId}\t${item.namespace}`).join('\n') || 'No contexts configured.')])
    if (command === 'use-context' && parsed.positional.length === 1) { const name = parsed.positional[0]; if (!run.runtime.kubernetes.contexts[name]) return response(sandbox, [err(`Context '${name}' was not found.`)]); return response(sandbox, [out(`Switched to context "${name}".`)], [{ type: 'kubernetes-state', kubernetes: { ...run.runtime.kubernetes, currentContext: name }, nextSequence: run.nextSequence }]) }
    if (command === 'set-context' && parsed.values.current && parsed.values.namespace && !parsed.positional.length) { const name = run.runtime.kubernetes.currentContext; if (!name) return response(sandbox, [err('No current Kubernetes context is configured.')]); const contexts = structuredClone(run.runtime.kubernetes.contexts); contexts[name].namespace = parsed.values.namespace; return response(sandbox, [out(`Context namespace set to ${parsed.values.namespace}.`)], [{ type: 'kubernetes-state', kubernetes: { ...run.runtime.kubernetes, contexts }, nextSequence: run.nextSequence }]) }
    return response(sandbox, [err('Unsupported kubectl config command.')])
  }
  const parsed = flags(rest, verb === 'apply' ? new Set(['namespace', 'context', 'file', 'dryRun', 'output']) : verb === 'delete' ? new Set(['namespace', 'context', 'file']) : verb === 'rollout' ? new Set(['namespace', 'context']) : new Set(['namespace', 'context', 'allNamespaces', 'output', 'label', 'showLabels']))
  if (parsed.error) return response(sandbox, [err(parsed.error)])
  const selection = target(run, parsed.values)
  if (selection.error) return response(sandbox, [err(`Error: ${selection.error}`)])
  if (verb === 'apply') return apply(run, selection, parsed.values, lab)
  if (verb === 'get') {
    const kind = kinds[parsed.positional[0]], name = parsed.positional[1]
    if (!kind || parsed.positional.length > 2) return response(sandbox, [err('Unsupported resource type.')])
    if (name && parsed.values.allNamespaces) return response(sandbox, [err('A named resource cannot use --all-namespaces.')])
    if (namespaced.has(kind) && !parsed.values.allNamespaces && namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    const derivedNodes = kind === 'Node' ? Array.from({ length: run.sandbox.aksClusters.find(cluster => cluster.id === selection.clusterId)?.nodeCount ?? 0 }, (_, index) => ({ apiVersion: 'v1', kind: 'Node', metadata: { name: `nodepool1-${index}`, uid: `node-${selection.clusterId}-${index}` }, status: { phase: 'Ready' } })) : null
    if (parsed.values.label && !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?=[A-Za-z0-9_.-]+$/.test(parsed.values.label)) return response(sandbox, [err('-l supports one equality selector in key=value form.')])
    if (parsed.values.showLabels && kind !== 'Pod') return response(sandbox, [err('--show-labels is supported only for Pods.')])
    const labelPair = parsed.values.label?.split('=')
    const found = (derivedNodes ?? resources(selection.state, kind, selection.namespace, parsed.values.allNamespaces)).filter(item => (!name || item.metadata.name === name)
      && (!labelPair || item.metadata.labels?.[labelPair[0]] === labelPair[1]))
    if (name && !found.length) return response(sandbox, [err(`${kind} '${name}' was not found.`)])
    if (parsed.values.showLabels) return response(sandbox, [out(['NAME\tREADY\tLABELS', ...found.map(item => `${item.metadata.name}\t${item.status?.conditions?.some(x => x.type === 'Ready' && x.status === 'True') ? '1/1' : '0/1'}\t${Object.entries(item.metadata.labels ?? {}).map(([key, value]) => `${key}=${value}`).join(',')}`)].join('\n'))])
    return response(sandbox, [out(render(found, kind, parsed.values.output))])
  }
  if (verb === 'describe') {
    const kind = kinds[parsed.positional[0]], name = parsed.positional[1]
    if (!['Deployment', 'Pod', 'Service', 'EndpointSlice', 'ConfigMap', 'Secret'].includes(kind) || !name || parsed.positional.length !== 2 || parsed.values.allNamespaces || parsed.values.output) return response(sandbox, [err('describe requires deployment, pod, service, endpointslice, configmap, or secret NAME.')])
    if (namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    const found = resources(selection.state, kind, selection.namespace).find(item => item.metadata.name === name)
    return found ? response(sandbox, [out(describeObject(found, selection.state))]) : response(sandbox, [err(`${kind} '${name}' was not found.`)])
  }
  if (verb === 'logs') {
    const name = parsed.positional[0]
    if (!name || parsed.positional.length !== 1 || parsed.values.allNamespaces || parsed.values.output) return response(sandbox, [err('logs requires POD.')])
    if (namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    const pod = resources(selection.state, 'Pod', selection.namespace).find(item => item.metadata.name === name)
    if (!pod) return response(sandbox, [err(`Pod '${name}' was not found.`)])
    const snapshot = selection.state.podSnapshots[pod.metadata.uid]
    if (!snapshot) return response(sandbox, [err(`Pod '${name}' has no running container logs.`)])
    const application = (selection.state.connectivity?.applicationLogs ?? []).filter(item => item.podUid === pod.metadata.uid)
      .map(item => `request=${item.requestId} ${item.method} ${item.path} status=${item.status} dependencies=${item.dependencySummary.map(hop => `${hop.operation}:${hop.status}${hop.reason ? `(${hop.reason})` : ''}`).join(',')}`)
    return response(sandbox, [out([`Simulated container log\nimage=${pod.spec.containers[0].image}`, ...application].join('\n'))])
  }
  if (verb === 'delete') {
    if (parsed.values.file) {
      if (parsed.positional.length || parsed.values.file.length !== 1) return response(sandbox, [err('delete -f requires exactly one SAVED_PATH.')])
      const source = manifests(run, parsed.values.file)
      if (source.error) return response(sandbox, [err(`Error: ${source.error}`)])
      const next = structuredClone(run), state = next.runtime.kubernetes.clusters[selection.clusterId]
      for (const object of source.documents) {
        const kind = object?.kind, namespace = object?.metadata?.namespace ?? selection.namespace
        if (!['Deployment', 'Service'].includes(kind) || !object?.metadata?.name) return response(sandbox, [err('delete -f supports saved Deployment and Service manifests only.')])
        const item = state.resources[kubeObjectKey(kind, namespace, object.metadata.name)]
        if (!item) continue
        const ids = new Set([item.metadata.uid]); let changed = true
        while (changed) { changed = false; for (const candidate of Object.values(state.resources)) if (candidate.metadata.ownerReferences?.some(ref => ids.has(ref.uid)) && !ids.has(candidate.metadata.uid)) { ids.add(candidate.metadata.uid); changed = true } }
        for (const candidate of Object.values(state.resources)) if (ids.has(candidate.metadata.uid)) { delete state.resources[kubeObjectKey(candidate.kind, candidate.metadata.namespace, candidate.metadata.name)]; delete state.podSnapshots[candidate.metadata.uid] }
      }
      const reconciled = reconcileKubernetesResult(next, lab)
      if (reconciled.diagnostics.length) return response(sandbox, [err(`Error: ${reconciled.diagnostics[0].message}`)], undefined, reconciled.diagnostics)
      return response(sandbox, [out(`deleted manifests from ${parsed.values.file[0]}`)], stateEffect(reconciled.run))
    }
    const kind = kinds[parsed.positional[0]], name = parsed.positional[1]
    if (!['Pod', 'Deployment', 'Service'].includes(kind) || !name || parsed.positional.length !== 2 || parsed.values.allNamespaces || parsed.values.output) return response(sandbox, [err('delete requires pod, deployment, or service NAME.')])
    if (namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    const next = structuredClone(run), state = next.runtime.kubernetes.clusters[selection.clusterId], item = state.resources[kubeObjectKey(kind, selection.namespace, name)]
    if (!item) return response(sandbox, [err(`${kind} '${name}' was not found.`)])
    if (kind === 'Pod') {
      const sequence = run.nextSequence
      const templateHash = getPodTemplateHash(state, item)
      state.receipts = [...state.receipts, { cause: 'pod-delete', sequence, deletedPodUid: item.metadata.uid,
        deletedPodName: item.metadata.name, deletedReplicaSetUid: item.metadata.ownerReferences?.[0]?.uid ?? null,
        templateHash, replacementPodUid: null, replacementPodName: null, replacementReplicaSetUid: null,
        replacementTemplateHash: null }].slice(-100)
      delete state.podSnapshots[item.metadata.uid]; delete state.resources[kubeObjectKey(kind, selection.namespace, name)]
    }
    else { const ids = new Set([item.metadata.uid]); let changed = true; while (changed) { changed = false; for (const candidate of Object.values(state.resources)) if (candidate.metadata.ownerReferences?.some(ref => ids.has(ref.uid)) && !ids.has(candidate.metadata.uid)) { ids.add(candidate.metadata.uid); changed = true } }; for (const candidate of Object.values(state.resources)) if (ids.has(candidate.metadata.uid)) { delete state.resources[kubeObjectKey(candidate.kind, candidate.metadata.namespace, candidate.metadata.name)]; delete state.podSnapshots[candidate.metadata.uid] } }
    const reconciled = reconcileKubernetesResult(next, lab)
    if (reconciled.diagnostics.length) return response(sandbox, [err(`Error: ${reconciled.diagnostics[0].message}`)], undefined, reconciled.diagnostics)
    return response(sandbox, [out(`${kind.toLowerCase()} "${name}" deleted`)], stateEffect(reconciled.run))
  }
  if (verb === 'rollout' && parsed.positional[0] === 'status' && /^deployment\//.test(parsed.positional[1] ?? '') && parsed.positional.length === 2) {
    const name = parsed.positional[1].slice(11), deployment = selection.state.resources[kubeObjectKey('Deployment', selection.namespace, name)]
    if (namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    if (!deployment) return response(sandbox, [err(`Deployment '${name}' was not found.`)])
    const pods = getDeploymentPods(run, selection.clusterId, selection.namespace, name)
    return response(sandbox, [out(pods.length === deployment.spec.replicas && pods.every(pod => pod.status.phase === 'Running') ? `deployment "${name}" successfully rolled out (simulated).` : `deployment "${name}" has pending Pods (simulated).`)])
  }
  if (verb === 'rollout' && parsed.positional[0] === 'restart' && /^deployment\//.test(parsed.positional[1] ?? '') && parsed.positional.length === 2) {
    const name = parsed.positional[1].slice(11)
    if (namespaceMissing(selection.state, selection.namespace)) return response(sandbox, [err(`Namespace '${selection.namespace}' was not found.`)])
    const deployment = selection.state.resources[kubeObjectKey('Deployment', selection.namespace, name)]
    if (!deployment) return response(sandbox, [err(`Deployment '${name}' was not found.`)])
    const reconciled = restartDeploymentResult(run, selection.clusterId, selection.namespace, name, lab)
    if (reconciled.diagnostics.length) return response(sandbox, [err(`Error: ${reconciled.diagnostics[0].message}`)], undefined, reconciled.diagnostics)
    return response(sandbox, [out(`deployment.apps/${name} restarted`)], stateEffect(reconciled.run))
  }
  return response(sandbox, [err('Unsupported kubectl command.')])
}

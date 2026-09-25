import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as aks from '../../sandbox/aks.js'
import { AzError } from '../../sandbox/errors.js'

const nodeCount = { name: '--node-count', aliases: [], required: false, kind: 'integer', dest: 'nodeCount', help: 'Number of modeled nodes (1-3).' }
const nodeVmSize = { name: '--node-vm-size', aliases: [], required: false, kind: 'string', dest: 'nodeVmSize', help: 'Only Standard_D2s_v5 is modeled.' }
const managed = { name: '--enable-managed-identity', aliases: [], required: false, kind: 'flag', dest: 'enableManagedIdentity', help: 'Use managed identity.' }
const ssh = { name: '--generate-ssh-keys', aliases: [], required: false, kind: 'flag', dest: 'generateSshKeys', help: 'Simulated; no local files are written.' }
const attach = { name: '--attach-acr', aliases: [], required: false, kind: 'string', dest: 'attachAcr', help: 'Grant AcrPull to the kubelet identity.' }
const detach = { name: '--detach-acr', aliases: [], required: false, kind: 'string', dest: 'detachAcr', help: 'Remove the kubelet AcrPull grant.' }
const overwrite = { name: '--overwrite-existing', aliases: [], required: false, kind: 'flag', dest: 'overwriteExisting', help: 'Replace the context when it belongs to this cluster.' }
const present = resource => ({ id: resource.id, name: resource.name, location: resource.location, resourceGroup: resource.resourceGroup, type: 'Microsoft.ContainerService/managedClusters', identity: resource.identity, properties: { provisioningState: resource.provisioningState, nodeResourceGroup: resource.nodeResourceGroup, agentPoolProfiles: [{ name: 'nodepool1', count: resource.nodeCount, vmSize: resource.nodeVmSize }], identityProfile: resource.identityProfile } })
const enabled = context => { if (context?.lab?.capabilities?.kubernetes !== true) throw new AzError('UnsupportedOperation', 'AKS commands are available only in a Kubernetes Lab.', { kind: 'cli' }) }
const changed = (type, resource) => [event(type, 'aksCluster', { name: resource.name, resourceGroup: resource.resourceGroup })]

export const aksGroup = defineGroup(['aks'], 'Manage simulated Azure Kubernetes Service clusters.', {
  create: defineCommand(['aks', 'create'], 'Create a managed AKS cluster. Non-ABAC ACR integration grants AcrPull to the kubelet identity.', {
    latencyMs: LATENCY.mutate, args: [ARG.resourceGroup, ARG.name('AKS cluster name.'), ARG.location(false), nodeCount, nodeVmSize, managed, ssh, attach],
    run: ({ sandbox, context }, values) => { enabled(context); const result = aks.createAksCluster(sandbox, values); return { sandbox: result.sandbox, output: present(result.resource), events: changed(result.existed ? 'updated' : 'created', result.resource) } },
  }),
  show: defineCommand(['aks', 'show'], 'Show a managed AKS cluster.', {
    args: [ARG.resourceGroup, ARG.name('AKS cluster name.')], run: ({ sandbox, context }, values) => { enabled(context); return { sandbox, output: present(aks.getAksCluster(sandbox, values.resourceGroup, values.name)) } },
  }),
  list: defineCommand(['aks', 'list'], 'List managed AKS clusters.', {
    args: [ARG.resourceGroupOptional], run: ({ sandbox, context }, values) => { enabled(context); return { sandbox, output: aks.listAksClusters(sandbox, values.resourceGroup ?? null).map(present) } },
  }),
  update: defineCommand(['aks', 'update'], 'Attach or detach a registry from the kubelet identity.', {
    latencyMs: LATENCY.mutate, args: [ARG.resourceGroup, ARG.name('AKS cluster name.'), attach, detach],
    run: ({ sandbox, context }, values) => { enabled(context); if (!!values.attachAcr === !!values.detachAcr) throw new AzError('InvalidArgumentValue', 'Specify exactly one of --attach-acr or --detach-acr.', { kind: 'cli' }); const result = aks.updateAksRegistry(sandbox, { resourceGroup: values.resourceGroup, name: values.name, registry: values.attachAcr ?? values.detachAcr, attach: values.attachAcr !== undefined }); const cluster = aks.getAksCluster(result.sandbox, values.resourceGroup, values.name); return { sandbox: result.sandbox, output: present(cluster), events: changed('updated', cluster) } },
  }),
  'get-credentials': defineCommand(['aks', 'get-credentials'], 'Record a simulated kubeconfig context; no kubeconfig is written.', {
    latencyMs: LATENCY.read, args: [ARG.resourceGroup, ARG.name('AKS cluster name.'), overwrite],
    run: ({ sandbox, context }, values) => { enabled(context); const cluster = aks.getAksCluster(sandbox, values.resourceGroup, values.name); return { sandbox, output: { name: cluster.name, context: cluster.name }, effects: [{ type: 'aks-context', name: cluster.name, clusterId: cluster.id, overwrite: values.overwriteExisting === true }] } },
  }),
  delete: defineCommand(['aks', 'delete'], 'Delete a managed AKS cluster.', {
    latencyMs: LATENCY.mutate, args: [ARG.resourceGroup, ARG.name('AKS cluster name.'), ARG.yes],
    run: ({ sandbox, context }, values) => { enabled(context); if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' }); const result = aks.deleteAksCluster(sandbox, values); return { sandbox: result.sandbox, output: null, events: changed('deleted', result.resource) } },
  }),
})

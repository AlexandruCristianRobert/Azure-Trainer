import { createResourceGroup } from '../../../lib/sandbox/ops.js'
import { createRegistry } from '../../../lib/sandbox/registry.js'
import { createAksCluster } from '../../../lib/sandbox/aks.js'
import { emptyClusterState } from '../../../lib/kubernetes/state.js'
import { PG_CLUSTER_ID } from './postgres-helpers.js'

// Supplied infrastructure only. Every data resource and workload is created
// through learner commands, so ownership starts at the actual creation.
export function seedDataCapstone(run) {
  let sandbox = createResourceGroup(run.sandbox, { name: 'rg-assistant', location: 'eastus' }).sandbox
  sandbox = createRegistry(sandbox, { resourceGroup: 'rg-assistant', name: 'acrassistant', sku: 'Basic' }).sandbox
  sandbox = createAksCluster(sandbox, { resourceGroup: 'rg-assistant', name: 'aks-assistant', nodeCount: 2,
    enableManagedIdentity: true, generateSshKeys: true, attachAcr: 'acrassistant' }).sandbox
  const cluster = emptyClusterState(PG_CLUSTER_ID)
  cluster.resources['Namespace//assistant'] = { apiVersion: 'v1', kind: 'Namespace',
    metadata: { name: 'assistant', uid: 'supplied-assistant-namespace', resourceVersion: '1' } }
  cluster.resources['Service/assistant/assistant-api'] = { apiVersion: 'v1', kind: 'Service',
    metadata: { name: 'assistant-api', namespace: 'assistant', uid: 'supplied-assistant-service', resourceVersion: '1' },
    spec: { type: 'ClusterIP', selector: { app: 'assistant-api' }, ports: [{ port: 80, targetPort: 'http' }] } }
  return { sandbox, artifacts: run.artifacts, nextSequence: run.nextSequence,
    runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, clusters: { [PG_CLUSTER_ID]: cluster } } } }
}

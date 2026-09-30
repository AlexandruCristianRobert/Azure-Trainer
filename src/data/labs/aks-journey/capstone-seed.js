import { createSandbox, SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { createResourceGroup } from '../../../lib/sandbox/ops.js'
import { emptyKubernetesRuntime } from '../../../lib/kubernetes/state.js'
import { INTEGRATION_FIXTURES } from '../../fixtures/aks/integration.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { sourceTextHash } from '../../../lib/labEngine/sourceJournal.js'

export const AKS_PREREQUISITE_GROUP = 'rg-aks-prerequisites'
export const AKS_PREREQUISITE_GROUP_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${AKS_PREREQUISITE_GROUP}`
export function aksPrerequisiteCatalog() {
  return { version: 1, catalogId: 'aks-integration-fixtures-v1', digest: sourceTextHash(canonicalize(INTEGRATION_FIXTURES)),
    profiles: Object.entries(INTEGRATION_FIXTURES.profiles).map(([id, profile]) => ({ id, digest: sourceTextHash(canonicalize(profile)) })) }
}

export function createAksCapstoneSeed() {
  const sandbox = createResourceGroup(createSandbox(), { name: AKS_PREREQUISITE_GROUP, location: 'eastus' }).sandbox
  sandbox.resourceGroups[0].createdAt = '2026-01-01T00:00:00.000Z'
  return { sandbox,
    artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
    runtime: { simTimeMs: 0, deploymentsByApp: {}, replicasByApp: {}, activeScenario: null, scheduledEvents: [],
      kubernetes: emptyKubernetesRuntime(), aksCapstonePrerequisites: aksPrerequisiteCatalog() }, nextSequence: 1 }
}

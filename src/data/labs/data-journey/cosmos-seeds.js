// Data journey Lab seeds (Task 8+). Mirrors aks-journey/integration-seeds.js's
// seedIntegrationGuided: replays only the AKS prerequisites a guided Lab
// needs before the learner's own Tasks begin, via the same applyRunAction
// path a learner's commands take (no shortcuts into the Sandbox for AKS
// resources). Unlike that AKS seed, this one does not create any Cosmos
// resource (account/database/container are Lab 1 Tasks) and does not apply
// the assistant-api Deployment (the learner builds and deploys it after
// completing Lab 1's code Task) - see task-8-brief.md.
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { ASSISTANT_CLUSTER, ASSISTANT_GROUP, ASSISTANT_NAMESPACE, ASSISTANT_REGISTRY } from './cosmos-helpers.js'

export function seedCosmosSdkGuided(run) {
  const lab = {
    id: run.labId, engineVersion: 2, contentVersion: run.contentVersion, manifestId: run.project.manifestId,
    tasks: [], capabilities: { acrBuild: true, kubernetes: true, dataCosmos: true },
  }
  let seeded = run
  const act = (action) => {
    const result = applyRunAction(seeded, action, lab)
    if (result.diagnostics.length || result.lines.some((line) => line.kind === 'err')) {
      throw new Error(`Cosmos SDK guided seed failed for ${JSON.stringify(action)}: ${JSON.stringify({ diagnostics: result.diagnostics, lines: result.lines })}`)
    }
    seeded = result.run
  }
  for (const line of [
    `az group create -n ${ASSISTANT_GROUP} -l eastus`,
    `az acr create -g ${ASSISTANT_GROUP} -n ${ASSISTANT_REGISTRY} --sku Basic`,
    `az aks create -g ${ASSISTANT_GROUP} -n ${ASSISTANT_CLUSTER} --enable-managed-identity --generate-ssh-keys --attach-acr ${ASSISTANT_REGISTRY}`,
    `az aks get-credentials -g ${ASSISTANT_GROUP} -n ${ASSISTANT_CLUSTER}`,
  ]) act({ type: 'command', line })

  // COSMOS_FILES has no k8s/namespace.yaml (ADR-0003's template is shared
  // across every Data journey Lab and never applies one), so the namespace
  // is injected directly, exactly as aks-journey/integration-seeds.js does
  // for its own fixture-only `diagnostics` Namespace.
  const clusterId = seeded.sandbox.aksClusters[0].id
  const state = seeded.runtime.kubernetes.clusters[clusterId]
  state.resources[`Namespace//${ASSISTANT_NAMESPACE}`] = {
    apiVersion: 'v1', kind: 'Namespace',
    metadata: { name: ASSISTANT_NAMESPACE, uid: `fixture-${clusterId}-${ASSISTANT_NAMESPACE}-namespace`, resourceVersion: '1' },
  }
  act({ type: 'command', line: 'kubectl apply -f k8s/service.yaml' })

  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

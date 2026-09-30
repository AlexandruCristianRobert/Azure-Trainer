import { validateBicepProviders } from './providers.js'
import { desiredBicepProjection, currentBicepProjection } from './projection.js'

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const roleTriple = (role, desired) => same(role.scope, desired.scope) && same(role.principalId, desired.principalId)
  && same(role.roleDefinitionId, desired.roleDefinitionId.split('/').at(-1))

/** Read-only incremental what-if. The operation projections are reused by apply. */
export function previewBicepDeployment(graph, sandbox, artifacts = {}, lab = {}, run = null) {
  const checked = validateBicepProviders(graph, sandbox, artifacts, lab, run)
  if (checked.diagnostics.length) return { operations: [], diagnostics: checked.diagnostics }
  const operations = []
  for (const { node, lineage } of checked.resources) {
    const desired = desiredBicepProjection(node)
    const current = currentBicepProjection(node, sandbox)
    if (node.type === 'Microsoft.Authorization/roleAssignments') {
      const byName = sandbox.roleAssignments?.find(item => same(item.id, node.name))
      const byTriple = sandbox.roleAssignments?.find(item => roleTriple(item, desired))
      if (byName && !roleTriple(byName, desired) || byTriple && !same(byTriple.id, node.name))
        return { operations: [], diagnostics: [{ code: 'BICEP_ROLE_CONFLICT', message: 'Role assignment GUID and scope/principal/role triple conflict with an existing assignment.', ...node.source }] }
    }
    const changeType = node.existing ? 'ignored-existing' : !current ? 'create' : JSON.stringify(desired) === JSON.stringify(current) ? 'no-change' : 'modify'
    operations.push({ id: node.armId, nodeId: node.id, type: node.type, name: node.name, changeType, desired, current, lineage, source: node.source })
  }
  return { operations, diagnostics: [] }
}

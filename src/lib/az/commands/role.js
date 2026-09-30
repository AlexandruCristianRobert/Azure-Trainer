import { defineGroup, defineCommand, LATENCY, event } from '../tree.js'
import * as keyvault from '../../sandbox/keyvault.js'
import { presentRoleAssignment } from '../keyvault-arm.js'
import { AzError } from '../../sandbox/errors.js'
import * as registryRoles from '../../sandbox/roleAssignments.js'

const SCOPE = { name: '--scope', aliases: [], required: true, kind: 'string', dest: 'scope', help: 'Exact Key Vault, container registry, or Foundry account ARM resource ID.' }
const ROLE = { name: '--role', aliases: [], required: false, kind: 'string', dest: 'role', help: 'Supported role at the exact resource scope.' }
const ASSIGNEE = { name: '--assignee', aliases: [], required: false, kind: 'string', dest: 'assignee', help: 'Sandbox learner UPN or object ID.' }
const ASSIGNEE_ID = { name: '--assignee-object-id', aliases: [], required: false, kind: 'string', dest: 'assigneeObjectId', help: 'Sandbox learner or managed identity principal object ID.' }
const PRINCIPAL_TYPE = { name: '--assignee-principal-type', aliases: [], required: false, kind: 'string', choices: ['User', 'ServicePrincipal'], dest: 'assigneePrincipalType', help: 'User for Key Vault; ServicePrincipal for ACR and Foundry.' }
const roleEvent = (type, assignment, vault) => event(type, 'keyVaultRoleAssignment', { name: assignment.roleName, resourceGroup: vault.resourceGroup, vault: vault.name })
const registryRoleEvent = (type, assignment, registry) => event(type, 'registryRoleAssignment', { name: assignment.roleName, resourceGroup: registry.resourceGroup, registry: registry.name })
const foundryRoleEvent = (type, assignment, account) => event(type, 'foundryRoleAssignment', { name: assignment.roleName, resourceGroup: account.resourceGroup, account: account.name })
function rejectFoundryChildScope(scope) {
  if (/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.cognitiveservices\/accounts\/[^/]+\//i.test(scope)) {
    throw new AzError('InvalidArgumentValue', 'Foundry role assignments require an exact account scope in the Sandbox.', { kind: 'cli' })
  }
}
const requiredRole = (values) => {
  if (values.role === undefined) throw new AzError('InvalidArgumentValue', 'argument --role is required.', { kind: 'cli' })
  return values.role
}

export const roleGroup = defineGroup(['role'], 'Manage role assignments.', {
  assignment: defineGroup(['role', 'assignment'], 'Manage role assignments.', {
    create: defineCommand(['role', 'assignment', 'create'], 'Create a role assignment.', {
      latencyMs: LATENCY.mutate, args: [SCOPE, ROLE, ASSIGNEE, ASSIGNEE_ID, PRINCIPAL_TYPE],
      run: ({ sandbox }, values) => {
        rejectFoundryChildScope(values.scope)
        if (registryRoles.isRegistryScope(values.scope)) {
          const principal = registryRoles.resolveRegistryPrincipal(sandbox, values)
          const { sandbox: next, resource, registry, existed } = registryRoles.createRegistryRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
          return { sandbox: next, output: presentRoleAssignment(resource), events: [registryRoleEvent(existed ? 'updated' : 'created', resource, registry)] }
        }
        if (registryRoles.isFoundryAccountScope(values.scope)) {
          const principal = registryRoles.resolveFoundryPrincipal(sandbox, values)
          const { sandbox: next, resource, account, existed } = registryRoles.createFoundryRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
          return { sandbox: next, output: presentRoleAssignment(resource), events: [foundryRoleEvent(existed ? 'updated' : 'created', resource, account)] }
        }
        const principal = keyvault.resolveRolePrincipal(values)
        const { sandbox: next, resource, vault, existed } = keyvault.createRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
        return { sandbox: next, output: presentRoleAssignment(resource), events: [roleEvent(existed ? 'updated' : 'created', resource, vault)] }
      },
    }),
    list: defineCommand(['role', 'assignment', 'list'], 'List role assignments at a scope.', {
      args: [SCOPE, ROLE, ASSIGNEE, ASSIGNEE_ID],
      run: ({ sandbox }, values) => {
        rejectFoundryChildScope(values.scope)
        if (registryRoles.isRegistryScope(values.scope)) {
          const principalId = values.assignee !== undefined || values.assigneeObjectId !== undefined ? registryRoles.resolveRegistryPrincipal(sandbox, values).principalId : undefined
          return { sandbox, output: registryRoles.listRegistryRoleAssignments(sandbox, { scope: values.scope, role: values.role, principalId }).map(presentRoleAssignment) }
        }
        if (registryRoles.isFoundryAccountScope(values.scope)) {
          const principalId = values.assignee !== undefined || values.assigneeObjectId !== undefined ? registryRoles.resolveFoundryPrincipal(sandbox, values).principalId : undefined
          return { sandbox, output: registryRoles.listFoundryRoleAssignments(sandbox, { scope: values.scope, role: values.role, principalId }).map(presentRoleAssignment) }
        }
        const principalId = values.assignee !== undefined || values.assigneeObjectId !== undefined ? keyvault.resolveRolePrincipal(values).principalId : undefined
        return { sandbox, output: keyvault.listRoleAssignments(sandbox, { scope: values.scope, role: values.role, principalId }).map(presentRoleAssignment) }
      },
    }),
    delete: defineCommand(['role', 'assignment', 'delete'], 'Delete a role assignment.', {
      latencyMs: LATENCY.mutate, args: [SCOPE, ROLE, ASSIGNEE, ASSIGNEE_ID],
      run: ({ sandbox }, values) => {
        rejectFoundryChildScope(values.scope)
        if (registryRoles.isRegistryScope(values.scope)) {
          const principal = registryRoles.resolveRegistryPrincipal(sandbox, values)
          const { sandbox: next, resource, registry } = registryRoles.deleteRegistryRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
          return { sandbox: next, output: null, events: [registryRoleEvent('deleted', resource, registry)] }
        }
        if (registryRoles.isFoundryAccountScope(values.scope)) {
          const principal = registryRoles.resolveFoundryPrincipal(sandbox, values)
          const { sandbox: next, resource, account } = registryRoles.deleteFoundryRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
          return { sandbox: next, output: null, events: [foundryRoleEvent('deleted', resource, account)] }
        }
        const principal = keyvault.resolveRolePrincipal(values)
        const { sandbox: next, resource, vault } = keyvault.deleteRoleAssignment(sandbox, { scope: values.scope, role: requiredRole(values), ...principal })
        return { sandbox: next, output: null, events: [roleEvent('deleted', resource, vault)] }
      },
    }),
  }),
})

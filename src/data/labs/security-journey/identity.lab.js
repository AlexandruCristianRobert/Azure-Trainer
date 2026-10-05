import { SECRET_SOLUTION_SOURCE } from '../../templates/security-python/security.js'
import { securityLab, securityTask, securityPaths, securityReady, securityVault, file, command, consumed, SECURITY_IDENTITY, SECURITY_VAULT_ID } from './helpers.js'
import { SECRETS_USER_ROLE_ID, SECRETS_OFFICER_ROLE_ID } from '../../../lib/sandbox/keyvault.js'
import { resolveRuntimePrincipal } from '../../../lib/security/identity.js'
import { SECURITY_APP_ID } from './seeds.js'

function leastPrivilegeVaultRead(context) {
  if (!securityReady(context)) return false
  const principal = resolveRuntimePrincipal(context.sandbox, { appId: SECURITY_APP_ID })
  const roles = securityVault(context.sandbox).roleAssignments.filter(role => role.principalType === 'ServicePrincipal'
    && role.principalId.toLowerCase() === principal.principalId.toLowerCase()
    && role.scope.toLowerCase() === SECURITY_VAULT_ID.toLowerCase())
  return roles.some(role => role.roleDefinitionId === SECRETS_USER_ROLE_ID)
    && !roles.some(role => role.roleDefinitionId === SECRETS_OFFICER_ROLE_ID)
}

const attach = securityTask({ id: 'attach-runtime-identity', stage: 'identity',
  text: 'Attach the supplied id-orders user-assigned managed identity to func-orders. Select the application identity, independently of your learner provisioning session.',
  rationale: { concept: 'Application managed identity', what: 'Attaches an existing identity to the running application.', why: 'The order notification worker needs its own runtime principal.', without: 'DefaultAzureCredential cannot resolve an unattached application identity.', csharp: 'DefaultAzureCredential uses the same managed identity idea in C#; the host attachment is separate from SDK construction.' },
  check: ({ sandbox }) => sandbox.functionApps.some(app => app.name === 'func-orders' && app.resourceGroup === 'rg-messaging' && app.userAssignedIdentityIds?.includes(SECURITY_IDENTITY.id)),
  solution: { steps: [command(`az functionapp identity assign -g rg-messaging -n func-orders --identities ${SECURITY_IDENTITY.id}`)] },
})
const grant = securityTask({ id: 'grant-vault-read', stage: 'identity',
  check: leastPrivilegeVaultRead,
  text: 'Grant Key Vault Secrets User to the actual id-orders principal at the exact kv-orders vault scope. Save the supplied compact read-and-notify consumer and run python worker.py to verify runtime authorization.',
  rationale: { concept: 'Least-privilege runtime authorization', what: 'Grants vault read authority to the attached application principal and consumes its retrieved key.', why: 'Learner Secrets Officer authority does not authorize the notification worker.', without: 'An attached identity without the exact vault role cannot read; a lookup without consumption cannot demonstrate authorized notification.', csharp: 'SecretClient.GetSecret with DefaultAzureCredential follows the same principal and RBAC scope rules as Python get_secret.' },
  paths: securityPaths, solution: { steps: [command(`az role assignment create --scope ${SECURITY_VAULT_ID} --role "Key Vault Secrets User" --assignee-object-id ${SECURITY_IDENTITY.principalId} --assignee-principal-type ServicePrincipal`), file('worker.py', SECRET_SOLUTION_SOURCE), command('python worker.py')] },
})
export const securityIdentityLab = securityLab({ stage: 'identity', order: 1, title: 'Simulated: Give the order worker its own identity',
  brief: 'Supplied rg-messaging, stmessagingorders, Python func-orders, id-orders, RBAC kv-orders and a demo v1 notification key. The learner can manage secrets. The new application attachment and vault reader grant are absent. No upstream execution or proof is supplied.', tasks: [attach, grant], behavior: consumed })

import { SUBSCRIPTION_ID, USER_OBJECT_ID } from '../../lib/sandbox/model.js'

const GROUP = 'rg-secrets'
const VAULT = 'kv-contoso-secrets'
const SECRET = 'contoso-api-key'
const INITIAL_VALUE = 'demo-contoso-key-v1'
const ROTATED_VALUE = 'demo-contoso-key-v2'
const OFFICER_ROLE = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
const SCOPE = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${GROUP}/providers/Microsoft.KeyVault/vaults/${VAULT}`
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function vault(sandbox) {
  if (!sandbox.resourceGroups.some((group) => same(group.name, GROUP))) return undefined
  return (sandbox.keyVaults ?? []).find((item) => same(item.name, VAULT) && same(item.resourceGroup, GROUP))
}
function versions(sandbox) {
  return vault(sandbox)?.secrets.find((secret) => same(secret.name, SECRET))?.versions ?? []
}
function isInitial(version) {
  return version.value === INITIAL_VALUE && version.contentType === 'text/plain'
}

export const keyvaultSecretsLab = {
  id: 'keyvault-secrets',
  title: 'Store and rotate secrets in Key Vault',
  skillAreaId: 'secure',
  service: 'key-vault',
  minutes: 30,
  status: 'available',
  brief: "Contoso is moving an API credential into Azure Key Vault. Create a protected vault, grant the Sandbox learner permission to manage secrets, then store and manually rotate the provided demo credential. Keep the original version so you can inspect the version history.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-secrets` in West Europe.',
      check: (sandbox) => sandbox.resourceGroups.some((group) => same(group.name, GROUP) && group.location === 'westeurope'),
      hints: [
        'Use `az group create` for the resource group that will contain the vault.',
        'Set `--name rg-secrets --location westeurope`. The later vault command can use this group by name.',
      ],
      solution: 'az group create --name rg-secrets --location westeurope',
      examNote: 'The vault is an Azure resource in a resource group. Its secret values are accessed through a separate data-plane endpoint.',
    },
    {
      id: 'key-vault',
      text: 'Create a Standard Key Vault named `kv-contoso-secrets` in `rg-secrets`, in West Europe. Enable Azure RBAC authorization and purge protection.',
      check: (sandbox) => {
        const item = vault(sandbox)
        return !!item && item.location === 'westeurope' && item.sku === 'standard'
          && item.enableRbacAuthorization === true && item.enablePurgeProtection === true
      },
      hints: [
        'Use `az keyvault create`. Azure RBAC controls secret access separately from permission to manage the vault resource.',
        'Use `--sku standard --enable-rbac-authorization true --enable-purge-protection true`, with the required vault name, group and location.',
      ],
      solution: 'az keyvault create --name kv-contoso-secrets --resource-group rg-secrets --location westeurope --sku standard --enable-rbac-authorization true --enable-purge-protection true',
      examNote: 'Soft delete retains deleted vaults and secrets for recovery. Purge protection prevents permanent deletion during retention and cannot be turned off after it is enabled.',
    },
    {
      id: 'secret-access',
      text: `Grant the Sandbox learner (object ID \`${USER_OBJECT_ID}\`) the \`Key Vault Secrets Officer\` role at the \`kv-contoso-secrets\` vault scope.`,
      check: (sandbox) => {
        const item = vault(sandbox)
        return !!item && item.enableRbacAuthorization === true && item.roleAssignments.some((assignment) =>
          same(assignment.principalId, USER_OBJECT_ID) && assignment.principalType === 'User'
          && same(assignment.roleDefinitionId, OFFICER_ROLE) && same(assignment.scope, SCOPE))
      },
      hints: [
        'Use `az role assignment create` with the Key Vault Secrets Officer role. A vault management role alone does not allow reading or setting secret values.',
        `Set \`--assignee-object-id ${USER_OBJECT_ID} --assignee-principal-type User\`, use \`--role "Key Vault Secrets Officer"\`, and set \`--scope\` to the vault's full ARM resource ID from \`az keyvault show\`.`,
      ],
      solution: `az role assignment create --assignee-object-id ${USER_OBJECT_ID} --assignee-principal-type User --role "Key Vault Secrets Officer" --scope ${SCOPE}`,
      examNote: 'Key Vault Secrets Officer manages secrets but does not grant roles. The Sandbox learner already has role-assignment management permission; new secret access takes effect immediately here, while Azure propagation can take time.',
    },
    {
      id: 'initial-secret',
      text: 'Store secret `contoso-api-key` in `kv-contoso-secrets` with demo value `demo-contoso-key-v1` and content type `text/plain`.',
      check: (sandbox) => versions(sandbox).some(isInitial),
      hints: [
        'Use `az keyvault secret set` with `--vault-name`, `--name` and `--value`. Setting a secret requires data-plane access to this vault.',
        "Use `--name contoso-api-key --value 'demo-contoso-key-v1' --content-type text/plain`. If access is forbidden, check the role assignment and its vault scope.",
      ],
      solution: "az keyvault secret set --vault-name kv-contoso-secrets --name contoso-api-key --value 'demo-contoso-key-v1' --content-type text/plain",
      examNote: 'Secret names identify a collection of versions. A successful set operation creates a version; secret list and list-versions return metadata without secret values.',
    },
    {
      id: 'rotate-secret',
      text: 'Rotate `contoso-api-key` to demo value `demo-contoso-key-v2` with content type `text/plain`. Keep the original value in an older version and leave the latest version enabled.',
      check: (sandbox) => {
        const stored = versions(sandbox)
        const latest = stored[stored.length - 1]
        return stored.length > 1 && stored.slice(0, -1).some(isInitial)
          && latest.value === ROTATED_VALUE && latest.contentType === 'text/plain' && latest.enabled === true
      },
      hints: [
        'Set the same secret name again with the replacement value. This creates a new version. Use `az keyvault secret list-versions` to inspect the retained history.',
        "Repeat `az keyvault secret set --vault-name kv-contoso-secrets --name contoso-api-key` with `--value 'demo-contoso-key-v2' --content-type text/plain`. New versions are enabled by default; changing attributes alone does not rotate the value.",
      ],
      solution: "az keyvault secret set --vault-name kv-contoso-secrets --name contoso-api-key --value 'demo-contoso-key-v2' --content-type text/plain",
      examNote: 'A versionless secret lookup selects the latest version; it does not fall back if that version is disabled. Production rotation also coordinates the replacement credential with its issuing service and consuming applications.',
    },
  ],
}

# Fourth Lab: Store and rotate secrets in Key Vault

Continue the existing catalog with `keyvault-secrets` (secure, key-vault, 30 minutes).
Use CONTEXT.md terminology and the existing Cloud Shell, read-only Blades and Lab lifecycle.
The user authorized continuing with Superpowers and Sol/Terra agents. Preserve earlier work.

## Learning flow

1. Create `rg-secrets` in West Europe.
2. Create Standard vault `kv-contoso-secrets` in that group/region with Azure RBAC and purge protection enabled.
3. Grant the Sandbox learner `Key Vault Secrets Officer` at that vault's ARM scope.
4. Store secret `contoso-api-key` with demo value `demo-contoso-key-v1` and content type `text/plain`.
5. Rotate it to `demo-contoso-key-v2`, retaining the first value in an older version. The latest
   version must be enabled with content type `text/plain`.

Every Task has two Hints, a complete single-command Solution and an Exam Note. Task 4 remains
complete after rotation because the original version remains stored; Task 5 requires a later
version, not just multiple sets of the same value or the new value created first. Checks use
current resource/version state and full ancestry, never command history. Task 3 requires the
specified principal, role and vault scope. Missing new collections in legacy saves are safe.

## Stable data and interfaces

Add `USER_OBJECT_ID = 'a37a00c7-d689-4b5d-a8c8-1d75f307d5ef'` to sandbox/model.js alongside the
existing USER_NAME, TENANT_ID and SUBSCRIPTION_ID. This represents only the synthetic learner.

```js
keyVaults: [{
  name, resourceGroup, location, sku: 'standard',
  enableRbacAuthorization: true, enablePurgeProtection: false,
  softDeleteRetentionInDays: 90, tags: null, createdAt,
  roleAssignments: [{ id, principalId, principalType: 'User', roleName, roleDefinitionId, scope }],
  secrets: [{ name, versions: [{
    version, value, enabled: true, contentType: null, tags: null, createdAt, updatedAt,
  }] }],
}]
```

Assignment `id` is a UUID; `roleDefinitionId` is a role GUID; `scope` is the canonical full
vault ARM ID. A version is a unique 32-character hex identifier. Version arrays are oldest
first; the last entry is latest, even when disabled. Persist timestamps as ISO strings.
Names are case insensitive for vault/resource-group/secret identity; preserve canonical names.
Never silently merge two versions. Every successful `secret set`, even with the same value,
creates a new version. Repeating vault/assignment creation preserves children and avoids
duplicate assignments. Vault location cannot move; purge protection cannot be switched off.
Vault names are globally unique within the Sandbox, including across resource groups.
Retention is fixed at creation: repeated create preserves it when omitted and rejects changes.

Missing `keyVaults` in old saves normalizes to []; malformed present collections/entries and
nested assignment/secret/version shapes reject the saved run before Home or Blade rendering.
Group deletion removes its simulated vaults and nested data. Full soft-delete lifecycle is
outside this Lab; vault/secret delete, recover and purge commands are not implemented.

### Command scope

- `az keyvault create/show/list/update`: vault name/group, location on create (default group
  location), Standard/Premium SKU and tags on create, RBAC (true only), purge protection,
  retention days 7-90 on create. Update supports the two direct RBAC/purge flags only; no
  invented update SKU/tags flags or generic `--set` emulation. Show/update can resolve a unique
  vault name without group. Defaults: standard, RBAC true, purge false, retention 90.
  List supports optional group and `--resource-type vault`. No access policies.
- `az role assignment create/list/delete`: vault-level scope only. Support `Key Vault Secrets
  Officer` and `Key Vault Secrets User` names or role GUIDs. Resolve only the known Sandbox
  learner by `--assignee` UPN/object-id or `--assignee-object-id` and create's optional
  `--assignee-principal-type User`. Create/delete require a role, principal and scope; list
  requires scope with optional role/principal filters. No invented delete `--yes` flag.
  Control-plane role management is already permitted for the synthetic learner.
- `az keyvault secret set`: vault name, secret name, required `--value`, optional
  `--content-type`, tags, `--disabled true|false` (default false). No `--file` or encoding.
- `az keyvault secret show`: name/vault with optional version, or a Key Vault secret `--id`.
- `az keyvault secret list`: current secret metadata without values or version history.
- `az keyvault secret list-versions`: metadata for each stored version, without values.
- `az keyvault secret set-attributes`: name/vault/optional version or `--id`; `--enabled`,
  content type and tags. This edits one version and does not rotate/create another version.

All groups/commands support help and existing argument parsing/latency/error conventions.
Reject unsupported flags, external vault IDs, invalid names/versions, ambiguous ID+name
selectors and malformed values without mutations/events. Vault names are 3-24 characters,
start with a letter, end alphanumeric, use letters/digits/hyphens with no consecutive hyphens;
secret names are 1-127 letters/digits/hyphens. Scope matching is case insensitive and exact.

Secret data access requires an assignment at the target vault: Officer can set/read/list/
update metadata; Secrets User can read/list only. Missing permissions return Forbidden;
management-plane access alone never grants secret access. Disabled latest values cannot be
read and never fall back to an older enabled version. Metadata lists still show disabled
versions. Role assignment propagation is immediate here; real Azure can take time.

Vault output follows ARM `Microsoft.KeyVault/vaults` with `properties` including tenantId,
vaultUri, SKU, RBAC, soft-delete true, retention and purge protection. Secret output follows
data-plane bundles with versioned HTTPS id, attributes (enabled/created/updated, epoch seconds),
contentType/tags and value only for set/show. Lists and set-attributes output omit values.
Assignment output uses full scope/provider assignment and role-definition IDs plus principal.
Never include secret values in notification events or Blade metadata tables.

### Portal contract

Events:
```js
{type, resourceType:'keyVault', name, resourceGroup}
{type, resourceType:'keyVaultRoleAssignment', name:roleName, resourceGroup, vault}
{type, resourceType:'keyVaultSecret', name, resourceGroup, vault, version}
```
Created/updated vault or role events focus `{kind:'key-vault',resourceGroup,name}`. Secret
events focus `{kind:'key-vault-secret',resourceGroup,vault,name}` (history of all versions).
Deleted role events keep current Blade. Missing secrets fall back to vault; missing vault
falls back to resource group; group deletion handles all descendants.

Vault Overview shows Essentials (region/SKU/access model/protections), role assignments and
secret metadata rows. Secret Overview shows parent breadcrumbs, content type, version count,
latest status and a newest-first version table with version/status/created/content type.
Display no secret values or value-reveal controls. If the learner lacks list/read permission,
show an access message and keep secret rows hidden, including direct secret Blade navigation.
Reuse existing components/styles and official key-vault icon; only Overview becomes active.

## Verification scope

Current session instructions prohibit adding/running tests unless requested. Update the
existing catalog expectation for the fourth available Lab, but add no new test cases or files
and run no test suites or browser test scripts. Use static review, production build and visual
inspection; report this limit accurately. No dependencies, real Azure calls, commits/worktrees
or git metadata edits. Existing uncommitted Labs must remain intact.

## Primary sources (checked 2026-09-21)

- [Vault CLI](https://learn.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest)
- [Secrets CLI](https://learn.microsoft.com/en-us/cli/azure/keyvault/secret?view=azure-cli-latest)
- [Role assignment CLI](https://learn.microsoft.com/en-us/cli/azure/role/assignment?view=azure-cli-latest)
- [Key Vault RBAC roles](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [Object identifiers and versions](https://learn.microsoft.com/en-us/azure/key-vault/general/about-keys-secrets-certificates)
- [ARM naming rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#Microsoft.KeyVault)
- [Set Secret REST](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/set-secret/set-secret?view=rest-keyvault-secrets-2025-07-01)
- [Disabled secret behavior](https://learn.microsoft.com/en-us/azure/key-vault/secrets/javascript-developer-guide-enable-disable-secret)
- [Soft-delete retention](https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview)

Secrets Officer role ID: `b86a8fe4-44ce-4948-aee5-eccb2c155cd7`; Secrets User role ID:
`4633458b-17de-408a-b874-0445c86b69e6`. Disabled latest behavior follows Get Secret's latest
selection plus disabled-value rejection; the inference is no older-version fallback.

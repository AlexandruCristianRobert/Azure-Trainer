import { defineGroup, defineCommand, LATENCY, event } from '../tree.js'
import * as keyvault from '../../sandbox/keyvault.js'
import { presentSecret } from '../keyvault-arm.js'

const VAULT = { name: '--vault-name', aliases: [], required: true, kind: 'string', dest: 'vaultName', help: 'Name of the Key Vault.' }
const VAULT_OPTIONAL = { ...VAULT, required: false }
const NAME = { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name of the secret.' }
const NAME_OPTIONAL = { ...NAME, required: false }
const VALUE = { name: '--value', aliases: [], required: true, kind: 'string', dest: 'value', help: 'Secret value.' }
const VERSION = { name: '--version', aliases: [], required: false, kind: 'string', dest: 'version', help: 'A 32-character secret version.' }
const ID = { name: '--id', aliases: [], required: false, kind: 'string', dest: 'id', help: 'A Key Vault secret ID.' }
const CONTENT_TYPE = { name: '--content-type', aliases: [], required: false, kind: 'string', dest: 'contentType', help: 'Secret content type.' }
const DISABLED = { name: '--disabled', aliases: [], required: false, kind: 'bool', dest: 'disabled', help: 'Create the secret version disabled.' }
const ENABLED = { name: '--enabled', aliases: [], required: false, kind: 'bool', dest: 'enabled', help: 'Enable or disable the selected secret version.' }
const TAGS = { name: '--tags', aliases: [], required: false, kind: 'list', dest: 'tags', help: 'Space-separated tags: key[=value] [key[=value] ...].' }
const secretEvent = (type, vault, secret, version) => event(type, 'keyVaultSecret', { name: secret.name, resourceGroup: vault.resourceGroup, vault: vault.name, version: version.version })

export const secretGroup = defineGroup(['keyvault', 'secret'], 'Manage Key Vault secrets.', {
  set: defineCommand(['keyvault', 'secret', 'set'], 'Create a new version of a Key Vault secret.', {
    latencyMs: LATENCY.mutate, args: [VAULT, NAME, VALUE, CONTENT_TYPE, DISABLED, TAGS],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, secret, vault } = keyvault.setSecret(sandbox, values)
      return { sandbox: next, output: presentSecret(resource, secret, vault, { includeValue: true }), events: [secretEvent('created', vault, secret, resource)] }
    },
  }),
  show: defineCommand(['keyvault', 'secret', 'show'], 'Show a Key Vault secret value.', {
    args: [VAULT_OPTIONAL, NAME_OPTIONAL, VERSION, ID],
    run: ({ sandbox }, values) => {
      const { vault, secret, version } = keyvault.showSecret(sandbox, values)
      return { sandbox, output: presentSecret(version, secret, vault, { includeValue: true }) }
    },
  }),
  list: defineCommand(['keyvault', 'secret', 'list'], 'List current Key Vault secret metadata.', {
    args: [VAULT],
    run: ({ sandbox }, values) => {
      const { vault, secrets } = keyvault.listSecrets(sandbox, values)
      return { sandbox, output: secrets.map((secret) => presentSecret(secret.versions.at(-1), secret, vault)) }
    },
  }),
  'list-versions': defineCommand(['keyvault', 'secret', 'list-versions'], 'List Key Vault secret version metadata.', {
    args: [VAULT, NAME],
    run: ({ sandbox }, values) => {
      const { vault, secret } = keyvault.listSecretVersions(sandbox, values)
      return { sandbox, output: secret.versions.map((version) => presentSecret(version, secret, vault)) }
    },
  }),
  'set-attributes': defineCommand(['keyvault', 'secret', 'set-attributes'], 'Update Key Vault secret version attributes.', {
    latencyMs: LATENCY.mutate, args: [VAULT_OPTIONAL, NAME_OPTIONAL, VERSION, ID, ENABLED, CONTENT_TYPE, TAGS],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, secret, vault } = keyvault.updateSecretAttributes(sandbox, values)
      return { sandbox: next, output: presentSecret(resource, secret, vault), events: [secretEvent('updated', vault, secret, resource)] }
    },
  }),
})

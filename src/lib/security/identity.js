import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { AzError } from '../sandbox/errors.js'

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const denied = () => new AzError('CredentialUnavailable', 'Select an actual managed identity attached to the application.')

/** Runtime authority is selected from live attachment, never the learner session. */
export function resolveRuntimePrincipal(sandbox, { appId } = {}, credentialOptions = {}) {
  if (!credentialOptions || typeof credentialOptions !== 'object' || Array.isArray(credentialOptions)
    || Object.keys(credentialOptions).some(key => key !== 'managed_identity_client_id')) throw denied()
  const app = (sandbox.functionApps ?? []).find(item => same(appId,
    `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${item.resourceGroup}/providers/Microsoft.Web/sites/${item.name}`))
  if (!app) throw denied()
  const identities = (app.userAssignedIdentityIds ?? []).map(id => (sandbox.managedIdentities ?? []).find(identity => same(identity.id, id)))
  if (!identities.length || identities.some(identity => !identity)) throw denied()
  const clientId = credentialOptions.managed_identity_client_id
  const identity = clientId === undefined ? identities.length === 1 ? identities[0] : null
    : identities.find(item => same(item.clientId, clientId))
  if (!identity) throw denied()
  return { appId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Web/sites/${app.name}`,
    identityId: identity.id, clientId: identity.clientId, principalId: identity.principalId, principalType: 'ServicePrincipal' }
}

export function validateRuntimePrincipal(sandbox, principal) {
  if (!principal || typeof principal !== 'object' || Object.keys(principal).sort().join(',') !== 'appId,clientId,identityId,principalId,principalType') throw denied()
  const actual = resolveRuntimePrincipal(sandbox, { appId: principal.appId }, { managed_identity_client_id: principal.clientId })
  if (Object.keys(actual).some(key => actual[key] !== principal[key])) throw denied()
  return actual
}

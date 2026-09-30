import { BICEP_GUIDED_MANIFEST, BICEP_GUIDED_SOLUTION_FILES } from './bicep-guided-solution.js'

export const BICEP_TROUBLESHOOTING_MANIFEST = Object.freeze({ ...BICEP_GUIDED_MANIFEST,
  id: 'containerapps-dotnet-bicep-troubleshooting-v1' })

const replacements = [
  ['acrbicepguided', 'acrbicepincident'],
  ['foundrybicepguided', 'foundrybicepincident'],
  ['api-bicep', 'api-bicep-incident'],
  ['id-bicep', 'id-bicep-incident'],
  ['env-bicep', 'env-bicep-incident'],
]
const renamed = Object.fromEntries(Object.entries(BICEP_GUIDED_SOLUTION_FILES).map(([path, content]) =>
  [path, replacements.reduce((text, [from, to]) => text.replaceAll(from, to), content)]))

const main = renamed['infra/main.bicep']
  .replace('param identityName string', 'param identityName string\nparam decoyIdentityName string')
  .replace('params: { identityName: identityName }', 'params: { identityName: identityName, decoyIdentityName: decoyIdentityName }')
const identity = renamed['infra/modules/identity.bicep']
  .replace('param identityName string', 'param identityName string\nparam decoyIdentityName string')
  .replace('output id string = identity.id', `resource decoy 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: decoyIdentityName
  location: resourceGroup().location
}
output decoyPrincipalId string = decoy.properties.principalId
output id string = identity.id`)
const parameters = renamed['infra/first.bicepparam']
  .replace("param identityName = 'id-bicep-incident'", "param identityName = 'id-bicep-incident'\nparam decoyIdentityName = 'id-bicep-decoy'")

export const BICEP_TROUBLESHOOTING_SOLUTION_FILES = Object.freeze({ ...renamed,
  'infra/main.bicep': main,
  'infra/modules/identity.bicep': identity,
  'infra/first.bicepparam': parameters,
})

export const BICEP_TROUBLESHOOTING_WRONG_PARAMETER = parameters
  .replace("param environmentName = 'env-bicep-incident'", "param environmentName = 'env-bicep-test'")
export const BICEP_TROUBLESHOOTING_DECOY_MAIN = main
  .replace('principalId: identity.outputs.principalId', 'principalId: identity.outputs.decoyPrincipalId')
export const BICEP_TROUBLESHOOTING_STARTER_FILES = Object.freeze({ ...BICEP_TROUBLESHOOTING_SOLUTION_FILES,
  'infra/main.bicep': BICEP_TROUBLESHOOTING_DECOY_MAIN.replace('environment.outputs.id', 'environment.outputs.environmntId'),
  'infra/first.bicepparam': BICEP_TROUBLESHOOTING_WRONG_PARAMETER,
})

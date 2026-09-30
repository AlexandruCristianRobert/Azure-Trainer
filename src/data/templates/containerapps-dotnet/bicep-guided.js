import { FOUNDRY_MANIFEST, FOUNDRY_SOLUTION_FILES } from './foundry.js'

const modules = [
  'infra/modules/identity.bicep',
  'infra/modules/environment.bicep',
  'infra/modules/foundry.bicep',
  'infra/modules/roles.bicep',
  'infra/modules/app.bicep',
]
const bicepFiles = ['infra/main.bicep', ...modules, 'infra/first.bicepparam']

export const BICEP_MANIFEST = Object.freeze({ ...FOUNDRY_MANIFEST,
  id: 'containerapps-dotnet-bicep-guided-v1',
  files: Object.freeze([...FOUNDRY_MANIFEST.files, ...bicepFiles]),
  bicepFiles: Object.freeze(bicepFiles),
  maxFiles: 32,
})

// The starter is intentionally an authoring surface. The later Lab fixture supplies
// completed provider declarations and guided gaps without changing these file paths.
export const BICEP_STARTER_FILES = Object.freeze({ ...FOUNDRY_SOLUTION_FILES,
  'infra/main.bicep': `targetScope = 'resourceGroup'\n`,
  'infra/modules/identity.bicep': `param location string\n`,
  'infra/modules/environment.bicep': `param location string\n`,
  'infra/modules/foundry.bicep': `param location string\n`,
  'infra/modules/roles.bicep': `param location string\n`,
  'infra/modules/app.bicep': `param location string\n`,
  'infra/first.bicepparam': `using './main.bicep'\n`,
})

import { PROJECT_MANIFEST } from '../../data/templates/containerapps-dotnet/starter.js'
import { PROBE_MANIFEST } from '../../data/templates/containerapps-dotnet/probes.js'
import { INDEPENDENT_PROBE_MANIFEST } from '../../data/templates/containerapps-dotnet/probes-independent.js'
import { FOUNDRY_MANIFEST } from '../../data/templates/containerapps-dotnet/foundry.js'
import { TROUBLESHOOTING_FOUNDRY_MANIFEST } from '../../data/templates/containerapps-dotnet/foundry-troubleshooting.js'
import { INDEPENDENT_FOUNDRY_MANIFEST } from '../../data/templates/containerapps-dotnet/foundry-independent.js'
import { BICEP_MANIFEST } from '../../data/templates/containerapps-dotnet/bicep-guided.js'
import { BICEP_TROUBLESHOOTING_MANIFEST } from '../../data/templates/containerapps-dotnet/bicep-troubleshooting.js'
import { BICEP_INDEPENDENT_MANIFEST } from '../../data/templates/containerapps-dotnet/bicep-independent.js'
import { CAPSTONE_MANIFEST } from '../../data/templates/containerapps-dotnet/capstone.js'
import { FOUNDATION_MANIFEST } from '../../data/templates/aks-python/foundation.js'

const manifests = Object.freeze({ [PROJECT_MANIFEST.id]: PROJECT_MANIFEST, [PROBE_MANIFEST.id]: PROBE_MANIFEST,
  [INDEPENDENT_PROBE_MANIFEST.id]: INDEPENDENT_PROBE_MANIFEST, [FOUNDRY_MANIFEST.id]: FOUNDRY_MANIFEST,
  [TROUBLESHOOTING_FOUNDRY_MANIFEST.id]: TROUBLESHOOTING_FOUNDRY_MANIFEST,
  [INDEPENDENT_FOUNDRY_MANIFEST.id]: INDEPENDENT_FOUNDRY_MANIFEST, [BICEP_MANIFEST.id]: BICEP_MANIFEST,
  [BICEP_TROUBLESHOOTING_MANIFEST.id]: BICEP_TROUBLESHOOTING_MANIFEST,
  [BICEP_INDEPENDENT_MANIFEST.id]: BICEP_INDEPENDENT_MANIFEST,
  [CAPSTONE_MANIFEST.id]: CAPSTONE_MANIFEST, [FOUNDATION_MANIFEST.id]: FOUNDATION_MANIFEST })

export function getProjectManifest(manifestId) { return manifests[manifestId] ?? PROJECT_MANIFEST }

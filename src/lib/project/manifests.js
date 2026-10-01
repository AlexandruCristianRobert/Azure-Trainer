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
import { FOUNDATION_MANIFEST, INDEPENDENT_FOUNDATION_MANIFEST } from '../../data/templates/aks-python/foundation.js'
import { CONFIG_MANIFEST } from '../../data/templates/aks-python/configuration.js'
import { CONFIG_INDEPENDENT_MANIFEST } from '../../data/templates/aks-python/configuration-independent.js'
import { CONNECTIVITY_MANIFEST } from '../../data/templates/aks-python/connectivity.js'
import { CONNECTIVITY_INDEPENDENT_MANIFEST } from '../../data/templates/aks-python/connectivity.js'
import { INTEGRATION_MANIFEST } from '../../data/templates/aks-python/integration.js'
import { HEALTH_MANIFEST } from '../../data/templates/aks-python/health.js'
import { RESOURCE_MANIFEST } from '../../data/templates/aks-python/resources.js'
import { RELEASE_MANIFEST } from '../../data/templates/aks-python/releases.js'
import { DIAGNOSIS_MANIFEST } from '../../data/templates/aks-python/diagnosis.js'
import { CAPSTONE_MANIFEST as AKS_CAPSTONE_MANIFEST } from '../../data/templates/aks-python/capstone.js'
import { COSMOS_MANIFEST } from '../../data/templates/data-python/cosmos.js'
import { POSTGRES_MANIFEST } from '../../data/templates/data-python/postgres.js'
import { REDIS_MANIFEST } from '../../data/templates/data-python/redis.js'
import { POSTGRES_INDEPENDENT_MANIFEST } from '../../data/templates/data-python/postgres-independent.js'

const manifests = Object.freeze({ [PROJECT_MANIFEST.id]: PROJECT_MANIFEST, [PROBE_MANIFEST.id]: PROBE_MANIFEST,
  [INDEPENDENT_PROBE_MANIFEST.id]: INDEPENDENT_PROBE_MANIFEST, [FOUNDRY_MANIFEST.id]: FOUNDRY_MANIFEST,
  [TROUBLESHOOTING_FOUNDRY_MANIFEST.id]: TROUBLESHOOTING_FOUNDRY_MANIFEST,
  [INDEPENDENT_FOUNDRY_MANIFEST.id]: INDEPENDENT_FOUNDRY_MANIFEST, [BICEP_MANIFEST.id]: BICEP_MANIFEST,
  [BICEP_TROUBLESHOOTING_MANIFEST.id]: BICEP_TROUBLESHOOTING_MANIFEST,
  [BICEP_INDEPENDENT_MANIFEST.id]: BICEP_INDEPENDENT_MANIFEST,
  [CAPSTONE_MANIFEST.id]: CAPSTONE_MANIFEST, [FOUNDATION_MANIFEST.id]: FOUNDATION_MANIFEST, [CONFIG_MANIFEST.id]: CONFIG_MANIFEST,
  [INDEPENDENT_FOUNDATION_MANIFEST.id]: INDEPENDENT_FOUNDATION_MANIFEST,
  [CONFIG_INDEPENDENT_MANIFEST.id]: CONFIG_INDEPENDENT_MANIFEST, [CONNECTIVITY_MANIFEST.id]: CONNECTIVITY_MANIFEST,
  [CONNECTIVITY_INDEPENDENT_MANIFEST.id]: CONNECTIVITY_INDEPENDENT_MANIFEST, [INTEGRATION_MANIFEST.id]: INTEGRATION_MANIFEST,
  [HEALTH_MANIFEST.id]: HEALTH_MANIFEST, [RESOURCE_MANIFEST.id]: RESOURCE_MANIFEST, [RELEASE_MANIFEST.id]: RELEASE_MANIFEST,
  [DIAGNOSIS_MANIFEST.id]: DIAGNOSIS_MANIFEST, [AKS_CAPSTONE_MANIFEST.id]: AKS_CAPSTONE_MANIFEST,
  [COSMOS_MANIFEST.id]: COSMOS_MANIFEST, [POSTGRES_MANIFEST.id]: POSTGRES_MANIFEST, [REDIS_MANIFEST.id]: REDIS_MANIFEST,
  [POSTGRES_INDEPENDENT_MANIFEST.id]: POSTGRES_INDEPENDENT_MANIFEST })

export function getProjectManifest(manifestId) { return manifests[manifestId] ?? PROJECT_MANIFEST }

import { servicebusOrderBackendLab } from './servicebus-order-backend.lab.js'
import { containerappsKedaLab } from './containerapps-keda.lab.js'
import { cosmosVectorSearchLab } from './cosmos-vector-search.lab.js'
import { keyvaultSecretsLab } from './keyvault-secrets.lab.js'
import { functionsServerlessApiLab } from './functions-serverless-api.lab.js'
import { eventgridFilteredSubscriptionLab } from './eventgrid-filtered-subscription.lab.js'
import { deployGuidedLab } from './containerapps-journey/deploy-guided.lab.js'
import { deployTroubleshootingLab } from './containerapps-journey/deploy-troubleshooting.lab.js'
import { deployIndependentLab } from './containerapps-journey/deploy-independent.lab.js'
import { cpuGuidedLab } from './containerapps-journey/cpu-guided.lab.js'
import { cpuTroubleshootingLab } from './containerapps-journey/cpu-troubleshooting.lab.js'
import { cpuIndependentLab } from './containerapps-journey/cpu-independent.lab.js'
import { probesGuidedLab } from './containerapps-journey/probes-guided.lab.js'
import { probesTroubleshootingLab } from './containerapps-journey/probes-troubleshooting.lab.js'
import { probesIndependentLab } from './containerapps-journey/probes-independent.lab.js'
import { foundryGuidedLab } from './containerapps-journey/foundry-guided.lab.js'
import { foundryTroubleshootingLab } from './containerapps-journey/foundry-troubleshooting.lab.js'
import { foundryIndependentLab } from './containerapps-journey/foundry-independent.lab.js'
import { bicepGuidedLab } from './containerapps-journey/bicep-guided.lab.js'
import { bicepTroubleshootingLab } from './containerapps-journey/bicep-troubleshooting.lab.js'
import { bicepIndependentLab } from './containerapps-journey/bicep-independent.lab.js'
import { capstoneLab } from './containerapps-journey/capstone.lab.js'
import { aksDeployGuidedLab } from './aks-journey/deploy-guided.lab.js'
import { aksDeployTroubleshootingLab } from './aks-journey/deploy-troubleshooting.lab.js'
import { aksDeployIndependentLab } from './aks-journey/deploy-independent.lab.js'
import { aksConfigGuidedLab } from './aks-journey/config-guided.lab.js'
import { aksConfigTroubleshootingLab } from './aks-journey/config-troubleshooting.lab.js'
import { aksConfigIndependentLab } from './aks-journey/config-independent.lab.js'
import { aksConnectivityGuidedLab } from './aks-journey/connectivity-guided.lab.js'
import { aksConnectivityTroubleshootingLab } from './aks-journey/connectivity-troubleshooting.lab.js'
import { aksConnectivityIndependentLab } from './aks-journey/connectivity-independent.lab.js'
import { aksAiGuidedLab } from './aks-journey/ai-guided.lab.js'
import { aksAiTroubleshootingLab } from './aks-journey/ai-troubleshooting.lab.js'
import { aksAiIndependentLab } from './aks-journey/ai-independent.lab.js'
import { aksProbesGuidedLab } from './aks-journey/probes-guided.lab.js'
import { aksProbesTroubleshootingLab } from './aks-journey/probes-troubleshooting.lab.js'
import { aksProbesIndependentLab } from './aks-journey/probes-independent.lab.js'
import { aksResourcesGuidedLab } from './aks-journey/resources-guided.lab.js'
import { aksResourcesTroubleshootingLab } from './aks-journey/resources-troubleshooting.lab.js'
import { aksResourcesIndependentLab } from './aks-journey/resources-independent.lab.js'
import { aksReleasesGuidedLab } from './aks-journey/releases-guided.lab.js'
import { aksReleasesTroubleshootingLab } from './aks-journey/releases-troubleshooting.lab.js'
import { aksReleasesIndependentLab } from './aks-journey/releases-independent.lab.js'
import { diagnosisGuidedLab } from './aks-journey/diagnosis-guided.lab.js'
import { diagnosisTroubleshootingLab } from './aks-journey/diagnosis-troubleshooting.lab.js'
import { diagnosisIndependentLab } from './aks-journey/diagnosis-independent.lab.js'
import { aksCapstoneLab } from './aks-journey/capstone.lab.js'
import { cosmosSdkGuidedLab } from './data-journey/cosmos-sdk-guided.lab.js'
import { cosmosVectorGuidedLab } from './data-journey/cosmos-vector-guided.lab.js'
import { cosmosTroubleshootingLab } from './data-journey/cosmos-troubleshooting.lab.js'
import { cosmosIndependentLab } from './data-journey/cosmos-independent.lab.js'
import { postgresConnectGuidedLab } from './data-journey/postgres-connect-guided.lab.js'
import { postgresVectorGuidedLab } from './data-journey/postgres-vector-guided.lab.js'
import { postgresPoolingGuidedLab } from './data-journey/postgres-pooling-guided.lab.js'
import { postgresTroubleshootingLab } from './data-journey/postgres-troubleshooting.lab.js'
import { postgresIndependentLab } from './data-journey/postgres-independent.lab.js'
import { redisCacheGuidedLab } from './data-journey/redis-cache-guided.lab.js'
import { redisTroubleshootingLab } from './data-journey/redis-troubleshooting.lab.js'
import { redisIndependentLab } from './data-journey/redis-independent.lab.js'
import { dataCapstoneLab } from './data-journey/capstone.lab.js'

// Catalog order = Home card order (design artboard 1).
export const LABS = [
  servicebusOrderBackendLab,
  containerappsKedaLab,
  cosmosVectorSearchLab,
  keyvaultSecretsLab,
  functionsServerlessApiLab,
  eventgridFilteredSubscriptionLab,
  deployGuidedLab,
  deployTroubleshootingLab,
  deployIndependentLab,
  cpuGuidedLab,
  cpuTroubleshootingLab,
  cpuIndependentLab,
  probesGuidedLab,
  probesTroubleshootingLab,
  probesIndependentLab,
  foundryGuidedLab,
  foundryTroubleshootingLab,
  foundryIndependentLab,
  bicepGuidedLab,
  bicepTroubleshootingLab,
  bicepIndependentLab,
  capstoneLab,
  aksDeployGuidedLab,
  aksDeployTroubleshootingLab,
  aksDeployIndependentLab,
  aksConfigGuidedLab,
  aksConfigTroubleshootingLab,
  aksConfigIndependentLab,
  aksConnectivityGuidedLab,
  aksConnectivityTroubleshootingLab,
  aksConnectivityIndependentLab,
  aksAiGuidedLab,
  aksAiTroubleshootingLab,
  aksAiIndependentLab,
  aksProbesGuidedLab,
  aksProbesTroubleshootingLab,
  aksProbesIndependentLab,
  aksResourcesGuidedLab,
  aksResourcesTroubleshootingLab,
  aksResourcesIndependentLab,
  aksReleasesGuidedLab,
  aksReleasesTroubleshootingLab,
  aksReleasesIndependentLab,
  diagnosisGuidedLab,
  diagnosisTroubleshootingLab,
  diagnosisIndependentLab,
  aksCapstoneLab,
  cosmosSdkGuidedLab,
  cosmosVectorGuidedLab,
  cosmosTroubleshootingLab,
  cosmosIndependentLab,
  postgresConnectGuidedLab,
  postgresVectorGuidedLab,
  postgresPoolingGuidedLab,
  postgresTroubleshootingLab,
  postgresIndependentLab,
  redisCacheGuidedLab,
  redisTroubleshootingLab,
  redisIndependentLab,
  dataCapstoneLab,
]

export function labById(id) {
  return LABS.find((l) => l.id === id)
}

export function nextLabFor(lab, catalog = LABS) {
  if (!lab) return null
  if (lab.journeyId) return catalog.filter((candidate) => candidate.journeyId === lab.journeyId && candidate.journeyOrder > lab.journeyOrder)
    .sort((left, right) => left.journeyOrder - right.journeyOrder)[0] ?? null
  const legacy = catalog.filter((candidate) => candidate.engineVersion === undefined)
  const index = legacy.findIndex((candidate) => candidate.id === lab.id)
  return index < 0 ? null : legacy[index + 1] ?? null
}

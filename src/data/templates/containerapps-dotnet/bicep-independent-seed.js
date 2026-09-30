import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { emptyBicepProvenance } from '../../../lib/bicep/provenance.js'
import { BICEP_INDEPENDENT_CONFIGS, BICEP_INDEPENDENT_MANIFEST, BICEP_INDEPENDENT_TARGETS } from './bicep-independent.js'

const settingPath = 'src/Trainer.Api/appsettings.json'
const seedCommand = (run, lab, line) => {
  const result = applyRunAction(run, { type: 'command', line }, lab)
  if (result.diagnostics.length || result.lines.some(item => item.kind === 'err'))
    throw new Error(`Independent Bicep seed failed at ${line}: ${JSON.stringify(result.diagnostics.length ? result.diagnostics : result.lines)}`)
  return result.run
}

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-24T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}

export function initializeBicepIndependentSimulation(run) {
  const seedLab = { id: run.labId, engineVersion: 2, contentVersion: run.contentVersion,
    manifestId: BICEP_INDEPENDENT_MANIFEST.id, tasks: [], bicepTargets: BICEP_INDEPENDENT_TARGETS,
    capabilities: { bicepDeployment: true, acrBuild: true, foundryInference: true, cpuScaling: true },
    cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] } }
  let seeded = run
  for (const config of BICEP_INDEPENDENT_CONFIGS) {
    seeded = seedCommand(seeded, seedLab, `az group create -n ${config.resourceGroup} -l eastus`)
    seeded = seedCommand(seeded, seedLab, `az acr create -g ${config.resourceGroup} -n ${config.registryName} --sku Basic`)
  }
  for (const config of BICEP_INDEPENDENT_CONFIGS) {
    const settings = JSON.stringify({ ListeningPort: 8080, FoundryEndpoint: config.endpoint,
      FoundryDeployment: config.modelDeploymentName }, null, 2) + '\n'
    seeded = { ...seeded, project: { ...seeded.project,
      savedFiles: { ...seeded.project.savedFiles, [settingPath]: settings },
      draftFiles: { ...seeded.project.draftFiles, [settingPath]: settings } } }
    seeded = seedCommand(seeded, seedLab,
      `az acr build --registry ${config.registryName} --image api:${config.imageTag} --file Dockerfile .`)
  }
  seeded = { ...seeded, project: run.project }
  const first = BICEP_INDEPENDENT_CONFIGS[0]
  seeded = seedCommand(seeded, seedLab, `az deployment group create --name ${first.deploymentName} `
    + `--resource-group ${first.resourceGroup} --template-file infra/main.bicep --parameters ${first.parameterPath}`)
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts,
    runtime: { ...seeded.runtime, bicep: emptyBicepProvenance() }, nextSequence: seeded.nextSequence }
}

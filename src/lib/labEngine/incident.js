import { appArmId } from '../simulation/runtime.js'
import { foundryInferenceReady } from '../simulation/inference.js'
import { fail } from './errors.js'
import { sourceVersionsAt } from './sourceJournal.js'

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const diagnosticFor = incident => ({ appId: incident.appId, level: 'error',
  code: 'CAPSTONE_INCIDENT_INJECTED', incidentId: incident.id,
  message: `Simulated live drift: FOUNDRY_DEPLOYMENT is missing-deployment (${incident.id}).` })
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function validateCapstoneIncident(run, lab) {
  if (lab.capabilities?.acaCapstone !== true) return
  const incident = run.runtime.incident
  const drifted = run.sandbox.containerApps.filter(app => app.incidentDrift !== undefined)
  if (!incident) {
    if (drifted.length) fail('INVALID_RUN', 'Capstone app drift has no reducer incident.')
    return
  }
  const app = run.sandbox.containerApps.find(item => same(appArmId(item), incident.appId))
  const active = run.runtime.deploymentsByApp[incident.appId]?.active
  const deletedAfterCheckpoint = !app && !active && incident.status === 'repaired'
    && run.stages.sealedStages.length >= 6 && run.stages.cleanupCheckpoint
    && run.stages.ownedGroups.some(name => incident.appId.toLowerCase().includes(`/resourcegroups/${name.toLowerCase()}/`))
    && run.stages.deletedApps?.some(record => same(record.appId, incident.appId)
      && record.sequence > run.stages.cleanupCheckpoint.sequence)
  const stage4 = run.stages.sealedStages[3]
  const drift = app?.incidentDrift
  const healthyProof = stage4?.evidenceIds.some(id => {
    const record = run.evidence.experimentsById[id]
    return record?.sequence < incident.sequence && record.outcome === 'passed'
      && record.measurements?.appId === incident.appId && record.measurements.status === 200
      && record.measurements.upstream?.attempts?.some(attempt => attempt.status === 200)
  })
  const logs = (run.runtime.logs ?? []).filter(item => item.code === 'CAPSTONE_INCIDENT_INJECTED'
    && item.incidentId === incident.id && item.appId === incident.appId)
  const baselineIds = [...new Set(run.stages.sealedStages.slice(0, 4)
    .map(seal => seal.deployment?.attemptId).filter(Boolean))].sort()
  const baseline = incident.baselineAttempts
  const baselineValid = Array.isArray(baseline) && baseline.length === baselineIds.length && baseline.length <= 4
    && JSON.stringify(baseline).length <= 65_536
    && baseline.every((attempt, index) => attempt?.id === baselineIds[index]
      && attempt.status === 'succeeded' && attempt.sequence < incident.sequence
      && /^bicep-attempt-[1-9]\d*$/.test(attempt.id)
      && Number(attempt.id.slice(14)) < run.runtime.bicep.nextAttempt
      && (run.runtime.bicep.attempts.find(record => record.id === attempt.id) === undefined
        || equal(run.runtime.bicep.attempts.find(record => record.id === attempt.id), attempt))
      && run.stages.sealedStages.slice(0, 4).some(seal => seal.deployment?.attemptId === attempt.id
        && seal.deployment.sourceHash === attempt.sourceHash
        && seal.deployment.parameterHash === attempt.parameterHash
        && seal.deployment.target === attempt.target
        && seal.deployment.templatePath === (attempt.templatePath ?? null)))
  if (!exact(incident, ['id', 'appId', 'sequence', 'status', 'baseGeneration', 'effectiveGeneration',
    'desiredDeployment', 'restoredGeneration', 'diagnostic', 'baselineAttempts', 'repairAttempt'])
    || incident.id !== `incident-${incident.sequence}` || !Number.isSafeInteger(incident.sequence)
    || incident.sequence < 1 || incident.sequence >= run.nextSequence
    || !stage4 || stage4.sequence >= incident.sequence || stage4.incidentId !== null || !healthyProof
    || (!app || !active) && !deletedAfterCheckpoint || !['active', 'repaired'].includes(incident.status)
    || typeof incident.baseGeneration !== 'string' || !incident.baseGeneration
    || incident.effectiveGeneration !== `effective-${incident.sequence}`
    || typeof incident.desiredDeployment !== 'string' || !incident.desiredDeployment
    || drifted.length > 1 || !baselineValid || !equal(incident.diagnostic, diagnosticFor(incident))
    || logs.length > 1 || (logs.length === 1 && !equal(logs[0], incident.diagnostic)))
    fail('INVALID_RUN', 'Capstone incident identity or healthy seal linkage is invalid.')
  if (incident.status === 'active') {
    if (!exact(drift, ['incidentId', 'sequence', 'effectiveDeployment', 'effectiveGeneration'])
      || drift.incidentId !== incident.id || drift.sequence !== incident.sequence
      || drift.effectiveDeployment !== 'missing-deployment'
      || drift.effectiveGeneration !== incident.effectiveGeneration
      || active.generation !== incident.baseGeneration || incident.restoredGeneration !== null
      || incident.repairAttempt !== null
      || active.foundry?.deployment !== incident.desiredDeployment) {
      fail('INVALID_RUN', 'Capstone active drift disagrees with its immutable deployment snapshot.')
    }
  } else {
    const main = lab.bicepTargets?.find(item => item.templatePath === 'infra/main.bicep'
      && item.parameterPath === 'infra/main.bicepparam' && item.appName)
    const repair = incident.repairAttempt
    const retained = run.runtime.bicep?.attempts.find(attempt => attempt.id === repair?.id)
    const oldest = run.runtime.bicep?.attempts[0]?.id ?? `bicep-attempt-${run.runtime.bicep?.nextAttempt}`
    const versionAtRepair = Number.isSafeInteger(repair?.sequence)
      ? sourceVersionsAt(run.project.sourceJournal, repair.sequence) : null
    if (drift !== undefined || drifted.length || (active && incident.restoredGeneration !== active.generation)
      || incident.restoredGeneration === incident.baseGeneration
      || (active && active.foundry?.deployment !== incident.desiredDeployment)
      || !exact(repair, ['id', 'key', 'target', 'name', 'status', 'sourceHash', 'parameterHash',
        'fileVersions', 'parameterPath', 'sequence', 'templatePath', 'operations', 'outputs', 'diagnostics'])
      || JSON.stringify(repair).length > 32_768
      || repair.status !== 'succeeded' || repair.sequence <= incident.sequence
      || repair.sequence >= run.nextSequence || incident.restoredGeneration !== `deployment-${repair.sequence}`
      || !/^bicep-attempt-[1-9]\d*$/.test(repair.id)
      || Number(repair.id.slice(14)) >= run.runtime.bicep.nextAttempt
      || repair.target !== main?.resourceGroup || repair.name !== main?.deploymentName
      || repair.key !== `${main?.resourceGroup}/${main?.deploymentName}`.toLowerCase()
      || repair.parameterPath !== main?.parameterPath || repair.templatePath !== main?.templatePath
      || typeof repair.sourceHash !== 'string' || !repair.sourceHash || repair.sourceHash.length > 512
      || typeof repair.parameterHash !== 'string' || !repair.parameterHash || repair.parameterHash.length > 512
      || !Array.isArray(repair.operations) || repair.operations.length > 32
      || !Array.isArray(repair.diagnostics) || repair.diagnostics.length !== 0
      || !repair.operations.some(operation => same(operation.id, incident.appId)
        && operation.type === 'Microsoft.App/containerApps' && operation.changeType === 'modify')
      || !repair.fileVersions || Object.keys(repair.fileVersions).length > 12
      || Object.entries(repair.fileVersions).some(([path, version]) =>
        (versionAtRepair?.[path] ?? 0) !== version)
      || (retained ? !equal(retained, repair)
        : Number(repair.id.slice(14)) >= Number(oldest.slice(14)))) {
      fail('INVALID_RUN', 'Capstone repair does not match a successful saved main deployment.')
    }
  }
}

export function injectCapstoneIncident(run, lab) {
  if (lab.capabilities?.acaCapstone !== true || lab.capabilities?.foundryInference !== true
    || run.stages.sealedStages.length !== 4 || run.runtime.incident !== undefined
    || run.runtime.activeScenario !== null) return null
  const target = lab.bicepTargets?.find(item => item.templatePath === 'infra/main.bicep'
    && item.parameterPath === 'infra/main.bicepparam' && item.appName)
  if (!target) return null
  const app = run.sandbox.containerApps.find(item => same(item.name, target.appName)
    && same(item.resourceGroup, target.resourceGroup))
  if (!app || app.incidentDrift !== undefined) return null
  const appId = appArmId(app)
  const deployment = run.runtime.deploymentsByApp[appId]
  const active = deployment?.active
  if (deployment?.status !== 'succeeded' || !active?.foundry?.deployment
    || active.foundry.deployment === 'missing-deployment'
    || !foundryInferenceReady(run, appId)
    || !run.stages.sealedStages[3].evidenceIds.some(id => {
      const record = run.evidence.experimentsById[id]
      return record?.measurements?.appId === appId && record.measurements.status === 200
        && record.measurements.upstream?.attempts?.some(attempt => attempt.status === 200)
    })
    || !run.sandbox.foundryAccounts.some(account => same(account.endpoint, active.foundry.endpoint)
      && account.deployments.some(item => same(item.name, active.foundry.deployment)))) return null
  const sequence = run.nextSequence
  const baselineIds = [...new Set(run.stages.sealedStages.slice(0, 4)
    .map(seal => seal.deployment?.attemptId).filter(Boolean))].sort()
  const baselineAttempts = baselineIds.map(id => run.runtime.bicep?.attempts.find(attempt => attempt.id === id))
  if (baselineAttempts.some(attempt => !attempt)) return null
  const incident = { id: `incident-${sequence}`, appId, sequence, status: 'active',
    baseGeneration: active.generation, effectiveGeneration: `effective-${sequence}`,
    desiredDeployment: active.foundry.deployment, restoredGeneration: null,
    diagnostic: null, baselineAttempts: structuredClone(baselineAttempts), repairAttempt: null }
  incident.diagnostic = diagnosticFor(incident)
  const incidentDrift = { incidentId: incident.id, sequence,
    effectiveDeployment: 'missing-deployment', effectiveGeneration: incident.effectiveGeneration }
  return { ...run, nextSequence: sequence + 1,
    sandbox: { ...run.sandbox, containerApps: run.sandbox.containerApps.map(item => item === app ? { ...item, incidentDrift } : item) },
    runtime: { ...run.runtime, incident, logs: [...(run.runtime.logs ?? []), incident.diagnostic].slice(-500) },
    dependencyGenerations: { ...run.dependencyGenerations,
      [`foundry:${appId}`]: (run.dependencyGenerations[`foundry:${appId}`] ?? 0) + 1,
      [`deployment:${appId}`]: (run.dependencyGenerations[`deployment:${appId}`] ?? 0) + 1 } }
}

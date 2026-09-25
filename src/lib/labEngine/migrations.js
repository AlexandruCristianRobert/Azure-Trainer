import { LabEngineError } from './errors.js'
import { cloneJson, validateBehavioralLab, validateBehavioralRun } from './run.js'
import { emptyBicepProvenance } from '../bicep/provenance.js'
import { emptyKubernetesRuntime } from '../kubernetes/state.js'

export function migrateBehavioralRun(raw, lab) {
  try {
    validateBehavioralLab(lab)
    const migrated = cloneJson(raw)
    if (lab.capabilities?.kubernetes === true && migrated.runtime?.kubernetes === undefined) migrated.runtime.kubernetes = emptyKubernetesRuntime()
    validateBehavioralRun(migrated, lab)
    if (lab.capabilities?.bicepDeployment === true && migrated.runtime.bicep === undefined)
      migrated.runtime.bicep = emptyBicepProvenance({ trackIncident: lab.capabilities?.bicepIdentityFault === true })
    return migrated
  } catch (error) {
    if (error instanceof LabEngineError) {
      throw new LabEngineError(error.code, error.message, { ...error.details, raw })
    }
    throw error
  }
}

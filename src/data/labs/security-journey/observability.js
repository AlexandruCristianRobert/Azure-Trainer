import { observabilitySetupLab } from './telemetry-setup.lab.js'
import { observabilitySpansLab } from './spans.lab.js'
import { observabilityContextLab } from './context.lab.js'
import { observabilityLoggingLab } from './logging.lab.js'
import { observabilityFailureQueryLab } from './failure-query.lab.js'
import { observabilityMetricsLab } from './metrics.lab.js'

export const OBSERVABILITY_LABS = [observabilitySetupLab, observabilitySpansLab, observabilityContextLab,
  observabilityLoggingLab, observabilityFailureQueryLab, observabilityMetricsLab]

import { SETUP_SOURCE, LOGGING_SOURCE } from '../../templates/security-python/telemetry.js'
import { observabilityLab, loggingObserved } from './helpers.js'

export const observabilityLoggingLab = observabilityLab({ stage: 'logging', order: 9,
  title: 'Simulated: Add safe structured notification logs',
  brief: 'Earlier working exporter and notification source are supplied without execution. Add the new structured log using safe order metadata and the actual provider response. No log or completion proof is seeded.',
  text: 'Create logging.getLogger("orders") with INFO level. Inside the actual NotifyOrder span, consume the secret with send_notification and, only on status_code 202, log "Notification accepted". Supply extra fields app.order_id, app.channel and app.status_code using o1 and the returned channel/status. Save worker.py and run once. Never log secret handles, payloads, email addresses or other sensitive data; a blocked sensitive logging attempt still fails this exercise.',
  rationale: { concept: 'Correlated, safe structured logs', what: 'Exports safe fields from the actual successful consumer response in AppTraces under the same span.', why: 'Structured fields support filtering while correlation connects a log to the operation that produced it.', without: 'A free-floating log or printed success may describe no actual notification, and sensitive payloads would cross a public boundary.', csharp: 'logging with extra fields parallels ILogger structured properties within Activity.Current. The simulator rejects selected sensitive names/text and opaque secrets before export; it is a bounded teaching guard, not a general PII classifier.' },
  source: LOGGING_SOURCE, starter: SETUP_SOURCE, behavior: loggingObserved,
})

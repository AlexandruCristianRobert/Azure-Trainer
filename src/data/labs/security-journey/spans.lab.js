import { SETUP_SOURCE, SPANS_SOURCE } from '../../templates/security-python/telemetry.js'
import { observabilityLab, spansObserved } from './helpers.js'

export const observabilitySpansLab = observabilityLab({ stage: 'spans', order: 7,
  title: 'Simulated: Trace a successful notification and its rejected retry',
  brief: 'The exporter and earlier working secret consumer are supplied as saved source. During this execution advance_security_fixture advances 60 logical seconds, rotates the vault key and changes provider acceptance. The saved earlier handle then really receives 401; no failure row is seeded.',
  text: 'Instrument two NotifyOrder spans with app.order_id="o1" and app.attempt 1 then 2. Read the key and notify successfully in the first span. Advance the disclosed fixture, then use the same earlier key handle in the second span. On the actual rejected result, set Status(StatusCode.ERROR) and record_exception(ValueError("Notification rejected")). Save worker.py and run once. The failed span and sanitized exception must link to the rejected provider operation.',
  rationale: { concept: 'Business spans, attributes and real error status', what: 'Labels actual operation attempts and records the failure returned by the provider.', why: 'A handled 401 does not automatically escape as a Python exception; the caller must translate that result into span status.', without: 'A disconnected manual error span could misrepresent successful work, or a rejection could appear successful.', csharp: 'start_as_current_span and set_attribute parallel ActivitySource.StartActivity and Activity.SetTag; setting ERROR after the real result parallels Activity.SetStatus(Error). Exception text is intentionally omitted by this simulator.' },
  source: SPANS_SOURCE, starter: SETUP_SOURCE, behavior: spansObserved,
})

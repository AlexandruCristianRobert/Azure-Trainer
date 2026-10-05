import { SETUP_SOURCE } from '../../templates/security-python/telemetry.js'
import { SECRET_SOLUTION_SOURCE } from '../../templates/security-python/security.js'
import { observabilityLab, setupObserved } from './helpers.js'

export const observabilitySetupLab = observabilityLab({ stage: 'setup', order: 6,
  title: 'Simulated: Export the notification operation to Azure Monitor',
  brief: 'Earlier identity, vault access and working notification source are supplied. The ai-orders destination is pre-provisioned. No instrumentation or exported rows exist yet. This is browser-only SDK simulation; no real connection, Python process or Azure ingestion runs.',
  text: 'In worker.py import configure_azure_monitor and trace. Configure the supplied ai-orders connection string with logger_name="orders", get an orders tracer, and wrap the actual secret read and send_notification in a NotifyOrder span. Save and run python worker.py once. The successful provider effect and its AppDependencies row must belong to the same operation. Copy the trainer connection string from local.settings.json.',
  rationale: { concept: 'Explicit Azure Monitor export', what: 'Configures the pre-provisioned destination and exports an actual instrumented operation.', why: 'Creating a tracer alone neither selects an exporter nor establishes business activity.', without: 'A successful notification would be invisible to the telemetry query dataset.', csharp: 'Python configure_azure_monitor plus trace.get_tracer parallels configuring Azure Monitor export and an ActivitySource in C#. These are bounded browser adapters, not production SDK startup.' },
  source: SETUP_SOURCE, starter: SECRET_SOLUTION_SOURCE, behavior: setupObserved,
})

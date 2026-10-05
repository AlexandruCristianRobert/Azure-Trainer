import { FAILURE_STARTER, FAILURE_SOURCE } from '../../templates/security-python/telemetry.js'
import { observabilityLab, failureQueryObserved } from './helpers.js'

export const observabilityFailureQueryLab = observabilityLab({ stage: 'failure-query', order: 10,
  title: 'Simulated: Query the actual rejected notification',
  brief: 'Disclosed earlier-stage instrumentation in produce_telemetry creates one successful notification and one real rejection in this execution. The fixture rotates the accepted key after the first call; the second reuses the old handle. Only the new saved KQL query is unfinished. No telemetry journal, query result or proof is seeded.',
  text: 'Keep produce_telemetry(), then write a query string in worker.py and call query_telemetry after it returns. Query AppDependencies, filter Name to NotifyOrder and Success to false, and project OrderId=tostring(Properties["app.order_id"]), OperationId and DurationMs. Return the query result and run python worker.py once. Inspect the one actual failed operation: its duration is logical work cost, not elapsed cloud latency. Printing an expected answer cannot establish query evidence.',
  rationale: { concept: 'Failure filtering over retained telemetry', what: 'Evaluates a saved KQL query against the rows that the earlier-stage code actually exports during this command.', why: 'A query receipt binds parsed operators, input row IDs and computed rows to the retained dataset.', without: 'A canned output or filter on unrelated telemetry would provide no evidence about the rejected notification.', csharp: 'The KQL table/column vocabulary is independent of Python or C#. Python query_telemetry is a trainer helper; production C# commonly uses a LogsQueryClient against the corresponding workspace API. Unsupported KQL produces explicit diagnostics.' },
  source: FAILURE_SOURCE, starter: FAILURE_STARTER, behavior: failureQueryObserved,
})

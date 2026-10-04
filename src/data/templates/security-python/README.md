# Order Processing: bounded telemetry

`ai-orders` is a pre-provisioned simulated Application Insights destination. No
cloud resource creation, Python installation or network access is needed. In saved
Python source, explicitly select the exporter before obtaining tracer, logger or
meter handles:

```python
from azure.monitor.opentelemetry import configure_azure_monitor
configure_azure_monitor(
    connection_string="InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/",
    logger_name="orders")
```

For `func start`, select `"telemetryMode": "OpenTelemetry"` in `host.json`.
In `local.settings.json` Values, set `APPLICATIONINSIGHTS_CONNECTION_STRING` to
the same trainer string, and set `PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY`
to the string `"false"` (or `"0"`). This exercise uses manual SDK configuration,
so the host must not also enable automatic Python instrumentation. It does not
use the separate OTLP export path or require `PYTHON_ENABLE_OPENTELEMETRY`.

Use `tracer.start_as_current_span` for scoped spans, `propagate.inject/extract`
for carriers, `logging.getLogger("orders")` for correlated logs, and
`metrics.get_meter` for counters and histograms. SERVER/CONSUMER spans project to
AppRequests; other kinds project to AppDependencies. Exceptions, logs and metric
measurements use AppExceptions, AppTraces and AppMetrics. Unsupported SDK options
produce diagnostics. The trainer does not run the real SDK packages.

Put Event Grid propagation in application data `trace_context`. Service Bus
application properties support `traceparent` and conversion from W3C
`Diagnostic-Id`; received properties are read-only. Malformed carriers fail.
Each actual Function attempt has a distinct consumer span and restores the
previous context after return or error.

`TimeGenerated` uses the fixed trainer epoch 2026-01-01T00:00:00.000Z plus logical
fixture time. `DurationMs` sums deterministic costs of operations actually called
inside the span, including child work. Both are simulated, as Properties labels
state; learner attributes cannot set either value. Metrics record measurements
from executed source; task evidence should also check the linked business result.

There are at most 100 spans per command, 16 nested spans, 32 learner attributes,
500 telemetry rows per attempt and 128 KiB of security/telemetry state. An export
and its journal row commit together. If a span cannot be exported within capacity,
its telemetry and effects roll back. No old rows are silently evicted.

Keep order IDs, attempt numbers and channel names; omit credentials, email,
phone, customer details and arbitrary sensitive payload fields. Secret tokens
stay private. Sensitive emission fails the exercise and records only a violation
category. This is a bounded educational policy, not a general PII detector.

Host configuration reference:
https://learn.microsoft.com/en-us/azure/azure-functions/opentelemetry-howto?pivots=programming-language-python

In saved source, `from training_runtime import query_telemetry` reads retained
exports in the fixed ai-orders workspace, without configuring an exporter:

```python
def main():
    return query_telemetry("AppRequests | summarize Total=count(), MeanMs=avg(DurationMs)")
```

The result is `{rows}` computed from actual selected-table exports. Supported
operators are where, project, extend, summarize, order by and take; aggregates
are count, countif, sum, avg, min and max. Comparisons, and/or, numeric arithmetic,
Properties string-key access and tostring/toint/todouble conversions are bounded.
Missing fields and invalid numeric conversions return null; division by zero
returns null. Empty ungrouped counts/sum return 0 and avg/min/max return null;
grouped empty input has no rows. Fractional averages and rates remain finite JSON.

Queries allow 16 KiB of text, 16 operators, 500 input rows and 200 result rows.
Unsupported syntax (including join, union and cross-workspace queries) produces
a value-free KQL diagnostic and rolls back the whole command's new effects.
Receipts retain actual export IDs, table generation, source/operator lineage and
computed rows; constants do not gain aggregation lineage. New exports in the
queried table make previous query completion require verification again. Other
tables leave it current. Restore recomputes each query from its journal prefix.
Sensitive query text, field names and results are rejected before persistence.

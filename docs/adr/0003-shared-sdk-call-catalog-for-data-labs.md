---
status: accepted
date: 2026-10-01
---

# Recognize learner SDK code through one shared call catalog

The Data journey (Cosmos DB for NoSQL, Azure Database for PostgreSQL, Azure Managed Redis) has learners write real Python SDK calls (`azure-cosmos`, `psycopg` 3 / `psycopg_pool`, `redis-py`) inside marked functions of a fixed scaffold. The simulator still does not execute Python (ADR-0002). The AKS journey recognizes learner Python by lowering a narrow, hand-written subset into an operation graph per Lab family (`src/lib/project/python-integration.js`), which needs new bespoke rules for every API shape.

For the Data journey, recognize SDK usage through **one shared catalog of supported calls**. Each call is declared once with its receiver, parameters, validation and simulated effect. Query strings passed to those calls are evaluated by three bounded evaluators: a Cosmos NoSQL query subset, a PostgreSQL SQL subset (extending the retrieval SQL support), and a Redis command/query subset. Performance evidence (RU charge, plans, latency, hit ratio) comes from deterministic, documented cost models and is judged against thresholds.

**Considered options:** Extending the AKS per-Lab lowering would reuse existing code but would multiply bespoke rules across three SDKs and 13 Labs. Config-only Labs (supplied code, learner changes settings) would be far cheaper but would not practise the SDK calls the exam names. Executing real Python in the browser would give the highest fidelity but contradicts ADR-0002's bounded, non-executing simulation.

**Consequences:**

- A call outside the catalog yields an explicit "unsupported by the simulator" diagnostic, never a fake Azure or Python error.
- Adding a Lab should mostly mean adding fixtures, Tasks and, occasionally, catalog entries, not new recognition code.
- The catalog, evaluators and cost models are the core logic that the journey's (deliberately light) tests cover.
- The AKS journey's existing recognition code is not migrated.

import { INTEGRATION_FIXTURES } from '../../fixtures/aks/integration.js'

export const INTEGRATION_CLIENTS_SOURCE = `"""Fixed, deterministic adapter used by the AKS assistant exercises."""
import json
FIXTURE_CATALOG = json.loads(r'''${JSON.stringify(INTEGRATION_FIXTURES)}''')

class RetryPolicy:
    def __init__(self, max_attempts=3, retryable=("THROTTLED", "UNAVAILABLE", "TIMEOUT"), total_budget_ms=1000, attempt_timeout_ms=200, sdk_retries=0):
        self.max_attempts = max_attempts
        self.retryable = retryable
        self.total_budget_ms = total_budget_ms
        self.attempt_timeout_ms = attempt_timeout_ms
        self.sdk_retries = sdk_retries

class RequestBudget:
    def __init__(self, policy):
        self.policy = policy
        self.elapsed_ms = 0
    def can_attempt(self):
        return self.elapsed_ms < self.policy.total_budget_ms
    def wait(self, milliseconds):
        self.elapsed_ms = min(self.policy.total_budget_ms, self.elapsed_ms + milliseconds)

def as_vector(values):
    if not isinstance(values, list) or len(values) != 3 or not all(isinstance(item, (int, float)) for item in values):
        raise ValueError("VECTOR_DIMENSION")
    return "[" + ",".join(str(item) for item in values) + "]"

class EmbeddingClient:
    def embed(self, question, deployment):
        return FIXTURE_CATALOG["questions"].get(question, {}).get("embedding")

class QueryClient:
    def query(self, vector, query_source, parameters):
        return []

class AnswerClient:
    def answer(self, question, context, deployment):
        return "No matching documents."
`

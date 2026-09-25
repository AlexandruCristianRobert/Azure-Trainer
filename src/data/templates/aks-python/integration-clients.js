import { INTEGRATION_FIXTURES } from '../../fixtures/aks/integration.js'

export const TRAINING_CLIENTS_SOURCE = `"""Fixed, deterministic adapter used by the AKS assistant exercises."""
import json
FIXTURE_CATALOG = json.loads(r'''${JSON.stringify(INTEGRATION_FIXTURES)}''')

class RetryPolicy:
    def __init__(self, max_attempts, retryable_codes, base_delay_ms, max_delay_ms, attempt_timeout_ms):
        self.max_attempts = max_attempts
        self.retryable_codes = retryable_codes
        self.base_delay_ms = base_delay_ms
        self.max_delay_ms = max_delay_ms
        self.attempt_timeout_ms = attempt_timeout_ms

class RequestBudget:
    def __init__(self, total_ms):
        self.total_ms = total_ms
        self.elapsed_ms = 0
    def invoke(self, operation, policy, **kwargs):
        for attempt in range(policy.max_attempts):
            if self.elapsed_ms >= self.total_ms: raise DependencyError()
            try: return operation(**kwargs)
            except DependencyError as error:
                if error.code not in policy.retryable_codes or attempt + 1 == policy.max_attempts: raise
                self.elapsed_ms += min(policy.max_delay_ms, policy.base_delay_ms * (attempt + 1))

def as_vector(values):
    if not isinstance(values, list) or len(values) != 3 or not all(isinstance(item, (int, float)) for item in values):
        raise ValueError("VECTOR_DIMENSION")
    return "[" + ",".join(str(item) for item in values) + "]"

class EmbeddingClient:
    def __init__(self, **kwargs): self.configuration = kwargs
    def embed(self, question, deployment):
        return FIXTURE_CATALOG["questions"].get(question, {}).get("embedding")

class PgClient:
    def __init__(self, **kwargs): self.configuration = kwargs
    def execute(self, sql, params):
        return []

class AnswerClient:
    def __init__(self, **kwargs): self.configuration = kwargs
    def generate(self, question, context, deployment): return {"answer": "No matching documents."}

class DependencyError(Exception):
    http_status = 503
    public_message = "A dependency is unavailable."
    code = "UNAVAILABLE"
`

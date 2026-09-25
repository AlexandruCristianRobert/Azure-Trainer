import { INTEGRATION_FIXTURES } from '../../fixtures/aks/integration.js'

export const TRAINING_CLIENTS_SOURCE = `"""Local AKS training adapters: deterministic fixtures, no network, no sleeping.
Supported operations: embed(question, deployment), execute(sql, params),
generate(question, context, deployment), and RequestBudget.invoke(operation, policy).
Set SCENARIO_PROFILE to one of the immutable fixture profiles to demonstrate
request-local stage failures. These are teaching adapters, not Azure or Psycopg SDKs.
"""
import json
import math
import os

FIXTURE_CATALOG = json.loads(r'''${JSON.stringify(INTEGRATION_FIXTURES)}''')

class DependencyError(Exception):
    _PUBLIC = {
        "INPUT_REQUIRED": (400, "A question is required."),
        "UNSUPPORTED_FIXTURE_INPUT": (422, "This question is outside the local training fixture."),
        "UNSUPPORTED_FIXTURE_CONTEXT": (422, "This context is outside the local training fixture."),
        "AI_ENDPOINT": (502, "The configured AI endpoint is not available in this trainer."),
        "AI_DEPLOYMENT": (502, "The configured AI deployment is not available in this trainer."),
        "POSTGRES_CONNECTION": (503, "The configured PostgreSQL host is not available in this trainer."),
        "POSTGRES_AUTH": (503, "The configured PostgreSQL credentials are not available in this trainer."),
        "VECTOR_DIMENSION": (503, "The embedding vector has an unsupported dimension."),
        "QUERY_PARAMETERS": (503, "The retrieval query has invalid or missing parameters."),
        "DEPENDENCY_UNAVAILABLE": (503, "A dependency remained unavailable after retries."),
        "DEPENDENCY_TIMEOUT": (504, "A dependency timed out after retries."),
        "DEADLINE_EXCEEDED": (504, "The request time budget was exhausted."),
        "THROTTLED": (503, "A dependency remained throttled after retries."),
        "UNAVAILABLE": (503, "A dependency remained unavailable after retries."),
        "TIMEOUT": (504, "A dependency timed out after retries."),
    }
    def __init__(self, code="UNAVAILABLE", retry_after_ms=0, duration_ms=0):
        self.code = code
        self.http_status, self.public_message = self._PUBLIC.get(code, self._PUBLIC["UNAVAILABLE"])
        self.retry_after_ms = retry_after_ms
        self.duration_ms = duration_ms
        super().__init__(self.public_message)

class RetryPolicy:
    def __init__(self, max_attempts, retryable_codes, base_delay_ms, max_delay_ms, attempt_timeout_ms):
        allowed = {"THROTTLED", "UNAVAILABLE", "TIMEOUT"}
        if not isinstance(max_attempts, int) or not 1 <= max_attempts <= 3:
            raise ValueError("max_attempts must be from 1 through 3")
        if not isinstance(retryable_codes, (tuple, list)) or not set(retryable_codes) <= allowed:
            raise ValueError("retryable_codes contains an unsupported code")
        if not isinstance(base_delay_ms, int) or not 0 <= base_delay_ms <= 500:
            raise ValueError("base_delay_ms must be from 0 through 500")
        if not isinstance(max_delay_ms, int) or not 0 <= max_delay_ms <= 1000:
            raise ValueError("max_delay_ms must be from 0 through 1000")
        if not isinstance(attempt_timeout_ms, int) or not 1 <= attempt_timeout_ms <= 1000:
            raise ValueError("attempt_timeout_ms must be from 1 through 1000")
        self.max_attempts = max_attempts
        self.retryable_codes = tuple(retryable_codes)
        self.base_delay_ms = base_delay_ms
        self.max_delay_ms = max_delay_ms
        self.attempt_timeout_ms = attempt_timeout_ms

class RequestBudget:
    def __init__(self, total_ms):
        if not isinstance(total_ms, int) or not 1 <= total_ms <= 5000:
            raise ValueError("total_ms must be from 1 through 5000")
        self.total_ms = total_ms
        self.elapsed_ms = 0
        self.profile_id = os.environ.get("SCENARIO_PROFILE", "healthy")
        self.script = FIXTURE_CATALOG["scenarioProfiles"].get(self.profile_id)
        if self.script is None:
            raise ValueError("SCENARIO_PROFILE is not a known fixture profile")
        self._stage_positions = {"embedding": 0, "postgres": 0, "answer": 0}
        self.attempts = []

    def invoke(self, operation, policy, **kwargs):
        stage_name = getattr(operation, "_stage_name", None)
        for attempt in range(1, policy.max_attempts + 1):
            remaining = self.total_ms - self.elapsed_ms
            if remaining <= 0:
                raise DependencyError("DEADLINE_EXCEEDED")
            timeout = min(policy.attempt_timeout_ms, remaining)
            scripted = None
            if stage_name:
                script = self.script["stages"][stage_name]
                pos = self._stage_positions[stage_name]
                scripted = script[min(pos, len(script) - 1)]
                self._stage_positions[stage_name] = pos + 1
            latency = scripted["latencyMs"] if scripted else 0
            if scripted and latency > timeout:
                self.elapsed_ms += timeout
                error = DependencyError("TIMEOUT", duration_ms=timeout)
            elif scripted and scripted.get("code"):
                self.elapsed_ms += latency
                error = DependencyError(scripted["code"], scripted.get("retryAfterMs", 0), latency)
            else:
                try:
                    value = operation(**kwargs)
                except DependencyError as caught:
                    duration = min(caught.duration_ms or latency, timeout)
                    self.elapsed_ms += duration
                    error = DependencyError(caught.code, caught.retry_after_ms, duration)
                else:
                    self.elapsed_ms += latency
                    self.attempts.append({"stage": stage_name, "attempt": attempt, "elapsedMs": latency, "outcome": "success"})
                    return value
            self.attempts.append({"stage": stage_name, "attempt": attempt, "elapsedMs": error.duration_ms or latency, "outcome": error.code})
            if error.code not in policy.retryable_codes or attempt == policy.max_attempts:
                if error.code in ("TIMEOUT", "UNAVAILABLE", "THROTTLED"):
                    error = DependencyError({"TIMEOUT": "DEPENDENCY_TIMEOUT", "UNAVAILABLE": "DEPENDENCY_UNAVAILABLE", "THROTTLED": "THROTTLED"}[error.code], duration_ms=error.duration_ms)
                raise error
            proposed = min(policy.base_delay_ms * (2 ** (attempt - 1)), policy.max_delay_ms)
            delay = max(proposed, error.retry_after_ms)
            remaining = self.total_ms - self.elapsed_ms
            if delay >= remaining:
                raise DependencyError("DEADLINE_EXCEEDED")
            self.elapsed_ms += delay
            self.attempts.append({"stage": stage_name, "attempt": attempt, "elapsedMs": delay, "outcome": "wait"})
        raise DependencyError("DEADLINE_EXCEEDED")

def as_vector(values):
    if not isinstance(values, (list, tuple)) or len(values) != 3:
        raise DependencyError("VECTOR_DIMENSION")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in values):
        raise DependencyError("VECTOR_DIMENSION")
    return "[" + ",".join(str(item) for item in values) + "]"

def _vector(value):
    if not isinstance(value, str) or not value.startswith("[") or not value.endswith("]"):
        raise DependencyError("QUERY_PARAMETERS")
    try:
        values = [float(part) for part in value[1:-1].split(",")]
    except ValueError:
        raise DependencyError("QUERY_PARAMETERS")
    if len(values) != 3 or any(not math.isfinite(item) for item in values):
        raise DependencyError("VECTOR_DIMENSION")
    norm = math.sqrt(sum(item * item for item in values))
    if norm == 0:
        raise DependencyError("VECTOR_DIMENSION")
    return values, norm

class EmbeddingClient:
    def __init__(self, endpoint="", sdk_retries=0, **kwargs):
        if sdk_retries != 0:
            raise ValueError("adapter retries are unsupported; RequestBudget owns retry policy")
        self.configuration = {"endpoint": endpoint, **kwargs}
    def embed(self, question, deployment):
        if self.configuration.get("endpoint") not in {profile["AI_ENDPOINT"] for profile in FIXTURE_CATALOG["profiles"].values()}:
            raise DependencyError("AI_ENDPOINT")
        if deployment not in {"embeddings-v1", "embeddings-2d"}:
            raise DependencyError("AI_DEPLOYMENT")
        record = FIXTURE_CATALOG["questions"].get(question)
        if record is None:
            raise DependencyError("UNSUPPORTED_FIXTURE_INPUT")
        vector = list(record["embedding"])
        return vector[:2] if deployment == "embeddings-2d" else vector

class PgClient:
    def __init__(self, host="", database="", user="", password="", sdk_retries=0, **kwargs):
        if sdk_retries != 0:
            raise ValueError("adapter retries are unsupported; RequestBudget owns retry policy")
        self.configuration = {"host": host, "database": database, "user": user, "password": password, **kwargs}
    def execute(self, sql, params):
        known = FIXTURE_CATALOG["profiles"].values()
        if self.configuration.get("host") not in {profile["PGHOST"] for profile in known}:
            raise DependencyError("POSTGRES_CONNECTION")
        profile = next((p for p in known if p["PGHOST"] == self.configuration["host"]), None)
        if any(self.configuration.get(key) != profile[field] for key, field in (("database", "PGDATABASE"), ("user", "PGUSER"), ("password", "PGPASSWORD"))):
            raise DependencyError("POSTGRES_AUTH")
        required = {"collection", "audience", "published", "embedding", "max_distance", "limit"}
        if not isinstance(params, dict) or set(params) != required:
            raise DependencyError("QUERY_PARAMETERS")
        vector, norm = _vector(params["embedding"])
        cutoff, limit = params["max_distance"], params["limit"]
        if isinstance(cutoff, bool) or not isinstance(cutoff, (int, float)) or not math.isfinite(cutoff) or not 0 <= cutoff <= 2:
            raise DependencyError("QUERY_PARAMETERS")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 3:
            raise DependencyError("QUERY_PARAMETERS")
        required_sql = ("FROM documents", "collection = %(collection)s", "audience = %(audience)s", "published = %(published)s", "%(embedding)s::vector", "%(max_distance)s", "LIMIT %(limit)s")
        if not isinstance(sql, str) or any(part.lower() not in sql.lower() for part in required_sql):
            raise DependencyError("QUERY_PARAMETERS")
        docs = []
        for document in FIXTURE_CATALOG["documents"].values():
            if document["collection"] != params["collection"] or document["audience"] != params["audience"] or document["published"] is not params["published"]:
                continue
            target = document["embedding"]
            target_norm = math.sqrt(sum(item * item for item in target))
            distance = 1 - sum(a * b for a, b in zip(vector, target)) / (norm * target_norm)
            distance = min(2.0, max(0.0, distance))
            if distance <= cutoff:
                docs.append((distance, document["id"], {"id": document["id"], "content": document["content"]}))
        docs.sort(key=lambda item: (item[0], item[1]))
        return [row for _, _, row in docs[:limit]]

class AnswerClient:
    def __init__(self, endpoint="", sdk_retries=0, **kwargs):
        if sdk_retries != 0:
            raise ValueError("adapter retries are unsupported; RequestBudget owns retry policy")
        self.configuration = {"endpoint": endpoint, **kwargs}
    def generate(self, question, context, deployment):
        if self.configuration.get("endpoint") not in {profile["AI_ENDPOINT"] for profile in FIXTURE_CATALOG["profiles"].values()}:
            raise DependencyError("AI_ENDPOINT")
        if deployment != "answers-v1":
            raise DependencyError("AI_DEPLOYMENT")
        if not isinstance(context, list) or len(context) != 1 or not isinstance(context[0], dict):
            raise DependencyError("UNSUPPORTED_FIXTURE_CONTEXT")
        document = FIXTURE_CATALOG["documents"].get(context[0].get("id"))
        question_record = FIXTURE_CATALOG["questions"].get(question)
        if document is None or question_record is None or document["content"] != context[0].get("content"):
            raise DependencyError("UNSUPPORTED_FIXTURE_CONTEXT")
        answer = question_record["answers"].get(document["id"])
        if answer is None:
            raise DependencyError("UNSUPPORTED_FIXTURE_CONTEXT")
        return {"answer": answer}

for _client_class, _method, _stage in ((EmbeddingClient, "embed", "embedding"), (PgClient, "execute", "postgres"), (AnswerClient, "generate", "answer")):
    setattr(getattr(_client_class, _method), "_stage_name", _stage)
`

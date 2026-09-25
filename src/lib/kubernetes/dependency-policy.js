const RETRYABLE = new Set(['THROTTLED', 'UNAVAILABLE', 'TIMEOUT'])

const PUBLIC_ERRORS = {
  INPUT_REQUIRED: [400, 'A question is required.'],
  UNSUPPORTED_FIXTURE_INPUT: [422, 'This question is outside the local training fixture.'],
  UNSUPPORTED_FIXTURE_CONTEXT: [422, 'This context is outside the local training fixture.'],
  AI_ENDPOINT: [502, 'The configured AI endpoint is not available in this trainer.'],
  AI_DEPLOYMENT: [502, 'The configured AI deployment is not available in this trainer.'],
  POSTGRES_CONNECTION: [503, 'The configured PostgreSQL host is not available in this trainer.'],
  POSTGRES_AUTH: [503, 'The configured PostgreSQL credentials are not available in this trainer.'],
  VECTOR_DIMENSION: [503, 'The embedding vector has an unsupported dimension.'],
  QUERY_PARAMETERS: [503, 'The retrieval query has invalid or missing parameters.'],
  DEPENDENCY_UNAVAILABLE: [503, 'A dependency remained unavailable after retries.'],
  DEPENDENCY_TIMEOUT: [504, 'A dependency timed out after retries.'],
  DEADLINE_EXCEEDED: [504, 'The request time budget was exhausted.'],
  THROTTLED: [503, 'A dependency remained throttled after retries.'],
  UNAVAILABLE: [503, 'A dependency remained unavailable after retries.'],
  TIMEOUT: [504, 'A dependency timed out after retries.'],
}

function publicError(code) {
  const safeCode = PUBLIC_ERRORS[code] ? code : 'UNAVAILABLE'
  const [status, message] = PUBLIC_ERRORS[safeCode]
  return { code: safeCode, status, message }
}

function stageFor(script, operation, attemptNumber) {
  const stageName = operation === 'postgres-query' ? 'postgres' : operation
  const stages = script?.stages?.[stageName]
  if (!Array.isArray(stages) || stages.length === 0) return null
  return stages[Math.min(attemptNumber - 1, stages.length - 1)]
}

function safeFailure(code, durationMs = 0, retryAfterMs = 0) {
  return { code: PUBLIC_ERRORS[code] ? code : 'UNAVAILABLE', durationMs, retryAfterMs }
}

/** Run one dependency operation against one request-local elapsed-time budget. */
export function runDependencyOperation({ operation, policy, budget, script, invoke }) {
  const attempts = []
  let value
  let error = null

  for (let attemptNumber = 1; attemptNumber <= policy.maxAttempts; attemptNumber += 1) {
    const remaining = budget.totalMs - budget.elapsedMs
    if (remaining <= 0) {
      error = publicError('DEADLINE_EXCEEDED')
      break
    }

    const startMs = budget.elapsedMs
    const timeoutMs = Math.min(policy.attemptTimeoutMs, remaining)
    const scripted = stageFor(script, operation, attemptNumber)
    let failure = null

    if (scripted && scripted.latencyMs > timeoutMs) {
      failure = safeFailure('TIMEOUT', timeoutMs)
    } else if (scripted?.code) {
      failure = safeFailure(scripted.code, scripted.latencyMs, scripted.retryAfterMs ?? 0)
    } else {
      try {
        value = invoke({ operation, attemptNumber, timeoutMs, scripted })
      } catch (caught) {
        const code = typeof caught?.code === 'string' ? caught.code : 'UNAVAILABLE'
        const durationMs = Number.isFinite(caught?.durationMs)
          ? Math.min(Math.max(0, caught.durationMs), timeoutMs)
          : scripted?.latencyMs ?? 0
        failure = safeFailure(code, durationMs, caught?.retryAfterMs ?? 0)
      }
    }

    const durationMs = failure ? failure.durationMs : scripted?.latencyMs ?? 0
    budget.elapsedMs += durationMs
    const record = {
      operation,
      attemptNumber,
      startMs,
      durationMs,
      timeoutMs,
      errorCode: failure?.code ?? null,
      delayBeforeNextMs: 0,
    }
    attempts.push(record)

    if (!failure) return { value, error: null, budget, attempts }

    const retryableCodes = Array.isArray(policy.retryableCodes) ? policy.retryableCodes : []
    if (!retryableCodes.includes(failure.code) || attemptNumber === policy.maxAttempts) {
      const mapped = failure.code === 'TIMEOUT'
        ? 'DEPENDENCY_TIMEOUT'
        : failure.code === 'UNAVAILABLE'
          ? 'DEPENDENCY_UNAVAILABLE'
          : failure.code
      error = publicError(mapped)
      break
    }

    const proposedDelay = Math.min(policy.baseDelayMs * (2 ** (attemptNumber - 1)), policy.maxDelayMs)
    const delayMs = Math.max(proposedDelay, failure.retryAfterMs)
    const afterAttemptRemaining = budget.totalMs - budget.elapsedMs
    if (delayMs >= afterAttemptRemaining) {
      error = publicError('DEADLINE_EXCEEDED')
      break
    }

    record.delayBeforeNextMs = delayMs
    budget.elapsedMs += delayMs
  }

  return { value: undefined, error: error ?? publicError('DEADLINE_EXCEEDED'), budget, attempts }
}

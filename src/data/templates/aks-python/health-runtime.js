export const HEALTH_RUNTIME_SOURCE = `"""Cached fixture signals supplied by the AKS health simulator."""
_state = {"initialized": True, "accepting_requests": True, "postgres_available": True, "ai_available": True}

def initialized():
    return _state["initialized"]

def accepting_requests():
    return _state["accepting_requests"]

def postgres_available():
    return _state["postgres_available"]

def ai_available():
    return _state["ai_available"]
`

export function createHealthFixtureState(overrides = {}) {
  return { initialized: true, accepting_requests: true, postgres_available: true, ai_available: true, ...overrides }
}

export function evaluateHealthSignal(name, state) {
  return ['initialized', 'accepting_requests', 'postgres_available', 'ai_available'].includes(name) ? Boolean(state?.[name]) : false
}

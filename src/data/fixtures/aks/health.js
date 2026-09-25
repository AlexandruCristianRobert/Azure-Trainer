export const HEALTH_FIXTURES = Object.freeze({
  version: 1,
  initializationSeconds: 24,
  signalNames: Object.freeze(['initialized', 'accepting_requests', 'postgres_available', 'ai_available']),
  scenarios: Object.freeze({
    coldStartup: Object.freeze({ initializationSeconds: 24 }),
    temporaryAdmissionClosure: Object.freeze({ closeAtSeconds: 18, durationSeconds: 10 }),
    processHang: Object.freeze({ startAtSeconds: 40, durationSeconds: 35 }),
    optionalAiOutage: Object.freeze({ startAtSeconds: 35, durationSeconds: 20 }),
    requiredPostgresOutage: Object.freeze({ startAtSeconds: 35, durationSeconds: 20 }),
  }),
})

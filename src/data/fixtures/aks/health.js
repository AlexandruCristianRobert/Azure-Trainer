export const HEALTH_FIXTURES = Object.freeze({
  version: 1,
  initializationSeconds: 24,
  signalNames: Object.freeze(['initialized', 'accepting_requests', 'postgres_available', 'ai_available']),
  scenarios: Object.freeze({
    coldStartup: Object.freeze({ initializationSeconds: 24 }),
    temporaryAdmissionClosure: Object.freeze({ startAfterStartSeconds: 5, endAfterStartSeconds: 20,
      sampleAtSeconds: Object.freeze([9, 25]), finishAfterStartSeconds: 30 }),
    processHang: Object.freeze({ startAfterStartSeconds: 5, endOnContainerTermination: true,
      firstSampleAfterStartSeconds: 9, sampleIntervalSeconds: 5, maxSamples: 20, finishAfterStartSeconds: 100 }),
    optionalAiOutage: Object.freeze({ startAfterStartSeconds: 5, endAfterStartSeconds: 35,
      sampleAtSeconds: Object.freeze([10, 12, 40]), finishAfterStartSeconds: 45 }),
    requiredPostgresOutage: Object.freeze({ startAfterStartSeconds: 5, endAfterStartSeconds: 25,
      sampleAtSeconds: Object.freeze([10, 30]), finishAfterStartSeconds: 35 }),
    optionalAiCoupling: Object.freeze({ startAfterStartSeconds: 5, endAfterStartSeconds: 35,
      sampleAtSeconds: Object.freeze([6]), finishAfterStartSeconds: 45 }),
  }),
})

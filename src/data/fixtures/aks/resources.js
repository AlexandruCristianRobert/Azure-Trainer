export const RESOURCE_FIXTURES = Object.freeze({
  version: 1,
  initializationSeconds: 6,
  baseMemoryMiB: 96,
  nodes: Object.freeze({
    'worker-a': Object.freeze({ allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 }),
    'worker-b': Object.freeze({ allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 }),
  }),
  workload: Object.freeze({ operation: 'process_batch', guided: Object.freeze({ units: 20, scratchMiB: 96, checksum: 3230 }), independent: Object.freeze({ units: 30, scratchMiB: 160, checksum: 7395 }) }),
  profiles: Object.freeze({
    'manual-work': Object.freeze({ kind: 'workload', durationSeconds: 30, phases: [[0, 30, 10]], requiredReadyReplicas: 3, requiresHpa: false }),
    'guided-cycle': Object.freeze({ kind: 'workload', durationSeconds: 270, phases: [[0, 30, 2], [30, 120, 28]], requiredReadyReplicas: 2, requiresHpa: true, baselineReplicas: 2, maxReplicas: 4 }),
    'ai-wait': Object.freeze({ kind: 'ai-wait', durationSeconds: 60, phases: [[0, 60, 28]], requiredReadyReplicas: 2, requiresHpa: true }),
    'independent-cycle': Object.freeze({ kind: 'workload', durationSeconds: 300, phases: [[0, 30, 10], [30, 120, 32]], requiredReadyReplicas: 2, requiresHpa: true, baselineReplicas: 2, maxReplicas: 6 }),
    'test-local-work': Object.freeze({ kind: 'workload', durationSeconds: 30, phases: [[0, 30, 10]], requiredReadyReplicas: 1, requiresHpa: false }),
    'test-ai-wait': Object.freeze({ kind: 'ai-wait', durationSeconds: 60, phases: [[0, 60, 28]], requiredReadyReplicas: 1, requiresHpa: false }),
  }),
})

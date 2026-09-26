export const RESOURCE_FIXTURES = Object.freeze({
  version: 1,
  initializationSeconds: 6,
  baseMemoryMiB: 96,
  nodes: Object.freeze({
    'worker-a': Object.freeze({ allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 }),
    'worker-b': Object.freeze({ allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 }),
  }),
  workload: Object.freeze({ operation: 'process_batch', guided: Object.freeze({ units: 20, scratchMiB: 96, checksum: 3230 }), independent: Object.freeze({ units: 30, scratchMiB: 160, checksum: 7395 }) }),
})

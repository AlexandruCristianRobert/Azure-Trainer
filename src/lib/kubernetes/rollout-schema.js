const defaults = Object.freeze({ type: 'RollingUpdate', rollingUpdate: Object.freeze({ maxSurge: '25%', maxUnavailable: '25%' }), minReadySeconds: 0, progressDeadlineSeconds: 600, revisionHistoryLimit: 10 })

const percentage = value => typeof value === 'string' && /^(?:0|[1-9]\d?|100)%$/.test(value)
const budget = value => Number.isInteger(value) ? value >= 0 && value <= 6 : percentage(value)
const clone = value => structuredClone(value)

export function normalizeRolloutSpec(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { value: null, diagnostics: [{ code: 'INVALID_ROLLOUT_STRATEGY', message: 'Deployment strategy must be an object.' }] }
  const allowed = new Set(['type', 'rollingUpdate', 'minReadySeconds', 'progressDeadlineSeconds', 'revisionHistoryLimit'])
  const unknown = Object.keys(input).find(key => !allowed.has(key))
  if (unknown) return { value: null, diagnostics: [{ code: 'UNSUPPORTED_FIELD', message: `The field '${unknown}' is outside the supported rollout subset.` }] }
  const type = input.type === undefined ? defaults.type : input.type
  if (type !== 'RollingUpdate') return { value: null, diagnostics: [{ code: 'INVALID_ROLLOUT_STRATEGY', message: 'Only RollingUpdate deployments are supported.' }] }
  const rollingInput = input.rollingUpdate === undefined ? {} : input.rollingUpdate; const rollingAllowed = new Set(['maxSurge', 'maxUnavailable'])
  const rollingUnknown = !rollingInput || typeof rollingInput !== 'object' || Array.isArray(rollingInput) ? 'rollingUpdate' : Object.keys(rollingInput).find(key => !rollingAllowed.has(key))
  if (rollingUnknown) return { value: null, diagnostics: [{ code: 'UNSUPPORTED_FIELD', message: `The field '${rollingUnknown}' is outside the supported rollout subset.` }] }
  const rollingUpdate = { maxSurge: rollingInput.maxSurge === undefined ? defaults.rollingUpdate.maxSurge : rollingInput.maxSurge, maxUnavailable: rollingInput.maxUnavailable === undefined ? defaults.rollingUpdate.maxUnavailable : rollingInput.maxUnavailable }
  if (!budget(rollingUpdate.maxSurge) || !budget(rollingUpdate.maxUnavailable)) return { value: null, diagnostics: [{ code: 'INVALID_ROLLOUT_BUDGET', message: 'Rolling update budgets must be 0-6 or 0%-100%.' }] }
  if (['0', '0%'].includes(String(rollingUpdate.maxSurge)) && ['0', '0%'].includes(String(rollingUpdate.maxUnavailable))) return { value: null, diagnostics: [{ code: 'INVALID_ROLLOUT_BUDGET', message: 'maxSurge and maxUnavailable cannot both be zero.' }] }
  const minReadySeconds = input.minReadySeconds === undefined ? defaults.minReadySeconds : input.minReadySeconds
  const progressDeadlineSeconds = input.progressDeadlineSeconds === undefined ? defaults.progressDeadlineSeconds : input.progressDeadlineSeconds
  const revisionHistoryLimit = input.revisionHistoryLimit === undefined ? defaults.revisionHistoryLimit : input.revisionHistoryLimit
  if (!Number.isInteger(minReadySeconds) || minReadySeconds < 0 || minReadySeconds > 60 || !Number.isInteger(progressDeadlineSeconds) || progressDeadlineSeconds < 1 || progressDeadlineSeconds > 600 || progressDeadlineSeconds <= minReadySeconds || !Number.isInteger(revisionHistoryLimit) || revisionHistoryLimit < 0 || revisionHistoryLimit > 10) return { value: null, diagnostics: [{ code: 'INVALID_ROLLOUT_STRATEGY', message: 'Rollout timing and history values are outside the supported bounds.' }] }
  return { value: { type, rollingUpdate, minReadySeconds, progressDeadlineSeconds, revisionHistoryLimit }, diagnostics: [] }
}

export function resolveRolloutBudget(spec, replicas) {
  const resolve = (value, round) => typeof value === 'string' ? round(replicas * Number(value.slice(0, -1)) / 100) : value
  const surge = resolve(spec.maxSurge, Math.ceil)
  let unavailable = Math.min(replicas, resolve(spec.maxUnavailable, Math.floor))
  if (surge === 0 && unavailable === 0) unavailable = 1
  return { surge, unavailable }
}

export const rolloutDefaults = () => clone(defaults)

const CHAIN_START = '0000000000000000'
export const emptyBicepProvenance = ({ trackIncident = false } = {}) => ({ nextAttempt: 1, nextPreview: 1, nextObservation: 1,
  attempts: [], previews: [], observations: [], currentByTarget: {}, retired: {},
  ...(trackIncident ? { previewChain: { anchor: CHAIN_START, head: CHAIN_START,
    incident: null, prunedIncident: null } } : {}) })
export const bicepTargetKey = (group, name) => `${String(group).toLowerCase()}/${String(name).toLowerCase()}`
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = value => typeof value === 'string' && value.length > 0 && value.length <= 512
const versions = value => plain(value) && Object.keys(value).length <= 12
  && Object.entries(value).every(([key, version]) => str(key) && Number.isInteger(version) && version >= 0)
const diagnostic = value => plain(value) && str(value.code) && str(value.message)
  && (value.path === undefined || str(value.path))
const operation = value => plain(value) && str(value.id) && str(value.type) && str(value.name)
  && value.id.toLowerCase().endsWith(`/${value.name.toLowerCase()}`)
  && ['create', 'modify', 'no-change', 'ignored-existing'].includes(value.changeType)
const target = value => plain(value) && str(value.key) && str(value.target) && str(value.name)
  && value.key === bicepTargetKey(value.target, value.name) && str(value.sourceHash)
  && str(value.parameterHash) && versions(value.fileVersions)
  && (value.parameterPath === undefined || typeof value.parameterPath === 'string'
    && /^infra\/[A-Za-z0-9_-]+\.bicepparam$/.test(value.parameterPath)
    && value.fileVersions[value.parameterPath] !== undefined)
  && (value.templatePath === undefined || typeof value.templatePath === 'string'
    && /^infra\/[A-Za-z0-9_-]+\.bicep$/.test(value.templatePath)
    && value.fileVersions[value.templatePath] !== undefined)
  && (value.sequence === undefined || Number.isSafeInteger(value.sequence) && value.sequence > 0)
const attemptNumber = id => /^bicep-attempt-([1-9]\d*)$/.exec(id)?.[1]
const previewNumber = id => /^bicep-preview-([1-9]\d*)$/.exec(id)?.[1]
const summary = value => target(value) && str(value.id) && !!attemptNumber(value.id)
  && ['succeeded', 'failed'].includes(value.status) && plain(value.outputs)
  && Array.isArray(value.operations) && value.operations.length <= 32 && value.operations.every(operation)
  && Array.isArray(value.diagnostics) && value.diagnostics.length <= 8 && value.diagnostics.every(diagnostic)
const attempt = summary
const preview = value => target(value) && str(value.id) && !!previewNumber(value.id) && Array.isArray(value.operations)
  && value.operations.length <= 32 && value.operations.every(operation)
const observation = value => target(value) && /^bicep-observation-[1-9]\d*$/.test(value.id)
  && ['validate', 'show', 'app-show'].includes(value.kind)
  && (value.kind === 'validate' ? value.attemptId === undefined : !!attemptNumber(value.attemptId))
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const fingerprint = value => {
  const text = JSON.stringify(canonical(value))
  let first = 0x811c9dc5; let second = 0x9e3779b9
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 0x01000193) >>> 0
    second = Math.imul(second ^ first, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}
const chainStep = (head, record, incident) => fingerprint({ head, record, incident })
const summaryOf = record => ({ id: record.id, key: record.key, target: record.target, name: record.name,
  status: record.status, sourceHash: record.sourceHash, parameterHash: record.parameterHash,
  fileVersions: record.fileVersions, ...(record.parameterPath ? { parameterPath: record.parameterPath, sequence: record.sequence } : {}),
  ...(record.templatePath ? { templatePath: record.templatePath } : {}),
  operations: record.operations, outputs: record.outputs, diagnostics: record.diagnostics })
const retiredFor = (currentByTarget, attempts, previews) => {
  const activeAttempts = new Set(attempts.map(item => item.id))
  const activePreviews = new Set(previews.map(item => item.id))
  const retired = {}
  for (const [key, current] of Object.entries(currentByTarget)) {
    const ids = {}
    for (const name of ['latest', 'successful', 'failed'])
      if (current[name] && !activeAttempts.has(current[name].id))
        ids[name] = { id: current[name].id, fingerprint: fingerprint(current[name]) }
    if (current.preview && !activePreviews.has(current.preview.id))
      ids.preview = { id: current.preview.id, fingerprint: fingerprint(current.preview) }
    if (Object.keys(ids).length) retired[key] = ids
  }
  return retired
}

export function validBicepProvenance(state) {
  const hasObservations = state?.observations !== undefined || state?.nextObservation !== undefined
  if (hasObservations && (!Number.isSafeInteger(state.nextObservation) || state.nextObservation < 1
    || !Array.isArray(state.observations) || state.observations.length > 20 || !state.observations.every(observation)
    || state.observations.some((item, index) => Number(item.id.slice('bicep-observation-'.length)) !== state.nextObservation - state.observations.length + index)
    || (state.observations.length === 0 && state.nextObservation !== 1))) return false
  if (!plain(state) || !Number.isSafeInteger(state.nextAttempt) || state.nextAttempt < 1
    || !Number.isSafeInteger(state.nextPreview) || state.nextPreview < 1
    || !Array.isArray(state.attempts) || state.attempts.length > 20 || !state.attempts.every(attempt)
    || !Array.isArray(state.previews) || state.previews.length > 10 || !state.previews.every(preview)
    || !plain(state.currentByTarget) || Object.keys(state.currentByTarget).length > 8
    || !plain(state.retired) || !equal(state.retired, retiredFor(state.currentByTarget, state.attempts, state.previews))
    || JSON.stringify(state).length > 400_000) return false
  const chain = state.previewChain
  if (chain !== undefined) {
    const hex = value => typeof value === 'string' && /^[0-9a-f]{16}$/.test(value)
    if (!plain(chain) || !hex(chain.anchor) || !hex(chain.head)
      || (chain.incident !== null && (!plain(chain.incident) || !str(chain.incident.id)
        || !hex(chain.incident.fingerprint) || !hex(chain.incident.head)))
      || (chain.prunedIncident !== null && !hex(chain.prunedIncident))
      || (state.incidentPreview === undefined) !== (chain.incident === null)) return false
    const incidentPruned = chain.incident !== null
      && Number(previewNumber(chain.incident.id)) < Number(previewNumber(state.previews[0]?.id) ?? state.nextPreview)
    if (incidentPruned ? chain.prunedIncident !== chain.anchor : chain.prunedIncident !== null) return false
    let head = chain.anchor
    for (const item of state.previews) {
      head = chainStep(head, item, item.id === chain.incident?.id)
      if (item.id === chain.incident?.id && head !== chain.incident.head) return false
    }
    if (head !== chain.head) return false
  } else if (state.incidentPreview !== undefined) return false
  if (state.incidentPreview !== undefined) {
    const incident = state.incidentPreview
    if (!preview(incident) || Number(previewNumber(incident.id)) >= state.nextPreview) return false
    if (chain.incident.id !== incident.id || chain.incident.fingerprint !== fingerprint(incident)) return false
    const retained = state.previews.find(item => item.id === incident.id)
    if (retained ? !equal(retained, incident)
      : Number(previewNumber(incident.id)) >= Number(previewNumber(state.previews[0]?.id) ?? state.nextPreview)) return false
  }
  const ids = state.attempts.map(item => Number(attemptNumber(item.id)))
  const previewIds = state.previews.map(item => Number(previewNumber(item.id)))
  if (ids.some((id, index) => id !== state.nextAttempt - ids.length + index)
    || previewIds.some((id, index) => id !== state.nextPreview - previewIds.length + index)
    || (state.attempts.length === 0 && state.nextAttempt !== 1)
    || (state.previews.length === 0 && state.nextPreview !== 1)) return false
  const oldestAttempt = ids[0] ?? state.nextAttempt
  const oldestPreview = previewIds[0] ?? state.nextPreview
  const matchesAttempt = (value, name, key) => {
    const number = Number(attemptNumber(value.id))
    const retained = state.attempts.find(item => item.id === value.id)
    return retained ? equal(value, summaryOf(retained))
      : number < oldestAttempt && state.retired[key]?.[name]?.id === value.id
        && state.retired[key][name].fingerprint === fingerprint(value)
  }
  const matchesPreview = (value, key) => {
    const number = Number(previewNumber(value.id))
    const retained = state.previews.find(item => item.id === value.id)
    return retained ? equal(value, retained)
      : number < oldestPreview && state.retired[key]?.preview?.id === value.id
        && state.retired[key].preview.fingerprint === fingerprint(value)
  }
  return Object.entries(state.currentByTarget).every(([key, current]) => plain(current)
    && Object.keys(current).every(name => ['latest', 'successful', 'failed', 'preview'].includes(name))
    && (state.attempts.every(item => item.key !== key) || current.latest !== undefined)
    && (current.latest === undefined
      ? current.successful === undefined && current.failed === undefined && current.preview !== undefined
      : current.successful !== undefined || current.failed !== undefined)
    && ['latest', 'successful', 'failed'].every(name => current[name] === undefined
      || summary(current[name]) && current[name].key === key && Number(attemptNumber(current[name].id)) < state.nextAttempt
      && matchesAttempt(current[name], name, key)
      && (name === 'successful' ? current[name].status === 'succeeded' : name === 'failed' ? current[name].status === 'failed' : true))
    && (current.latest === undefined || equal(current.latest,
      Number(attemptNumber(current.successful?.id) ?? 0) > Number(attemptNumber(current.failed?.id) ?? 0)
        ? current.successful : current.failed))
    && ['succeeded', 'failed'].every(status => {
      const retained = state.attempts.filter(item => item.key === key && item.status === status).at(-1)
      const selected = status === 'succeeded' ? current.successful : current.failed
      return retained ? selected?.id === retained.id : selected === undefined
        || Number(attemptNumber(selected.id)) < oldestAttempt
    })
    && (current.preview === undefined || preview(current.preview) && current.preview.key === key
      && Number(previewNumber(current.preview.id)) < state.nextPreview && matchesPreview(current.preview, key)
      && (state.previews.filter(item => item.key === key).at(-1)?.id ?? current.preview.id) === current.preview.id))
}

export function appendBicepObservation(state, record) {
  const nextObservation = state.nextObservation ?? 1
  return { ...state, nextObservation: nextObservation + 1,
    observations: [...(state.observations ?? []), { id: `bicep-observation-${nextObservation}`, ...record }].slice(-20) }
}

export function appendBicepAttempt(state, record) {
  const attempts = [...state.attempts, record].slice(-20)
  const summary = summaryOf(record)
  const currentByTarget = { ...state.currentByTarget, [record.key]: {
    ...state.currentByTarget[record.key], latest: summary,
    ...(record.status === 'succeeded' ? { successful: summary } : { failed: summary }) } }
  const keys = Object.keys(currentByTarget)
  if (keys.length > 8) delete currentByTarget[keys.find(key => key !== record.key)]
  return { ...state, nextAttempt: state.nextAttempt + 1, attempts, currentByTarget,
    retired: retiredFor(currentByTarget, attempts, state.previews) }
}

export function appendBicepPreview(state, preview, { captureIncident = false } = {}) {
  const recorded = { ...preview, id: `bicep-preview-${state.nextPreview}` }
  const previews = [...state.previews, recorded].slice(-10)
  const currentByTarget = { ...state.currentByTarget, [recorded.key]: { ...state.currentByTarget[recorded.key], preview: recorded } }
  const keys = Object.keys(currentByTarget)
  if (keys.length > 8) delete currentByTarget[keys.find(key => key !== recorded.key)]
  const capture = captureIncident && state.previewChain && !state.previewChain.incident
  let previewChain = state.previewChain
  if (previewChain) {
    const removed = state.previews.length >= 10 ? state.previews[0] : null
    const anchor = removed ? chainStep(previewChain.anchor, removed, removed.id === previewChain.incident?.id) : previewChain.anchor
    const head = chainStep(previewChain.head, recorded, !!capture)
    const prunedIncident = removed && previewChain.incident && removed.id === previewChain.incident.id ? anchor
      : previewChain.prunedIncident && removed
        ? chainStep(previewChain.prunedIncident, removed, false) : previewChain.prunedIncident
    previewChain = { anchor, head, prunedIncident, incident: capture
      ? { id: recorded.id, fingerprint: fingerprint(recorded), head } : previewChain.incident }
  }
  return { ...state, nextPreview: state.nextPreview + 1, previews, currentByTarget,
    retired: retiredFor(currentByTarget, state.attempts, previews),
    ...(previewChain ? { previewChain } : {}),
    ...(capture ? { incidentPreview: structuredClone(recorded) } : {}) }
}

export function latestBicepAttempt(state, group, name) {
  return state.currentByTarget[bicepTargetKey(group, name)]?.latest ?? null
}

export function successfulBicepDependency(state, declaredTarget) {
  const record = state?.currentByTarget?.[bicepTargetKey(declaredTarget.resourceGroup, declaredTarget.deploymentName)]?.successful
  if (!record || record.target.toLowerCase() !== declaredTarget.resourceGroup.toLowerCase()
    || record.name.toLowerCase() !== declaredTarget.deploymentName.toLowerCase()
    || record.parameterPath !== declaredTarget.parameterPath || record.templatePath !== declaredTarget.templatePath) return null
  return { attemptId: record.id, target: record.target, name: record.name,
    templatePath: record.templatePath, parameterPath: record.parameterPath,
    sourceHash: record.sourceHash, parameterHash: record.parameterHash,
    fileVersions: structuredClone(record.fileVersions), outputs: structuredClone(record.outputs) }
}

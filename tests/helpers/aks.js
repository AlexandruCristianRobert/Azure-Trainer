import { applyRunAction } from '../../src/lib/labEngine/actions.js'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../../src/data/templates/aks-python/foundation.js'

export function makeAksLab(overrides = {}) {
  return {
    id: 'aks-test', engineVersion: 2, contentVersion: 1,
    manifestId: FOUNDATION_MANIFEST.id,
    capabilities: { acrBuild: true, kubernetes: true },
    initialProjectFiles: { ...FOUNDATION_FILES },
    tasks: [{ id: 'pending', check: () => false }],
    ...overrides,
  }
}

export function act(run, lab, action) {
  const result = applyRunAction(run, action, lab)
  const errors = (result.lines ?? []).filter(line => /^\s*(ERROR|Error:)/.test(String(line)))
  if (result.diagnostics?.length || errors.length) throw new Error([...result.diagnostics.map(item => item.message), ...errors].join('\n'))
  return result
}

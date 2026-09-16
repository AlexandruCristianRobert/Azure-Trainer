export const SUBSCRIPTION_ID = '7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37'
export const SUBSCRIPTION_NAME = 'Sandbox'
export const TENANT_ID = '3c1f5a8e-9d2b-4f6a-8e7c-1b2d3e4f5a6b'
export const USER_NAME = 'sam.learner@sandbox.onmicrosoft.com'

export function createSandbox() {
  return { resourceGroups: [], namespaces: [], defaults: { group: null, location: null } }
}

export function isSandboxShape(sb) {
  return !!sb && typeof sb === 'object' && Array.isArray(sb.resourceGroups) && Array.isArray(sb.namespaces) && !!sb.defaults && typeof sb.defaults === 'object'
}

export function cloneSandbox(sb) {
  return JSON.parse(JSON.stringify(sb))
}

export function nowIso() {
  return new Date().toISOString()
}

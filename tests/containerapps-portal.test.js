import { describe, expect, it } from 'vitest'
import { resolveBlade } from '../src/lib/bladeResolve.js'
import { bladeForEvent, notificationForEvent } from '../src/stores/portal.js'

const LIST = { kind: 'resource-groups' }
const GROUP = { kind: 'resource-group', name: 'rg-containerapps' }
const ENVIRONMENT = { kind: 'containerapp-environment', resourceGroup: 'rg-containerapps', name: 'env-contoso' }
const APP = { kind: 'containerapp', resourceGroup: 'rg-apps', name: 'ca-contoso-api' }

const sandbox = {
  resourceGroups: [
    { name: 'RG-ContainerApps', location: 'westeurope', tags: null, createdAt: '2026-09-21T10:00:00.000Z' },
    { name: 'rg-apps', location: 'westeurope', tags: null, createdAt: '2026-09-21T10:00:00.000Z' },
  ],
  namespaces: [],
  containerAppEnvironments: [
    { name: 'ENV-Contoso', resourceGroup: 'RG-ContainerApps', location: 'westeurope', tags: null, createdAt: '2026-09-21T10:01:00.000Z' },
  ],
  containerApps: [
    {
      name: 'CA-Contoso-Api', resourceGroup: 'rg-apps', location: 'westeurope',
      environment: 'ENV-Contoso', environmentResourceGroup: 'RG-ContainerApps',
      image: 'mcr.microsoft.com/k8se/quickstart:latest', ingress: 'external', targetPort: 80,
      minReplicas: 0, maxReplicas: 5,
      scaleRules: [{ name: 'http-requests', http: { metadata: { concurrentRequests: '50' } } }],
      tags: null, createdAt: '2026-09-21T10:02:00.000Z',
    },
  ],
  defaults: { group: null, location: null },
}

describe('Container Apps event navigation', () => {
  it('focuses the environment and app Blades for create and update events', () => {
    expect(bladeForEvent({ type: 'created', resourceType: 'containerAppEnvironment', resourceGroup: 'rg-containerapps', name: 'env-contoso' }, LIST)).toEqual(ENVIRONMENT)
    expect(bladeForEvent({ type: 'updated', resourceType: 'containerApp', resourceGroup: 'rg-apps', name: 'ca-contoso-api' }, LIST)).toEqual(APP)
  })

  it('falls back to the resource group when the focused resource is deleted, ignoring case', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'containerAppEnvironment', resourceGroup: 'RG-CONTAINERAPPS', name: 'ENV-CONTOSO' }, ENVIRONMENT)).toEqual(GROUP)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'containerApp', resourceGroup: 'RG-APPS', name: 'CA-CONTOSO-API' }, APP)).toEqual({ kind: 'resource-group', name: 'rg-apps' })
  })

  it('does not treat an unknown created resource as a Service Bus entity', () => {
    const current = { kind: 'resource-group', name: 'rg-containerapps' }
    expect(bladeForEvent({ type: 'created', resourceType: 'futureResource', resourceGroup: 'rg-containerapps', name: 'future-one' }, current)).toEqual(current)
  })

  it('phrases environment and app notifications', () => {
    expect(notificationForEvent({ type: 'created', resourceType: 'containerAppEnvironment', name: 'env-contoso' })).toEqual({ title: 'Deployment succeeded', text: "Created Container Apps environment 'env-contoso'." })
    expect(notificationForEvent({ type: 'updated', resourceType: 'containerApp', name: 'ca-contoso-api' })).toEqual({ title: 'Update succeeded', text: "Updated Container App 'ca-contoso-api'." })
  })
})

describe('Container Apps Blade resolution', () => {
  it('resolves environment and app names case insensitively', () => {
    expect(resolveBlade(ENVIRONMENT, sandbox)).toEqual(ENVIRONMENT)
    expect(resolveBlade(APP, sandbox)).toEqual(APP)
  })

  it('falls back through the resource group when a resource no longer exists', () => {
    expect(resolveBlade({ ...ENVIRONMENT, name: 'missing-env' }, sandbox)).toEqual(GROUP)
    expect(resolveBlade({ ...APP, name: 'missing-app' }, sandbox)).toEqual({ kind: 'resource-group', name: 'rg-apps' })
    expect(resolveBlade(APP, { ...sandbox, resourceGroups: sandbox.resourceGroups.slice(0, 1), containerApps: [] })).toEqual(LIST)
  })

  it('handles legacy saves without Container Apps arrays', () => {
    const legacy = { resourceGroups: sandbox.resourceGroups, namespaces: [], defaults: sandbox.defaults }
    expect(resolveBlade(APP, legacy)).toEqual({ kind: 'resource-group', name: 'rg-apps' })
    expect(resolveBlade(ENVIRONMENT, legacy)).toEqual(GROUP)
  })
})

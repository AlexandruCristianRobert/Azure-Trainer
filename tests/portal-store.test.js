import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePortalStore, bladeForEvent, notificationForEvent } from '../src/stores/portal.js'

const LIST = { kind: 'resource-groups' }
const NS = { kind: 'servicebus-namespace', resourceGroup: 'rg-orders', name: 'sb-contoso-orders', tab: 'queues' }

describe('bladeForEvent', () => {
  it('follows creations', () => {
    expect(bladeForEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }, LIST)).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(bladeForEvent({ type: 'created', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }, LIST)).toEqual(NS)
    expect(bladeForEvent({ type: 'created', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, LIST)).toEqual(NS)
    expect(bladeForEvent({ type: 'created', resourceType: 'topic', name: 't', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, LIST)).toEqual({ ...NS, tab: 'topics' })
    expect(bladeForEvent({ type: 'created', resourceType: 'rule', name: 'r', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders', topic: 't', subscription: 's' }, LIST)).toEqual({ ...NS, tab: 'topics' })
  })
  it('falls back to the parent on deletion of the focused resource', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'namespace', name: 'sb-contoso-orders', resourceGroup: 'rg-orders' }, NS)).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(bladeForEvent({ type: 'deleted', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' }, NS)).toEqual(LIST)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'queue', name: 'orders', resourceGroup: 'rg-orders', namespace: 'sb-contoso-orders' }, NS)).toEqual(NS)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'namespace', name: 'other', resourceGroup: 'rg-orders' }, NS)).toEqual(NS)
  })
})

describe('notificationForEvent', () => {
  it('phrases events', () => {
    expect(notificationForEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders' })).toEqual({ title: 'Deployment succeeded', text: "Created resource group 'rg-orders'." })
    expect(notificationForEvent({ type: 'created', resourceType: 'queue', name: 'orders', namespace: 'sb-contoso-orders' })).toEqual({ title: 'Deployment succeeded', text: "Created queue 'orders' in sb-contoso-orders." })
    expect(notificationForEvent({ type: 'updated', resourceType: 'namespace', name: 'sb-contoso-orders' })).toEqual({ title: 'Update succeeded', text: "Updated Service Bus namespace 'sb-contoso-orders'." })
    expect(notificationForEvent({ type: 'deleted', resourceType: 'rule', name: '$Default', subscription: 'eu-orders' })).toEqual({ title: 'Deleted', text: "Deleted rule '$Default' on eu-orders." })
  })
})

describe('portal store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('notifications and unread count', () => {
    const p = usePortalStore()
    p.notify('Deployment succeeded', "Created resource group 'rg-orders'.")
    expect(p.notifications).toHaveLength(1)
    expect(p.unread).toBe(1)
    p.toggleNotifications()
    expect(p.notificationsOpen).toBe(true)
    expect(p.unread).toBe(0)
  })
  it('shell state machine', () => {
    const p = usePortalStore()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: false })
    p.toggleShellMinimized()
    expect(p.shell.minimized).toBe(true)
    p.toggleShellMaximized()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: true })
    p.closeShell()
    expect(p.shell.visible).toBe(false)
    p.toggleShell()
    expect(p.shell).toEqual({ visible: true, minimized: false, maximized: false })
  })
  it('applyEvent updates blade and notifies; resetForLab restores defaults', () => {
    const p = usePortalStore()
    p.applyEvent({ type: 'created', resourceType: 'resourceGroup', name: 'rg-orders', resourceGroup: 'rg-orders' })
    expect(p.blade).toEqual({ kind: 'resource-group', name: 'rg-orders' })
    expect(p.notifications).toHaveLength(1)
    p.showToast('Lab completed', 'x')
    p.resetForLab()
    expect(p.blade).toEqual({ kind: 'resource-groups' })
    expect(p.toast).toBeNull()
  })
})

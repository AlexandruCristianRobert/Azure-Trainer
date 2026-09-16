import { describe, expect, it } from 'vitest'
import { renderCommandHelp, renderGroupHelp } from '../src/lib/az/help.js'

const cmd = {
  type: 'command',
  path: ['servicebus', 'queue', 'create'],
  summary: 'Create the ServiceBus Queue.',
  args: [
    { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name of Queue.' },
    { name: '--namespace-name', aliases: [], required: true, kind: 'string', dest: 'namespace', help: 'Name of Namespace.' },
    { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Number of maximum deliveries.', defaultValue: 10 },
    { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'Sessions.' },
  ],
  examples: [{ summary: 'Create a queue with DLQ on expiry.', command: 'az servicebus queue create -g rg -n q --namespace-name ns --enable-dead-lettering-on-message-expiration true' }],
}
const group = {
  type: 'group',
  path: ['servicebus', 'queue'],
  summary: 'Manage Azure Service Bus Queue and Authorization Rule.',
  children: { create: cmd, delete: { type: 'command', path: ['servicebus', 'queue', 'delete'], summary: 'Delete the Queue.', args: [] }, authorization: { type: 'group', path: ['servicebus', 'queue', 'authorization'], summary: 'Manage rules.', children: {} } },
}

describe('help', () => {
  it('renders a command with Arguments and Examples', () => {
    const text = renderCommandHelp(cmd)
    expect(text).toContain('Command\n    az servicebus queue create : Create the ServiceBus Queue.')
    expect(text).toContain('Arguments')
    expect(text).toContain('--name -n           [Required] : Name of Queue.')
    expect(text).toContain('--max-delivery-count           : Number of maximum deliveries.  Default: 10.')
    expect(text).toContain("--enable-session               : Sessions.  Allowed values: false, true.")
    expect(text).toContain('Global Arguments')
    expect(text).toContain('Examples\n    Create a queue with DLQ on expiry.')
    expect(text).toContain('To search AI knowledge base for examples, use: az find "az servicebus queue create"')
  })
  it('renders a group with Subgroups and Commands', () => {
    const text = renderGroupHelp(group)
    expect(text).toContain('Group\n    az servicebus queue : Manage Azure Service Bus Queue and Authorization Rule.')
    expect(text).toContain('Subgroups:\n    authorization : Manage rules.')
    expect(text).toContain('Commands:\n    create        : Create the ServiceBus Queue.\n    delete        : Delete the Queue.')
  })
})

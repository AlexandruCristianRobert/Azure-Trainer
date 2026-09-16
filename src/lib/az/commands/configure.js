import { defineCommand, LATENCY } from '../tree.js'
import { setDefaults } from '../../sandbox/ops.js'
import { AzError } from '../../sandbox/errors.js'

export const configureCommand = defineCommand(['configure'], 'Manage Azure CLI configuration. This command is interactive.', {
  latencyMs: LATENCY.read,
  args: [
    { name: '--defaults', aliases: ['-d'], required: false, kind: 'list', dest: 'defaults', help: "Space-separated 'name=value' pairs for common argument defaults." },
    { name: '--list-defaults', aliases: ['-l'], required: false, kind: 'flag', dest: 'listDefaults', help: 'List all applicable defaults.' },
    { name: '--scope', aliases: [], required: false, kind: 'string', choices: ['global', 'local'], dest: 'scope', help: 'Scope of defaults. Using "local" for settings only effective under current folder.' },
  ],
  run: ({ sandbox }, values) => {
    if (values.listDefaults) {
      const output = Object.entries(sandbox.defaults).filter(([, v]) => v).map(([name, value]) => ({ name, source: 'sandbox', value }))
      return { sandbox, output }
    }
    if (values.defaults) {
      const allowed = ['group', 'location']
      const bad = Object.keys(values.defaults).find((k) => !allowed.includes(k))
      if (bad) throw new AzError('InvalidArgumentValue', `Unsupported default '${bad}' in the Sandbox. Supported: ${allowed.join(', ')}.`, { kind: 'cli' })
      return { sandbox: setDefaults(sandbox, values.defaults).sandbox, output: null }
    }
    throw new AzError('Interactive', 'Interactive configuration is not available in the Sandbox Cloud Shell (no interactive TTY). Use `az configure --defaults group=<name> location=<location>` or `az configure --list-defaults`.', { kind: 'cli' })
  },
})

export function defineGroup(path, summary, children) {
  return { type: 'group', path, summary, children }
}

export function defineCommand(path, summary, { args = [], run, latencyMs = 250, examples = [] }) {
  return { type: 'command', path, summary, args, run, latencyMs, examples }
}

export const LATENCY = { read: 250, mutate: 900, group: 800, namespace: 2500 }

export const ARG = {
  resourceGroup: { name: '--resource-group', aliases: ['-g'], required: true, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Name of resource group. You can configure the default group using `az configure --defaults group=<name>`.' },
  resourceGroupOptional: { name: '--resource-group', aliases: ['-g'], required: false, kind: 'string', dest: 'resourceGroup', defaultsKey: 'group', help: 'Name of resource group. You can configure the default group using `az configure --defaults group=<name>`.' },
  name: (help) => ({ name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help }),
  namespace: { name: '--namespace-name', aliases: [], required: true, kind: 'string', dest: 'namespace', help: 'Name of Namespace.' },
  topic: { name: '--topic-name', aliases: [], required: true, kind: 'string', dest: 'topic', help: 'Name of Topic.' },
  subscription: { name: '--subscription-name', aliases: [], required: true, kind: 'string', dest: 'subscription', help: 'Name of Subscription.' },
  location: (required) => ({ name: '--location', aliases: ['-l'], required, kind: 'string', dest: 'location', defaultsKey: 'location', help: 'Location. Values from: `az account list-locations`. You can configure the default location using `az configure --defaults location=<location>`.' }),
  tags: { name: '--tags', aliases: [], required: false, kind: 'list', dest: 'tags', help: 'Space-separated tags: key[=value] [key[=value] ...]. Use "" to clear existing tags.' },
  yes: { name: '--yes', aliases: ['-y'], required: false, kind: 'flag', dest: 'yes', help: 'Do not prompt for confirmation.' },
  noWait: { name: '--no-wait', aliases: [], required: false, kind: 'flag', dest: 'noWait', help: 'Do not wait for the long-running operation to finish.' },
}

export function event(type, resourceType, fields) {
  return { type, resourceType, ...fields }
}

import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as apps from '../../sandbox/containerapps.js'
import { AzError } from '../../sandbox/errors.js'
import { presentContainerApp, presentContainerAppEnvironment } from '../containerapps-arm.js'
import { parseProbeConfiguration } from '../../project/probes.js'

const ENVIRONMENT_NAME = ARG.name('Name of the Container Apps environment.')
const APP_NAME = ARG.name('Name of the Container App.')
const ENVIRONMENT = { name: '--environment', aliases: [], required: true, kind: 'string', dest: 'environment', help: 'Name or resource ID of the Container Apps environment.' }
const IMAGE = { name: '--image', aliases: [], required: true, kind: 'string', dest: 'image', help: 'Container image to deploy.' }
const IMAGE_UPDATE = { ...IMAGE, required: false }
const YAML = { name: '--yaml', aliases: [], required: false, kind: 'string', dest: 'yaml', help: 'Saved local JSON-form YAML file (health-probe Labs only).' }
const INGRESS = { name: '--ingress', aliases: [], required: false, kind: 'string', choices: ['external', 'internal'], dest: 'ingress', help: 'Ingress visibility.' }
const TARGET_PORT = { name: '--target-port', aliases: [], required: false, kind: 'int', dest: 'targetPort', help: 'Ingress target port.' }
const USER_ASSIGNED = { name: '--user-assigned', aliases: [], required: false, kind: 'string', dest: 'userAssigned', help: 'Existing managed identity ARM ID attached to the app.' }
const REGISTRY_IDENTITY = { name: '--registry-identity', aliases: [], required: false, kind: 'string', dest: 'registryIdentity', help: 'Attached identity ARM ID used for simulated ACR pulls.' }
const REGISTRY_SERVER = { name: '--registry-server', aliases: [], required: false, kind: 'string', dest: 'registryServer', help: 'Simulated ACR login server.' }
const ENV_VARS = { name: '--env-vars', aliases: [], required: false, kind: 'pairs', dest: 'envVars', help: 'Container environment variables as KEY=value.' }
const SET_ENV_VARS = { ...ENV_VARS, name: '--set-env-vars', dest: 'envVars', help: 'Set container environment variables as KEY=value.' }
const INGRESS_TYPE = { name: '--type', aliases: [], required: false, kind: 'string', choices: ['external', 'internal'], dest: 'ingress', help: 'Ingress visibility.' }
const MIN_REPLICAS = { name: '--min-replicas', aliases: [], required: false, kind: 'int', dest: 'minReplicas', help: 'Minimum replica count.' }
const MAX_REPLICAS = { name: '--max-replicas', aliases: [], required: false, kind: 'int', dest: 'maxReplicas', help: 'Maximum replica count.' }
const CPU = { name: '--cpu', aliases: [], required: false, kind: 'string', dest: 'cpu', help: 'CPU cores per replica in the CPU simulation.' }
const MEMORY = { name: '--memory', aliases: [], required: false, kind: 'string', dest: 'memory', help: 'Memory per replica in the CPU simulation.' }
const SCALE_RULE_NAME = { name: '--scale-rule-name', aliases: [], required: false, kind: 'string', dest: 'scaleRuleName', help: 'Name of a scale rule.' }
const SCALE_RULE_TYPE = { name: '--scale-rule-type', aliases: [], required: false, kind: 'string', dest: 'scaleRuleType', help: 'Scale rule type: http, or cpu in a CPU Lab.', defaultValue: 'http' }
const SCALE_RULE_HTTP_CONCURRENCY = { name: '--scale-rule-http-concurrency', aliases: [], required: false, kind: 'int', dest: 'scaleRuleHttpConcurrency', help: 'Concurrent HTTP requests per replica.', defaultValue: 10 }
const SCALE_RULE_METADATA = { name: '--scale-rule-metadata', aliases: [], required: false, kind: 'pairs', dest: 'scaleRuleMetadata', help: 'CPU rule metadata: type=Utilization value=60.' }
const SCALE_ARGS = [SCALE_RULE_NAME, SCALE_RULE_TYPE, SCALE_RULE_HTTP_CONCURRENCY, SCALE_RULE_METADATA]
const APP_UPDATE_ARGS = [IMAGE_UPDATE, YAML, SET_ENV_VARS, MIN_REPLICAS, MAX_REPLICAS, CPU, MEMORY, ARG.tags, ...SCALE_ARGS]
const appEvent = (type, app) => event(type, 'containerApp', { name: app.name, resourceGroup: app.resourceGroup })
const environmentEvent = (type, environment) => event(type, 'containerAppEnvironment', { name: environment.name, resourceGroup: environment.resourceGroup })

function requireYes(values) {
  if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
}

export const environmentGroup = defineGroup(['containerapp', 'env'], 'Manage Container Apps environments.', {
  create: defineCommand(['containerapp', 'env', 'create'], 'Create a Container Apps environment.', {
    latencyMs: LATENCY.mutate,
    args: [ENVIRONMENT_NAME, ARG.resourceGroup, ARG.location(false), ARG.tags],
    run: ({ sandbox }, values) => {
      const existed = (() => { try { return !!apps.getContainerAppEnvironment(sandbox, values.resourceGroup, values.name) } catch { return false } })()
      const { sandbox: next, resource } = apps.createContainerAppEnvironment(sandbox, values)
      return { sandbox: next, output: presentContainerAppEnvironment(resource), events: [environmentEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['containerapp', 'env', 'show'], 'Show a Container Apps environment.', {
    args: [ENVIRONMENT_NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentContainerAppEnvironment(apps.getContainerAppEnvironment(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['containerapp', 'env', 'list'], 'List Container Apps environments.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: apps.listContainerAppEnvironments(sandbox, values.resourceGroup ?? null).map(presentContainerAppEnvironment) }),
  }),
  delete: defineCommand(['containerapp', 'env', 'delete'], 'Delete a Container Apps environment.', {
    latencyMs: LATENCY.mutate,
    args: [ENVIRONMENT_NAME, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const environment = apps.getContainerAppEnvironment(sandbox, values.resourceGroup, values.name)
      const { sandbox: next } = apps.deleteContainerAppEnvironment(sandbox, values)
      return { sandbox: next, output: null, events: [environmentEvent('deleted', environment)] }
    },
  }),
})

export const containerappGroup = defineGroup(['containerapp'], 'Manage Azure Container Apps.', {
  create: defineCommand(['containerapp', 'create'], 'Create a Container App.', {
    latencyMs: LATENCY.mutate,
    args: [APP_NAME, ARG.resourceGroup, ENVIRONMENT, IMAGE, INGRESS, TARGET_PORT, USER_ASSIGNED, REGISTRY_IDENTITY, REGISTRY_SERVER, ENV_VARS, MIN_REPLICAS, MAX_REPLICAS, CPU, MEMORY, ARG.tags, ...SCALE_ARGS],
    run: ({ sandbox, context }, values) => {
      let existed = false
      try { existed = !!apps.getContainerApp(sandbox, values.resourceGroup, values.name) } catch { /* parent and name validation belong to the operation */ }
      const { sandbox: next, resource } = apps.createContainerApp(sandbox, values, context?.lab)
      return { sandbox: next, output: presentContainerApp(resource), events: [appEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['containerapp', 'show'], 'Show a Container App.', {
    args: [APP_NAME, ARG.resourceGroup],
    run: ({ sandbox, context }, values) => ({ sandbox, output: presentContainerApp(apps.getContainerApp(sandbox, values.resourceGroup, values.name)),
      ...(context?.lab?.capabilities?.bicepDeployment === true ? { effects: [{ type: 'bicep-observation', kind: 'app-show',
        name: values.name, resourceGroup: values.resourceGroup }] } : {}) }),
  }),
  list: defineCommand(['containerapp', 'list'], 'List Container Apps.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: apps.listContainerApps(sandbox, values.resourceGroup ?? null).map(presentContainerApp) }),
  }),
  update: defineCommand(['containerapp', 'update'], 'Update a Container App.', {
    latencyMs: LATENCY.mutate,
    args: [APP_NAME, ARG.resourceGroup, ...APP_UPDATE_ARGS],
    run: ({ sandbox, context }, values) => {
      if (values.yaml !== undefined) {
        if (context?.lab?.capabilities?.healthProbes !== true || !context?.run?.project) throw new AzError('UnsupportedOperation', '--yaml is available only in a health-probe Lab.', { kind: 'cli' })
        if (Object.keys(values).some((key) => !['name', 'resourceGroup', 'yaml'].includes(key))) throw new AzError('UnsupportedOperation', '--yaml cannot be combined with other update flags.', { kind: 'cli' })
        if (values.yaml !== 'containerapp.yaml') throw new AzError('UnsupportedOperation', 'Only the saved local containerapp.yaml path is supported; remote and traversal paths are unavailable.', { kind: 'cli' })
        const parsed = parseProbeConfiguration(context.run.project.savedFiles[values.yaml])
        if (parsed.diagnostics.length) {
          const error = new AzError('UnsupportedOperation', parsed.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; '), { kind: 'cli' })
          error.diagnostics = parsed.diagnostics
          throw error
        }
        const { sandbox: next, resource } = apps.updateContainerAppFromProbeConfig(sandbox, values, parsed.config)
        return { sandbox: next, output: presentContainerApp(resource), events: [appEvent('updated', resource)] }
      }
      const { sandbox: next, resource } = apps.updateContainerApp(sandbox, values, context?.lab)
      return { sandbox: next, output: presentContainerApp(resource), events: [appEvent('updated', resource)] }
    },
  }),
  delete: defineCommand(['containerapp', 'delete'], 'Delete a Container App.', {
    latencyMs: LATENCY.mutate,
    args: [APP_NAME, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const app = apps.getContainerApp(sandbox, values.resourceGroup, values.name)
      const { sandbox: next } = apps.deleteContainerApp(sandbox, values)
      return { sandbox: next, output: null, events: [appEvent('deleted', app)] }
    },
  }),
  identity: defineGroup(['containerapp', 'identity'], 'Manage Container App user-assigned identities.', {
    assign: defineCommand(['containerapp', 'identity', 'assign'], 'Attach an existing user-assigned identity.', {
      latencyMs: LATENCY.mutate,
      args: [APP_NAME, ARG.resourceGroup, { ...USER_ASSIGNED, required: true }],
      run: ({ sandbox }, values) => {
        const { sandbox: next, resource, changed } = apps.assignContainerAppIdentity(sandbox, values)
        return { sandbox: next, output: presentContainerApp(resource).identity,
          events: changed ? [appEvent('updated', resource)] : [] }
      },
    }),
    show: defineCommand(['containerapp', 'identity', 'show'], 'Show attached user-assigned identities.', {
      args: [APP_NAME, ARG.resourceGroup],
      run: ({ sandbox }, values) => ({ sandbox,
        output: presentContainerApp(apps.getContainerApp(sandbox, values.resourceGroup, values.name)).identity ?? { type: 'None', userAssignedIdentities: {} } }),
    }),
  }),
  ingress: defineGroup(['containerapp', 'ingress'], 'Manage Container App ingress.', {
    enable: defineCommand(['containerapp', 'ingress', 'enable'], 'Enable ingress on a Container App.', {
      latencyMs: LATENCY.mutate,
      args: [APP_NAME, ARG.resourceGroup, { ...INGRESS_TYPE, required: true }, { ...TARGET_PORT, required: true }],
      run: ({ sandbox }, values) => {
        const { sandbox: next, resource } = apps.updateContainerAppIngress(sandbox, values)
        return { sandbox: next, output: presentContainerApp(resource), events: [appEvent('updated', resource)] }
      },
    }),
    update: defineCommand(['containerapp', 'ingress', 'update'], 'Update ingress target port or visibility.', {
      latencyMs: LATENCY.mutate,
      args: [APP_NAME, ARG.resourceGroup, INGRESS_TYPE, TARGET_PORT],
      run: ({ sandbox }, values) => {
        const { sandbox: next, resource } = apps.updateContainerAppIngress(sandbox, values)
        return { sandbox: next, output: presentContainerApp(resource), events: [appEvent('updated', resource)] }
      },
    }),
  }),
  env: environmentGroup,
})

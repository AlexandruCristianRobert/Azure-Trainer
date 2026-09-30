import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as registries from '../../sandbox/registry.js'
import { presentRegistry } from '../registry-arm.js'
import { buildImage } from '../../project/build.js'
import { AzError } from '../../sandbox/errors.js'

const NAME = ARG.name('Name of the Azure Container Registry (5-50 alphanumeric characters).')
const REGISTRY = { name: '--registry', aliases: [], required: true, kind: 'string', dest: 'registry', help: 'Existing simulated registry name.' }
const IMAGE = { name: '--image', aliases: ['-t'], required: true, kind: 'string', dest: 'image', help: 'Repository:tag to publish in the registry.' }
const FILE = { name: '--file', aliases: ['-f'], required: false, kind: 'string', dest: 'file', help: 'Supported Dockerfile path: Dockerfile.' }
const CONTEXT = { name: '<context>', aliases: [], required: true, kind: 'positional', dest: 'buildContext', help: 'Supported local context: . Remote URLs are unavailable.' }
const SKU = { name: '--sku', aliases: [], required: true, kind: 'string', choices: ['Basic'], dest: 'sku', help: 'Only Basic is simulated.' }
const REPOSITORY = { name: '--repository', aliases: [], required: true, kind: 'string', dest: 'repository', help: 'Repository name.' }
const eventFor = (type, registry) => event(type, 'containerRegistry', { name: registry.name, resourceGroup: registry.resourceGroup })

function requireArtifacts(context) {
  if (!context?.run?.artifacts) throw new AzError('UnsupportedOperation', 'Repository inspection requires a guided Lab run with captured artifacts.', { kind: 'cli' })
  return context.run.artifacts
}
function entriesFor(registry, artifacts) {
  const prefix = `${registry.loginServer}/`
  return Object.keys(artifacts.publishedTags ?? {}).filter((key) => key.startsWith(prefix))
}

export const acrGroup = defineGroup(['acr'], 'Manage simulated registries and local guided-Lab image builds.', {
  create: defineCommand(['acr', 'create'], 'Create a Basic container registry in the Sandbox.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(false), SKU, ARG.tags],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, existed } = registries.createRegistry(sandbox, values)
      return { sandbox: next, output: presentRegistry(resource), events: [eventFor(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['acr', 'show'], 'Show a container registry.', {
    args: [NAME, ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: presentRegistry(registries.getRegistry(sandbox, values.resourceGroup ?? null, values.name)) }),
  }),
  list: defineCommand(['acr', 'list'], 'List container registries.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: registries.listRegistries(sandbox, values.resourceGroup ?? null).map(presentRegistry) }),
  }),
  delete: defineCommand(['acr', 'delete'], 'Delete a registry and its published tags; captured build artifacts remain in the run.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroupOptional, ARG.yes],
    run: ({ sandbox }, values) => {
      if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
      const { sandbox: next, resource } = registries.deleteRegistry(sandbox, values)
      return { sandbox: next, output: null, events: [eventFor('deleted', resource)], effects: [{ type: 'delete-registry-publications', registryIds: [resource.id] }] }
    },
  }),
  build: defineCommand(['acr', 'build'], 'Build saved guided-Lab files locally and publish a simulated image; remote contexts are unsupported.', {
    latencyMs: LATENCY.mutate, args: [REGISTRY, IMAGE, FILE, CONTEXT],
    run: ({ sandbox, context }, values) => {
      if (context?.lab?.capabilities?.acrBuild !== true || !context?.run?.project) throw new AzError('UnsupportedOperation', 'ACR build is available only in a guided Lab with saved project files.', { kind: 'cli' })
      const registry = registries.getRegistry(sandbox, values.registry)
      if (values.buildContext !== '.' || (values.file ?? 'Dockerfile') !== 'Dockerfile') throw new AzError('UnsupportedOperation', 'Builds support Dockerfile and local context . only; remote contexts are unavailable.', { kind: 'cli' })
      const built = buildImage(context.run, { registryId: registry.id, loginServer: registry.loginServer, image: values.image, file: values.file ?? 'Dockerfile', context: values.buildContext })
      if (built.diagnostics.length) {
        const failure = new AzError('BuildFailed', `Build failed: ${built.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.code}: ${diagnostic.message}`).join('; ')}`, { kind: 'cli' })
        failure.diagnostics = built.diagnostics
        throw failure
      }
      return { sandbox, output: built.artifact, events: [event('created', 'imageBuild', { name: built.artifact.id, resourceGroup: registry.resourceGroup })], effects: [{ type: 'publish-build', artifacts: built.artifacts, nextSequence: built.nextSequence }] }
    },
  }),
  repository: defineGroup(['acr', 'repository'], 'Inspect published images in the guided Lab run.', {
    list: defineCommand(['acr', 'repository', 'list'], 'List simulated repositories for a registry.', {
      args: [NAME],
      run: ({ sandbox, context }, values) => {
        const registry = registries.getRegistry(sandbox, values.name)
        const entries = entriesFor(registry, requireArtifacts(context))
        return { sandbox, output: [...new Set(entries.map((entry) => entry.slice(registry.loginServer.length + 1).split(':')[0]))].sort() }
      },
    }),
    'show-tags': defineCommand(['acr', 'repository', 'show-tags'], 'List published tags for one simulated repository.', {
      args: [NAME, REPOSITORY],
      run: ({ sandbox, context }, values) => {
        const registry = registries.getRegistry(sandbox, values.name)
        const prefix = `${registry.loginServer}/${values.repository.toLowerCase()}:`
        return { sandbox, output: entriesFor(registry, requireArtifacts(context)).filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length)).sort() }
      },
    }),
  }),
})

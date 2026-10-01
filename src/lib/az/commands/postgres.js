import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as postgres from '../../sandbox/postgres.js'
import { POSTGRES_SKUS } from '../../sandbox/model.js'
import { AzError } from '../../sandbox/errors.js'
import { presentPostgresServer, presentPostgresParameter, presentPostgresDatabase } from '../postgres-arm.js'

const NAME = ARG.name('PostgreSQL flexible server name.')
const SERVER = { name: '--server-name', aliases: ['-s'], required: true, kind: 'string', dest: 'server', help: 'PostgreSQL flexible server name.' }
const TIER = { name: '--tier', kind: 'string', dest: 'tier', choices: ['Burstable', 'GeneralPurpose', 'MemoryOptimized'], help: 'Compute tier (simulated sizing).' }
const SKU = { name: '--sku-name', kind: 'string', dest: 'skuName', choices: Object.keys(POSTGRES_SKUS), help: 'Compute SKU (simulated sizing).' }
const STORAGE = { name: '--storage-size', kind: 'int', dest: 'storageSizeGb', help: 'Storage capacity in GB. Can only grow.' }
const field = (name, dest, help, extra = {}) => ({ name, dest, help, kind: 'string', ...extra })
const PARAMETER = ARG.name('Server parameter name.')
const PARAM_ARGS = [ARG.resourceGroup, SERVER, PARAMETER]
const change = (type, resource) => event(type, 'postgresServer', { name: resource.name, resourceGroup: resource.resourceGroup })
const getServer = (sandbox, values) => postgres.getPostgresServer(sandbox, values.name ?? values.server, values.resourceGroup)

const flexible = ['postgres', 'flexible-server']
const parameterGroup = defineGroup([...flexible, 'parameter'], 'Manage PostgreSQL server parameters.', {
  set: defineCommand([...flexible, 'parameter', 'set'], 'Set a PostgreSQL server parameter.', {
    latencyMs: LATENCY.mutate,
    args: [...PARAM_ARGS, field('--value', 'value', 'Parameter value. Memory values use kB.', { required: true, allowEmpty: true })],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = postgres.setPostgresParameter(sandbox, values)
      return { sandbox: next, output: presentPostgresParameter(resource, values.name), events: [change('updated', resource)] }
    },
  }),
  show: defineCommand([...flexible, 'parameter', 'show'], 'Show a PostgreSQL server parameter.', {
    args: PARAM_ARGS,
    run: ({ sandbox }, values) => {
      const server = postgres.getPostgresServer(sandbox, values.server, values.resourceGroup)
      if (!Object.hasOwn(server.parameters, values.name)) throw new AzError('ResourceNotFound', `Server parameter '${values.name}' was not found.`)
      return { sandbox, output: presentPostgresParameter(server, values.name) }
    },
  }),
})
const dbGroup = defineGroup([...flexible, 'db'], 'Manage PostgreSQL databases.', {
  create: defineCommand([...flexible, 'db', 'create'], 'Create a PostgreSQL database.', {
    latencyMs: LATENCY.mutate,
    args: [ARG.resourceGroup, SERVER, field('--database-name', 'databaseName', 'Database name.', { required: true, aliases: ['-d'] })],
    run: ({ sandbox }, values) => {
      const existed = postgres.getPostgresServer(sandbox, values.server, values.resourceGroup).databases.some(database => database.name === values.databaseName)
      const { sandbox: next, resource, server } = postgres.createPostgresDatabase(sandbox, values)
      return { sandbox: next, output: presentPostgresDatabase(resource, server), events: [event(existed ? 'updated' : 'created', 'postgresDatabase', { name: resource.name, server: server.name, resourceGroup: server.resourceGroup })] }
    },
  }),
  list: defineCommand([...flexible, 'db', 'list'], 'List PostgreSQL databases.', {
    args: [ARG.resourceGroup, SERVER],
    run: ({ sandbox }, values) => {
      const server = postgres.getPostgresServer(sandbox, values.server, values.resourceGroup)
      return { sandbox, output: server.databases.map(database => presentPostgresDatabase(database, server)) }
    },
  }),
})
export const postgresGroup = defineGroup(['postgres'], 'Manage Azure Database for PostgreSQL.', {
  'flexible-server': defineGroup(flexible, 'Manage PostgreSQL flexible servers.', {
    create: defineCommand([...flexible, 'create'], 'Create a PostgreSQL flexible server.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ARG.resourceGroup, ARG.location(false), TIER, SKU, STORAGE,
        field('--version', 'version', 'PostgreSQL major version.', { choices: ['16'] }),
        field('--admin-user', 'adminUser', 'Administrator login.'),
        field('--admin-password', 'adminPassword', 'Training-only password; not retained by the simulator.'),
        field('--public-access', 'publicAccess', 'None or an IPv4 range (start-end).')],
      run: ({ sandbox }, values) => {
        const existed = postgres.listPostgresServers(sandbox).some(server => server.name === values.name)
        const { sandbox: next, resource } = postgres.createPostgresServer(sandbox, values)
        return { sandbox: next, output: presentPostgresServer(resource), events: [change(existed ? 'updated' : 'created', resource)] }
      },
    }),
    update: defineCommand([...flexible, 'update'], 'Update PostgreSQL compute or increase storage.', {
      latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, TIER, SKU, STORAGE],
      run: ({ sandbox }, values) => {
        const { sandbox: next, resource } = postgres.updatePostgresServer(sandbox, values)
        return { sandbox: next, output: presentPostgresServer(resource), events: [change('updated', resource)] }
      },
    }),
    show: defineCommand([...flexible, 'show'], 'Show a PostgreSQL flexible server.', {
      args: [NAME, ARG.resourceGroup], run: ({ sandbox }, values) => ({ sandbox, output: presentPostgresServer(getServer(sandbox, values)) }),
    }),
    list: defineCommand([...flexible, 'list'], 'List PostgreSQL flexible servers.', {
      args: [ARG.resourceGroupOptional], run: ({ sandbox }, values) => ({ sandbox, output: postgres.listPostgresServers(sandbox, values.resourceGroup ?? null).map(presentPostgresServer) }),
    }),
    delete: defineCommand([...flexible, 'delete'], 'Delete a PostgreSQL flexible server.', {
      latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.yes],
      run: ({ sandbox }, values) => {
        if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
        const { sandbox: next, resource } = postgres.deletePostgresServer(sandbox, values)
        return { sandbox: next, output: null, events: [change('deleted', resource)] }
      },
    }),
    parameter: parameterGroup, db: dbGroup,
  }),
})

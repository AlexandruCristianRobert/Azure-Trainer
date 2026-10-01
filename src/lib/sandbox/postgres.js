import { cloneSandbox, nowIso, POSTGRES_SKUS } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const bad = message => { throw new AzError('BadRequest', message) }
const find = (sandbox, name, group) => (sandbox.postgresServers ?? []).find(server => same(server.name, name) && (group == null || same(server.resourceGroup, group)))
function requireGroup(sandbox, name) {
  const group = sandbox.resourceGroups.find(group => same(group.name, name))
  if (!group) throw new AzError('ResourceGroupNotFound', `Resource group '${name}' could not be found.`)
  return group
}
function sizing(tier, skuName) {
  const name = skuName ?? Object.keys(POSTGRES_SKUS).find(name => POSTGRES_SKUS[name].tier === (tier ?? 'Burstable'))
  const sku = POSTGRES_SKUS[name]
  if (!sku || (tier !== undefined && tier !== sku.tier)) bad('The PostgreSQL tier and SKU must be a supported matching pair.')
  return { ...sku, skuName: name }
}
function storage(value) {
  if (!Number.isInteger(value) || value < 32 || value > 32768) bad('Storage size must be an integer between 32 and 32768 GB.')
  return value
}
function publicAccess(value) {
  if (value === 'None') return value
  const ip = source => /^\d{1,3}(\.\d{1,3}){3}$/.test(source) && source.split('.').every(part => Number(part) <= 255)
  const bounds = String(value).split('-')
  const number = source => source.split('.').reduce((total, part) => total * 256 + Number(part), 0)
  if (bounds.length !== 2 || !bounds.every(ip) || number(bounds[0]) > number(bounds[1])) bad('Public access must be None or an IPv4 range (start-end).')
  return value
}
export function getPostgresServer(sandbox, name, resourceGroup) {
  if (resourceGroup != null) requireGroup(sandbox, resourceGroup)
  const server = find(sandbox, name, resourceGroup)
  if (!server) throw new AzError('ResourceNotFound', `PostgreSQL flexible server '${name}' was not found.`)
  return server
}
export function getPostgresDatabase(server, name) {
  const database = server.databases.find(database => database.name === name)
  if (!database) throw new AzError('ResourceNotFound', `Database '${name}' was not found in PostgreSQL server '${server.name}'.`)
  return database
}
export function listPostgresServers(sandbox, resourceGroup = null) {
  if (resourceGroup != null) requireGroup(sandbox, resourceGroup)
  return (sandbox.postgresServers ?? []).filter(server => resourceGroup == null || same(server.resourceGroup, resourceGroup))
}
export function createPostgresServer(sandbox, options) {
  const { name, resourceGroup, location, tier, skuName, storageSizeGb = 32, version = '16', adminUser = 'assistant_admin', publicAccess: access = 'None' } = options
  const group = requireGroup(sandbox, resourceGroup)
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(name)) bad('PostgreSQL server names must be 3-63 lowercase letters, numbers, or hyphens, starting and ending with a letter or number.')
  const resolvedLocation = normalizeLocation(location ?? group.location)
  if (!resolvedLocation) bad(`The provided location '${location}' is not available.`)
  if (String(version) !== '16') bad('Only PostgreSQL version 16 is supported in the simulator.')
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(adminUser) || ['admin', 'root', 'postgres'].includes(adminUser.toLowerCase())) bad('The PostgreSQL administrator user name is invalid.')
  const size = sizing(tier, skuName)
  storage(storageSizeGb)
  publicAccess(access)
  const existing = find(sandbox, name)
  if (existing) {
    if (!same(existing.resourceGroup, group.name)) throw new AzError('Conflict', `PostgreSQL server name '${name}' is already in use.`)
    if (existing.location !== resolvedLocation || existing.version !== String(version) || existing.adminUser !== adminUser || existing.publicAccess !== access) bad('Existing server location, version, administrator, and public access cannot be changed by create.')
    return updatePostgresServer(sandbox, { name, resourceGroup, tier: size.tier, skuName: size.skuName, storageSizeGb })
  }
  const next = cloneSandbox(sandbox)
  const resource = {
    name, resourceGroup: group.name, location: resolvedLocation, version: String(version), tier: size.tier, skuName: size.skuName,
    vCores: size.vCores, memoryGiB: size.memoryGiB, storageSizeGb, adminUser, publicAccess: access,
    fullyQualifiedDomainName: `${name}.postgres.database.azure.com`, createdAt: nowIso(), parameterOverrides: [],
    parameters: { 'azure.extensions': '', maintenance_work_mem: '65536', max_connections: String(size.maxConnections),
      'pgbouncer.enabled': 'false', 'pgbouncer.default_pool_size': '50', shared_buffers: String(size.memoryGiB * 1024 * 1024 / 4) },
    databases: [],
  }
  next.postgresServers ??= []
  next.postgresServers.push(resource)
  return { sandbox: next, resource }
}
export function updatePostgresServer(sandbox, { name, resourceGroup, tier, skuName, storageSizeGb }) {
  const previous = getPostgresServer(sandbox, name, resourceGroup)
  const size = sizing(tier ?? (skuName === undefined ? previous.tier : undefined), skuName ?? (tier === undefined || tier === previous.tier ? previous.skuName : undefined))
  if (storageSizeGb !== undefined) {
    if (storageSizeGb < previous.storageSizeGb) bad('Storage size can only be increased.')
    storage(storageSizeGb)
  }
  if (size.tier === 'Burstable' && previous.parameters['pgbouncer.enabled'] === 'true') bad('PgBouncer is not supported on the Burstable tier.')
  if (Number(previous.parameters.maintenance_work_mem) > size.memoryGiB * 1024 * 1024 / 4) bad('maintenance_work_mem cannot exceed 25% of server memory (kB). Lower it before reducing server memory.')
  const next = cloneSandbox(sandbox)
  const resource = find(next, name, resourceGroup)
  Object.assign(resource, { tier: size.tier, skuName: size.skuName, vCores: size.vCores, memoryGiB: size.memoryGiB, storageSizeGb: storageSizeGb ?? previous.storageSizeGb })
  if (!resource.parameterOverrides.includes('max_connections')) resource.parameters.max_connections = String(size.maxConnections)
  if (!resource.parameterOverrides.includes('shared_buffers')) resource.parameters.shared_buffers = String(size.memoryGiB * 1024 * 1024 / 4)
  return { sandbox: next, resource }
}
export function setPostgresParameter(sandbox, { server, resourceGroup, name, value }) {
  const previous = getPostgresServer(sandbox, server, resourceGroup)
  if (!Object.hasOwn(previous.parameters, name)) bad(`Server parameter '${name}' is not supported in the simulator.`)
  let resolved = String(value)
  if (name === 'azure.extensions') {
    const extensions = resolved.split(',').map(extension => extension.trim().toLowerCase()).filter(Boolean)
    if (extensions.some(extension => !/^[a-z][a-z0-9_]*$/.test(extension))) bad('azure.extensions must be a comma-separated list of extension names.')
    resolved = [...new Set(extensions)].join(',')
  } else if (name === 'pgbouncer.enabled') {
    resolved = resolved.toLowerCase()
    if (!['true', 'false'].includes(resolved)) bad('pgbouncer.enabled must be true or false.')
    if (resolved === 'true' && previous.tier === 'Burstable') bad('PgBouncer is not supported on the Burstable tier.')
  } else {
    if (!/^\d+$/.test(resolved) || !Number.isSafeInteger(Number(resolved)) || Number(resolved) < 1) bad(`${name} must be a positive integer${name.endsWith('_mem') || name === 'shared_buffers' ? ' in kB' : ''}.`)
    if (name === 'maintenance_work_mem' && Number(resolved) > previous.memoryGiB * 1024 * 1024 / 4) bad('maintenance_work_mem cannot exceed 25% of server memory (kB).')
    resolved = String(Number(resolved))
  }
  const next = cloneSandbox(sandbox)
  const resource = find(next, server, resourceGroup)
  resource.parameters[name] = resolved
  if (!resource.parameterOverrides.includes(name)) resource.parameterOverrides.push(name)
  return { sandbox: next, resource }
}
export function createPostgresDatabase(sandbox, { server, resourceGroup, name, databaseName }) {
  const resolvedName = name ?? databaseName
  getPostgresServer(sandbox, server, resourceGroup)
  if (typeof resolvedName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(resolvedName)) bad('Database name must be 1-63 letters, numbers, underscores, dollar signs, or hyphens and start with a letter or underscore.')
  const next = cloneSandbox(sandbox)
  const storedServer = find(next, server, resourceGroup)
  let resource = storedServer.databases.find(database => database.name === resolvedName)
  if (!resource) {
    resource = { name: resolvedName, extensions: [], tables: [], indexes: [], settings: {} }
    storedServer.databases.push(resource)
  }
  return { sandbox: next, resource, server: storedServer }
}
export function deletePostgresServer(sandbox, { name, resourceGroup }) {
  const resource = getPostgresServer(sandbox, name, resourceGroup)
  const next = cloneSandbox(sandbox)
  next.postgresServers = next.postgresServers.filter(server => !same(server.name, resource.name))
  return { sandbox: next, resource }
}

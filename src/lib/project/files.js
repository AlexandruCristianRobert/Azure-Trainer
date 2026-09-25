import { PROJECT_MANIFEST } from '../../data/templates/containerapps-dotnet/starter.js'
import { getProjectManifest } from './manifests.js'
import { lexCsharp, parseCsharp } from './csharp.js'
import { parseFoundrySource, parseTroubleshootingFoundrySource, parseIndependentFoundrySource } from './foundry.js'
import { parseCapstoneSource } from './capstone.js'
import { parsePythonProject } from './python.js'

function diagnostic(code, message, path, line = 1, column = 1) { return { code, message, path, line, column } }
function clone(value) { return JSON.parse(JSON.stringify(value ?? {})) }
function bytes(text) { return new TextEncoder().encode(text).length }
function validPath(path, manifest) { return typeof path === 'string' && !path.includes('\\') && !path.startsWith('/') && !path.includes('://') && !path.split('/').includes('..') && manifest.files.includes(path) }

function validateJson(text, path, manifest = PROJECT_MANIFEST) {
  if (typeof text !== 'string') return { value: null, diagnostics: [diagnostic('INVALID_FILE', 'Project files must be text.', path)] }
  try {
    const parsed = JSON.parse(text)
    if (!Number.isInteger(parsed?.ListeningPort) || parsed.ListeningPort < 1 || parsed.ListeningPort > 65535) return { value: null, diagnostics: [diagnostic('INVALID_SETTINGS', 'ListeningPort must be an integer from 1 to 65535.', path)] }
    if (manifest.foundry) {
      const expectedKeys = manifest.capstone || manifest.foundryTroubleshooting
        ? 'AttemptTimeoutSeconds,FoundryDeployment,FoundryEndpoint,HonorRetryAfter,ListeningPort,TotalAttempts,TotalBudgetSeconds'
        : manifest.foundryIndependent && Object.keys(parsed).length === 1 ? 'ListeningPort'
        : manifest.foundryIndependent ? 'AttemptTimeoutSeconds,FoundryDeployment,FoundryEndpoint,HonorRetryAfter,ListeningPort,TotalAttempts,TotalBudgetSeconds'
        : 'FoundryDeployment,FoundryEndpoint,ListeningPort'
      if (Object.keys(parsed).sort().join(',') !== expectedKeys
        || (expectedKeys !== 'ListeningPort' && (typeof parsed.FoundryEndpoint !== 'string' || typeof parsed.FoundryDeployment !== 'string'))) {
        return { value: null, diagnostics: [diagnostic('INVALID_FOUNDRY_CONFIG', 'Only supported Foundry settings are allowed.', path)] }
      }
    }
    return { value: parsed, diagnostics: [] }
  } catch (error) {
    const offset = Number(/position (\d+)/.exec(error.message)?.[1] ?? 0)
    const prefix = text.slice(0, offset)
    return { value: null, diagnostics: [diagnostic('INVALID_JSON', 'appsettings.json must contain valid JSON.', path, prefix.split('\n').length, prefix.length - prefix.lastIndexOf('\n'))] }
  }
}

function validateStaticFiles(files, manifest) {
  const diagnostics = []
  const entries = Object.entries(files ?? {})
  for (const path of manifest.files) {
    if (!Object.hasOwn(files ?? {}, path)) diagnostics.push(diagnostic('MISSING_FILE', 'A required manifest file is missing.', path))
  }
  if (entries.length > manifest.maxFiles) diagnostics.push(diagnostic('FILE_LIMIT', `A project may contain at most ${manifest.maxFiles} files.`, ''))
  let total = 0
  for (const [path, text] of entries) {
    if (!validPath(path, manifest)) diagnostics.push(diagnostic('UNKNOWN_FILE', 'This file is outside the project manifest.', path))
    if (typeof text !== 'string') diagnostics.push(diagnostic('INVALID_FILE', 'Project files must be text.', path))
    else { const size = bytes(text); total += size; if (size > manifest.maxFileBytes) diagnostics.push(diagnostic('FILE_TOO_LARGE', `A file may contain at most ${manifest.maxFileBytes} bytes.`, path)) }
  }
  for (const [path, expected] of Object.entries(manifest.fixedFiles ?? {})) {
    if (files[path] !== expected) diagnostics.push(diagnostic('SCAFFOLD_MODIFIED', 'This file is fixed outside its editable regions.', path))
  }
  if (total > manifest.maxTotalBytes) diagnostics.push(diagnostic('PROJECT_TOO_LARGE', `A project may contain at most ${manifest.maxTotalBytes} bytes.`, ''))
  if (manifest.bicepFiles) {
    if (manifest.bicepFiles.length > 12) diagnostics.push(diagnostic('BICEP_FILE_LIMIT', 'A Bicep project may contain at most 12 Bicep files.', ''))
    const bicepBytes = manifest.bicepFiles.reduce((sum, path) => sum + (typeof files?.[path] === 'string' ? bytes(files[path]) : 0), 0)
    if (bicepBytes > 128 * 1024) diagnostics.push(diagnostic('BICEP_TEXT_LIMIT', 'Bicep text may contain at most 128 KiB.', ''))
  }
  return diagnostics
}

export function saveProjectFile(project, path, text, manifest = PROJECT_MANIFEST) {
  manifest = manifest === PROJECT_MANIFEST ? getProjectManifest(project?.manifestId) : manifest
  if (!validPath(path, manifest)) {
    const code = typeof path === 'string' && (path.includes('..') || path.startsWith('/') || path.includes('\\') || path.includes('://')) ? 'INVALID_PATH' : 'UNKNOWN_FILE'
    return { project, diagnostics: [diagnostic(code, 'The path is not an editable project file.', path)] }
  }
  if (typeof text !== 'string') return { project, diagnostics: [diagnostic('INVALID_FILE', 'Project files must be text.', path)] }
  const candidate = { ...(project?.savedFiles ?? {}), [path]: text }
  const diagnostics = validateStaticFiles(candidate, manifest)
  if (path.endsWith('.cs') && !manifest.foundry) diagnostics.push(...lexCsharp(text, path, manifest.maxTokens).diagnostics)
  if (path === 'src/Trainer.Api/Program.cs' && manifest.capstone) {
    const configuration = validateJson(candidate['src/Trainer.Api/appsettings.json'], 'src/Trainer.Api/appsettings.json', manifest)
    diagnostics.push(...configuration.diagnostics)
    if (configuration.value) diagnostics.push(...parseCapstoneSource(text, configuration.value, manifest.maxTokens).diagnostics
      .filter(item => ['TOKEN_LIMIT', 'UNTERMINATED_COMMENT', 'INVALID_STRING'].includes(item.code)))
  }
  if (path.endsWith('appsettings.json')) diagnostics.push(...validateJson(text, path, manifest).diagnostics)
  if (diagnostics.length) return { project, diagnostics }
  return {
    project: { ...project, savedFiles: candidate, draftFiles: { ...(project?.draftFiles ?? {}), [path]: text }, fileVersions: { ...(project?.fileVersions ?? {}), [path]: (project?.fileVersions?.[path] ?? 0) + 1 }, diagnostics: [] },
    diagnostics: [],
  }
}

export function parseProject(savedFiles, manifest = PROJECT_MANIFEST) {
  const files = clone(savedFiles ?? {})
  const diagnostics = validateStaticFiles(files, manifest)
  if (manifest.language === 'python') return parsePythonProject(files, manifest)
  const programPath = 'src/Trainer.Api/Program.cs'; const settingsPath = 'src/Trainer.Api/AppSettings.cs'; const jsonPath = 'src/Trainer.Api/appsettings.json'
  if (diagnostics.length) return { appSpec: null, diagnostics }
  const settings = validateJson(files[jsonPath], jsonPath, manifest); diagnostics.push(...settings.diagnostics)
  if (manifest.capstone) {
    if (diagnostics.length) return { appSpec: null, diagnostics }
    const combined = parseCapstoneSource(files[programPath], settings.value, manifest.maxTokens)
    diagnostics.push(...combined.diagnostics)
    if (diagnostics.length) return { appSpec: null, diagnostics }
    return { appSpec: { service: { source: 'AppSettings.ServiceName', value: 'contoso-api' },
      listeningPort: settings.value.ListeningPort,
      routes: [{ method: 'GET', path: '/api/info', response: { service: { kind: 'member', source: 'AppSettings.ServiceName', value: 'contoso-api' },
        environment: { kind: 'config', key: 'APP_ENV' } } },
      { method: 'GET', path: '/api/work' }, { method: 'POST', path: '/api/summarize' }],
      cpuRoute: combined.cpuRoute, healthEndpoints: combined.healthEndpoints, foundry: combined.foundry }, diagnostics: [] }
  }
  if (manifest.foundry) {
    const foundry = manifest.foundryIndependent
      ? parseIndependentFoundrySource(files[programPath], settings.value)
      : manifest.foundryTroubleshooting
      ? parseTroubleshootingFoundrySource(files[programPath], settings.value)
      : parseFoundrySource(files[programPath], settings.value)
    diagnostics.push(...foundry.diagnostics)
    if (diagnostics.length) return { appSpec: null, diagnostics }
    return { appSpec: { service: { source: 'AppSettings.ServiceName', value: 'contoso-api' },
      listeningPort: settings.value.ListeningPort, routes: [
        { method: 'GET', path: '/api/info', response: { service: { kind: 'member', source: 'AppSettings.ServiceName', value: 'contoso-api' },
          environment: { kind: 'config', key: 'APP_ENV' } } },
        ...(manifest.foundryIndependent && !foundry.foundry ? [] : [{ method: 'POST', path: foundry.foundry?.path ?? '/api/summarize' }]),
      ], foundry: foundry.foundry }, diagnostics: [] }
  }
  const parsed = parseCsharp(files[programPath] ?? '', files[settingsPath] ?? '', { programPath, settingsPath, maxTokens: manifest.maxTokens, healthProbes: manifest.healthProbes === true })
  diagnostics.push(...parsed.diagnostics)
  if (!parsed.route || !parsed.listener || !parsed.serviceName || !settings.value || diagnostics.length) return { appSpec: null, diagnostics }
  const response = Object.fromEntries(Object.entries(parsed.route.response).map(([key, expression]) => [key, expression.kind === 'member'
    ? { kind: 'member', source: expression.source, value: parsed.serviceName }
    : expression.kind === 'literal' ? { kind: 'literal', value: expression.value }
      : { kind: 'config', key: expression.key }]))
  return { appSpec: { service: { source: 'AppSettings.ServiceName', value: parsed.serviceName }, listeningPort: settings.value.ListeningPort, routes: [{ ...parsed.route, response }],
    ...(manifest.healthProbes ? { healthEndpoints: parsed.healthEndpoints } : {}) }, diagnostics: [] }
}

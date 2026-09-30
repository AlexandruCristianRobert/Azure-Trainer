import { describe, expect, it } from 'vitest'
import { BICEP_LIMITS, lexBicep } from '../src/lib/bicep/lexer.js'
import { parseBicep, parseBicepParams, parseBicepProject } from '../src/lib/bicep/parser.js'
import { BICEP_MANIFEST, BICEP_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/bicep-guided.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { parseProject, saveProjectFile } from '../src/lib/project/files.js'
import { buildImage } from '../src/lib/project/build.js'

const main = 'infra/main.bicep'
const params = 'infra/first.bicepparam'

describe('bounded Bicep syntax', () => {
  it('lexes comments, documented Bicep string escapes, interpolation and located tokens', () => {
    const result = lexBicep("// comment\nvar greeting = 'it\\'s ${resourceGroup().name}'\n", main)
    expect(result.diagnostics).toEqual([])
    expect(result.tokens.map(token => token.type)).toEqual(['identifier', 'identifier', '=', 'string', 'eof'])
    expect(result.tokens[0]).toMatchObject({ value: 'var', line: 2, column: 1, path: main })
    expect(result.tokens[3].segments).toMatchObject([{ kind: 'text', value: "it's " }, { kind: 'expression' }])
    const literal = lexBicep("var folder = 'path\\\\folder'\nvar escaped = 'a\\n'\nvar quote = 'it\\'s'\nvar dollar = '\\${literal}'\nvar unicode = '\\u{1F642}'", main)
    expect(literal.diagnostics).toEqual([])
    expect(literal.tokens.filter(token => token.type === 'string').map(token => token.value)).toEqual(['path\\folder', 'a\n', "it's", '${literal}', '🙂'])
    expect(lexBicep("var invalid = 'path\\folder'", main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main })
    expect(lexBicep("var invalid = '\\$alone'", main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main })
  })

  it('parses declarations, decorators, resources, modules, outputs and dependsOn', () => {
    const text = `@description('Name')\n@allowed(['dev', 'prod'])\nparam env string = 'dev'\nvar config = { name: env, count: 2, enabled: true }\nresource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = { name: 'acr' }\nmodule identity './modules/identity.bicep' = { name: 'identity', params: { env: env }, dependsOn: [registry] }\noutput registryName string = registry.name\n`
    const result = parseBicep(text, main)
    expect(result.diagnostics).toEqual([])
    expect(result.ast.declarations.map(item => item.kind)).toEqual(['param', 'var', 'resource', 'module', 'output'])
    expect(result.ast.declarations[0].decorators.map(item => item.name)).toEqual(['description', 'allowed'])
    expect(result.ast.declarations[3].value.properties.find(item => item.key === 'dependsOn').value.items[0]).toMatchObject({ kind: 'identifier', name: 'registry' })
  })

  it('distinguishes malformed syntax from valid unsupported forms with locations', () => {
    for (const text of ["resource apps 'Type@1' = [for app in apps: app]", "module remote 'br/public:app:v1' = {}", "resource app 'Type@1' = if (true) {}", "targetScope = 'subscription'"]) {
      expect(parseBicep(text, main).diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_BICEP', path: main, line: 1 })
    }
    expect(parseBicep("var x = 'bad ${'", main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main, line: 1 })
    expect(parseBicep('var x = { name: }', main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main, line: 1 })
    expect(parseBicep('var x = [1 2]', main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main, line: 1, column: 12 })
    expect(parseBicep('var x = { a: 1 b: 2 }', main).diagnostics[0]).toMatchObject({ code: 'BICEP_SYNTAX', path: main, line: 1, column: 16 })
    expect(parseBicep('var x = [1\n2]', main).diagnostics).toEqual([])
    expect(parseBicep('var x = { a: 1\nb: 2 }', main).diagnostics).toEqual([])
    expect(parseBicep('var x = 1\nvar x = 2', main).diagnostics[0]).toMatchObject({ code: 'DUPLICATE_BICEP_DECLARATION', path: main, line: 2, column: 1 })
    expect(parseBicep("targetScope = 'resourceGroup'\nvar x = 1", main).ast.targetScope).toBe('resourceGroup')
  })

  it('accepts only using main and literal bicepparam assignments', () => {
    expect(parseBicepParams("using './main.bicep'\nparam env = 'dev'\nparam limits = { min: 1, enabled: true, tags: ['a'] }", params).diagnostics).toEqual([])
    expect(parseBicepParams("using '../escape.bicep'", params).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    expect(parseBicepParams("using './main.bicep'\nparam env = other", params).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })

  it('enforces token, depth and interpolation boundaries', () => {
    expect(lexBicep('a '.repeat(BICEP_LIMITS.tokensPerFile), main).diagnostics).toEqual([])
    expect(lexBicep('a '.repeat(BICEP_LIMITS.tokensPerFile + 1), main).diagnostics[0].code).toBe('BICEP_TOKEN_LIMIT')
    expect(parseBicep(`var x = ${'['.repeat(32)}1${']'.repeat(32)}`, main).diagnostics).toEqual([])
    expect(parseBicep(`var x = ${'['.repeat(33)}1${']'.repeat(33)}`, main).diagnostics[0].code).toBe('BICEP_DEPTH_LIMIT')
    expect(lexBicep(`var x = '${'${1}'.repeat(33)}'`, main).diagnostics[0].code).toBe('BICEP_INTERPOLATION_LIMIT')
    expect(lexBicep(`var x = '${'${1}'.repeat(32)}'`, main).diagnostics).toEqual([])
    expect(lexBicep(`var x = '${'${' + 'x '.repeat(1024) + "}'"}`, main).diagnostics).toEqual([])
    expect(lexBicep(`var x = '${'${' + 'x '.repeat(1025) + "}'"}`, main).diagnostics[0].code).toBe('BICEP_INTERPOLATION_LIMIT')
  })
})

describe('Bicep project files', () => {
  it('registers a finite local manifest and preserves the Foundry build source', () => {
    expect(getProjectManifest(BICEP_MANIFEST.id)).toBe(BICEP_MANIFEST)
    expect(BICEP_MANIFEST.files.filter(path => /\.bicep(param)?$/.test(path))).toHaveLength(7)
    expect(BICEP_MANIFEST.files).toContain(main)
    expect(BICEP_MANIFEST.files).toContain(params)
    expect(parseProject(BICEP_STARTER_FILES, BICEP_MANIFEST).diagnostics).toEqual([])
    const run = { nextSequence: 1, project: { manifestId: BICEP_MANIFEST.id, savedFiles: BICEP_STARTER_FILES }, artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } }
    expect(buildImage(run, { registryId: 'acr', loginServer: 'sample.azurecr.io', image: 'api:v1' }).diagnostics).toEqual([])
  })

  it('saves incomplete bounded Bicep without parsing drafts and rejects unsafe paths', () => {
    const project = { manifestId: BICEP_MANIFEST.id, savedFiles: structuredClone(BICEP_STARTER_FILES), draftFiles: { ...BICEP_STARTER_FILES, [main]: 'draft' }, fileVersions: {} }
    const result = saveProjectFile(project, main, 'resource unfinished')
    expect(result.diagnostics).toEqual([])
    expect(result.project.savedFiles[main]).toBe('resource unfinished')
    expect(result.project.draftFiles[main]).toBe('resource unfinished')
    expect(result.project.fileVersions[main]).toBe(1)
    expect(parseBicepProject(result.project.savedFiles, BICEP_MANIFEST).diagnostics).not.toEqual([])
    for (const path of ['../infra/main.bicep', '/infra/main.bicep', 'https://example/main.bicep', 'infra\\main.bicep', 'infra/other.bicep']) {
      expect(saveProjectFile(project, path, 'x').diagnostics).not.toEqual([])
    }
    expect(saveProjectFile(project, main, 'x'.repeat(32 * 1024)).diagnostics).toEqual([])
    expect(saveProjectFile(project, main, 'x'.repeat(32 * 1024 + 1)).diagnostics[0].code).toBe('FILE_TOO_LARGE')
  })

  it('limits aggregate Bicep text and token counts', () => {
    const files = structuredClone(BICEP_STARTER_FILES)
    const paths = BICEP_MANIFEST.files.filter(path => path.endsWith('.bicep'))
    for (const path of paths) files[path] = 'a '.repeat(6000)
    expect(parseBicepProject(files, BICEP_MANIFEST).diagnostics.some(item => item.code === 'BICEP_TOKEN_LIMIT')).toBe(true)
    for (const path of paths) files[path] = ' '.repeat(24 * 1024)
    expect(parseBicepProject(files, BICEP_MANIFEST).diagnostics.some(item => item.code === 'BICEP_TEXT_LIMIT')).toBe(true)
    const missing = { ...BICEP_STARTER_FILES, [main]: "module lost './modules/missing.bicep' = {}" }
    expect(parseBicepProject(missing, BICEP_MANIFEST).diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_BICEP', path: main }))
    const project = { manifestId: BICEP_MANIFEST.id, savedFiles: structuredClone(BICEP_STARTER_FILES) }
    for (const path of BICEP_MANIFEST.bicepFiles) project.savedFiles[path] = ''
    for (const path of BICEP_MANIFEST.bicepFiles.slice(0, 4)) project.savedFiles[path] = ' '.repeat(32 * 1024)
    expect(saveProjectFile(project, BICEP_MANIFEST.bicepFiles[4], '').diagnostics).toEqual([])
    expect(saveProjectFile(project, BICEP_MANIFEST.bicepFiles[4], 'x').diagnostics).toContainEqual(expect.objectContaining({ code: 'BICEP_TEXT_LIMIT' }))
  })
})

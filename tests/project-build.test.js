import { describe, expect, it } from 'vitest'
import { PROJECT_MANIFEST, STARTER_FILES, SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'
import { saveProjectFile, parseProject } from '../src/lib/project/files.js'
import { lexCsharp } from '../src/lib/project/csharp.js'
import { parseDockerfile } from '../src/lib/project/dockerfile.js'
import { buildImage } from '../src/lib/project/build.js'

const programPath = 'src/Trainer.Api/Program.cs'

function savedProject(files = SOLUTION_FILES) {
  return { savedFiles: structuredClone(files), draftFiles: structuredClone(files), fileVersions: {}, diagnostics: [] }
}

function run(files = SOLUTION_FILES, nextSequence = 7) {
  return {
    labId: 'aca-guided-api', attemptId: 'attempt-1', contentVersion: 1, nextSequence,
    project: savedProject(files),
    artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
  }
}

function replaceProgram(text, from, to) {
  return { ...SOLUTION_FILES, [programPath]: SOLUTION_FILES[programPath].replace(from, to) }
}

function listenerProgram(files = SOLUTION_FILES) {
  return { ...files, [programPath]: files[programPath].replace('app.Run();', 'app.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);') }
}

describe('bounded Container Apps project files', () => {
  it('accepts a supported equivalent route with whitespace, comments, literal, member access, config lookup and anonymous response', () => {
    const files = replaceProgram(SOLUTION_FILES, 'app.MapGet("/api/info", () => Results.Ok(new { service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"] }));', `
      // Learner can use a block and a local configuration lookup.
      app . MapGet ( "/api/info" , () => {
        var environment = builder.Configuration [ "APP_ENV" ];
        return Results.Ok(new { environment, service = AppSettings.ServiceName });
      } );`)

    expect(parseProject(files)).toEqual({
      appSpec: {
        service: { source: 'AppSettings.ServiceName', value: 'contoso-api' },
        listeningPort: 8080,
        routes: [{ method: 'GET', path: '/api/info', response: {
          service: { kind: 'member', source: 'AppSettings.ServiceName', value: 'contoso-api' },
          environment: { kind: 'config', key: 'APP_ENV' },
        } }],
      },
      diagnostics: [],
    })
  })

  it('reports a changed fixed scaffold and an unknown executable statement with source positions', () => {
    const scaffold = replaceProgram(SOLUTION_FILES, 'var app = builder.Build();', 'var app = builder.Build(42);')
    const listener = 'app.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);'
    const unknown = replaceProgram(SOLUTION_FILES, listener, `Console.WriteLine("not supported");\n${listener}`)

    expect(parseProject(scaffold).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCAFFOLD_MODIFIED', path: programPath, line: expect.any(Number), column: expect.any(Number),
    }))
    expect(parseProject(unknown).diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_STATEMENT', path: programPath, line: 5, column: 1,
    }))

    const changedProject = { ...SOLUTION_FILES, 'src/Trainer.Api/Trainer.Api.csproj': '<Project />' }
    expect(parseProject(changedProject).diagnostics).toContainEqual(expect.objectContaining({
      code: 'SCAFFOLD_MODIFIED', path: 'src/Trainer.Api/Trainer.Api.csproj', line: expect.any(Number), column: expect.any(Number),
    }))

    const settingsStatement = { ...SOLUTION_FILES, 'src/Trainer.Api/AppSettings.cs': `${SOLUTION_FILES['src/Trainer.Api/AppSettings.cs']}Console.WriteLine("not supported");` }
    expect(parseProject(settingsStatement).diagnostics).toContainEqual(expect.objectContaining({
      code: 'UNSUPPORTED_STATEMENT', path: 'src/Trainer.Api/AppSettings.cs', line: expect.any(Number), column: expect.any(Number),
    }))
  })

  it('accepts a literal service when it matches the supported C# setting', () => {
    const files = replaceProgram(SOLUTION_FILES, 'AppSettings.ServiceName', '"a-different-service"')
    expect(parseProject(files)).toMatchObject({
      diagnostics: [],
      appSpec: { routes: [{ response: { service: { kind: 'literal', value: 'a-different-service' } } }] },
    })
  })

  it('accepts only typed C# grammar and detects malformed comments, strings, duplicate fields and invalid locals', () => {
    const quotedKeyword = replaceProgram(SOLUTION_FILES, 'using Trainer.Api;', '"using" Trainer.Api;')
    const duplicateField = replaceProgram(SOLUTION_FILES, 'service = AppSettings.ServiceName, environment', 'service = AppSettings.ServiceName, service = AppSettings.ServiceName, environment')
    const invalidLocal = replaceProgram(SOLUTION_FILES,
      '() => Results.Ok(new { service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"] })',
      '() => { var environment = "not-supported"; return Results.Ok(new { service = AppSettings.ServiceName, environment }); }')

    expect(parseProject(quotedKeyword).diagnostics).toContainEqual(expect.objectContaining({ code: 'SCAFFOLD_MODIFIED', path: programPath }))
    expect(parseProject(duplicateField).diagnostics).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_RESPONSE_FIELD', path: programPath }))
    expect(parseProject(invalidLocal).diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_LOCAL', path: programPath }))
    expect(lexCsharp('/*', programPath).diagnostics).toContainEqual(expect.objectContaining({ code: 'UNTERMINATED_COMMENT' }))
    expect(lexCsharp('"line\nbreak"', programPath).diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_STRING' }))
    expect(lexCsharp('"\\q"', programPath).diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_STRING' }))
    expect(lexCsharp('"a\\\"b"', programPath).tokens[0].value).toBe('a"b')
  })

  it('rejects quoted punctuation where the constrained grammar requires syntax tokens', () => {
    const quotedSettingsTerminator = {
      ...SOLUTION_FILES,
      'src/Trainer.Api/AppSettings.cs': SOLUTION_FILES['src/Trainer.Api/AppSettings.cs'].replace('"contoso-api";', '"contoso-api" ";"'),
    }
    const quotedPropertyEquals = replaceProgram(SOLUTION_FILES, 'service = AppSettings.ServiceName', 'service "=" AppSettings.ServiceName')
    const quotedMemberDot = replaceProgram(SOLUTION_FILES, 'AppSettings.ServiceName', 'AppSettings "." ServiceName')

    expect(parseProject(quotedSettingsTerminator).diagnostics).not.toEqual([])
    expect(parseProject(quotedPropertyEquals).diagnostics).not.toEqual([])
    expect(parseProject(quotedMemberDot).diagnostics).not.toEqual([])
  })

  it('rejects undeclared inherited Object names in response expressions and shorthands', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      const expression = replaceProgram(SOLUTION_FILES, 'environment = builder.Configuration["APP_ENV"]', `environment = ${name}`)
      const shorthand = replaceProgram(SOLUTION_FILES,
        '() => Results.Ok(new { service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"] })',
        `() => { var environment = builder.Configuration["APP_ENV"]; return Results.Ok(new { service = AppSettings.ServiceName, ${name} }); }`)
      expect(parseProject(expression).appSpec, name).toBeNull()
      expect(parseProject(expression).diagnostics, name).not.toEqual([])
      expect(parseProject(shorthand).appSpec, name).toBeNull()
      expect(parseProject(shorthand).diagnostics, name).not.toEqual([])
    }
  })

  it('derives the listening port from the supported Program configuration expression', () => {
    expect(parseProject(listenerProgram())).toMatchObject({ diagnostics: [], appSpec: { listeningPort: 8080 } })
  })

  it('rejects invalid settings, unknown paths, path traversal and file/token budgets before save mutation', () => {
    const project = savedProject()
    const invalidJson = saveProjectFile(project, 'src/Trainer.Api/appsettings.json', '{ broken')
    expect(invalidJson.project).toBe(project)
    expect(invalidJson.diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_JSON', path: 'src/Trainer.Api/appsettings.json', line: 1, column: 3 }))

    for (const [path, text, code] of [
      ['../Program.cs', 'x', 'INVALID_PATH'],
      ['unknown.txt', 'x', 'UNKNOWN_FILE'],
      [programPath, 'x'.repeat(PROJECT_MANIFEST.maxFileBytes + 1), 'FILE_TOO_LARGE'],
      [programPath, Array.from({ length: PROJECT_MANIFEST.maxTokens + 1 }, () => 'x').join(' '), 'TOKEN_LIMIT'],
    ]) {
      expect(saveProjectFile(project, path, text).diagnostics).toContainEqual(expect.objectContaining({ code, path }))
    }
  })

  it('returns diagnostics for missing or non-text manifest files instead of throwing', () => {
    const missingSettings = { ...SOLUTION_FILES }
    delete missingSettings['src/Trainer.Api/appsettings.json']
    expect(() => parseProject(missingSettings)).not.toThrow()
    expect(parseProject(missingSettings).diagnostics).toContainEqual(expect.objectContaining({ code: 'MISSING_FILE', path: 'src/Trainer.Api/appsettings.json' }))
    expect(parseProject({ ...SOLUTION_FILES, '.dockerignore': 42 }).diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_FILE', path: '.dockerignore' }))
  })
})

describe('supported Dockerfile and immutable builds', () => {
  it('recognizes the supported multi-stage .NET 10 Dockerfile and rejects unsupported instructions', () => {
    expect(parseDockerfile(SOLUTION_FILES.Dockerfile)).toEqual({
      dockerSpec: {
        sdkImage: 'mcr.microsoft.com/dotnet/sdk:10.0', runtimeImage: 'mcr.microsoft.com/dotnet/aspnet:10.0',
        projectPath: 'src/Trainer.Api/Trainer.Api.csproj', publishPath: '/app/publish',
        listeningPort: 8080, entrypoint: 'Trainer.Api.dll',
      }, diagnostics: [],
    })
    expect(parseDockerfile(`${SOLUTION_FILES.Dockerfile}\nRUN curl https://example.test`)
      .diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_DOCKER_INSTRUCTION', path: 'Dockerfile' }))
    expect(parseDockerfile(SOLUTION_FILES.Dockerfile.replace('dotnet publish', 'DOTNET publish'))
      .diagnostics).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_DOCKER_INSTRUCTION', path: 'Dockerfile' }))
  })

  it('builds only saved files into an immutable artifact and preserves an older artifact when retagged', () => {
    const first = buildImage(run(), { registryId: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/ContosoRegistry', loginServer: 'ContosoRegistry.azurecr.io', image: 'Api:V1' })
    expect(first.diagnostics).toEqual([])
    expect(first.nextSequence).toBe(8)
    expect(first.artifact).toMatchObject({
      id: 'build-7', sourceHash: expect.any(String), digest: expect.stringMatching(/^sha256:/),
      image: { registryId: '/subscriptions/x/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/ContosoRegistry', loginServer: 'contosoregistry.azurecr.io', repository: 'api', tag: 'V1' },
      appSpec: { listeningPort: 8080 }, dockerSpec: { listeningPort: 8080 }, diagnostics: [],
    })
    expect(first.artifacts.publishedTags['contosoregistry.azurecr.io/api:V1']).toBe('build-7')

    const rebuilt = buildImage({ ...run(), nextSequence: 8, artifacts: first.artifacts }, { registryId: first.artifact.image.registryId, loginServer: 'CONTOSOREGISTRY.azurecr.io', image: 'api:V1' })
    expect(rebuilt.artifacts.buildsById['build-7']).toEqual(first.artifact)
    expect(rebuilt.artifacts.buildsById['build-8']).not.toBe(first.artifact)
    expect(rebuilt.artifacts.publishedTags['contosoregistry.azurecr.io/api:V1']).toBe('build-8')
  })

  it('excludes drafts and leaves artifacts and sequence unchanged when validation fails', () => {
    const current = run()
    const settingsPath = 'src/Trainer.Api/AppSettings.cs'
    current.project.draftFiles[settingsPath] = current.project.draftFiles[settingsPath].replace('contoso-api', 'draft-only')
    expect(current.project.draftFiles[settingsPath]).toContain('draft-only')
    expect(current.project.savedFiles[settingsPath]).toContain('contoso-api')
    const built = buildImage(current, { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' })
    expect(built.artifact.appSpec.service.value).toBe('contoso-api')

    const invalid = buildImage(run({ ...SOLUTION_FILES, Dockerfile: 'FROM alpine\nRUN echo unsafe' }), { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' })
    expect(invalid.artifact).toBeNull()
    expect(invalid.artifacts).toEqual({ buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} })
    expect(invalid.nextSequence).toBe(7)
    expect(invalid.diagnostics).not.toEqual([])

    for (const options of [
      { registryId: 'registry-id', loginServer: 'bad registry/host', image: 'api:v1' },
      { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:bad tag' },
      { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api//nested:v1' },
    ]) {
      const rejected = buildImage(run(), options)
      expect(rejected.artifact).toBeNull()
      expect(rejected.artifacts.publishedTags).toEqual({})
      expect(rejected.diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_IMAGE' }))
    }
  })

  it('keeps the starter intentionally incomplete and supplies a buildable worked answer', () => {
    expect(SOLUTION_FILES['src/Trainer.Api/Trainer.Api.csproj']).toContain('<ImplicitUsings>enable</ImplicitUsings>')
    expect(SOLUTION_FILES[programPath]).toContain('app.Run("http://0.0.0.0:" + builder.Configuration["ListeningPort"]);')
    expect(parseDockerfile(STARTER_FILES.Dockerfile).diagnostics).not.toEqual([])
    expect(buildImage(run(SOLUTION_FILES), { registryId: 'registry-id', loginServer: 'registry.azurecr.io', image: 'api:v1' }).diagnostics).toEqual([])
  })
})

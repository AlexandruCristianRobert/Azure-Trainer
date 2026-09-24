function diagnostic(code, message, line = 1, column = 1) { return { code, message, path: 'Dockerfile', line, column } }
function keyword(word) { return word.split('').map((letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).join('') }

export function parseDockerfile(text) {
  if (typeof text !== 'string') return { dockerSpec: null, diagnostics: [diagnostic('INVALID_DOCKERFILE', 'Dockerfile must be text.')] }
  const lines = text.split(/\r?\n/); const meaningful = []
  lines.forEach((raw, index) => { const value = raw.trim(); if (value && !value.startsWith('#')) meaningful.push({ value, line: index + 1 }) })
  const expected = [
    new RegExp(`^${keyword('FROM')}\\s+(mcr\\.microsoft\\.com/dotnet/sdk:10\\.0)\\s+${keyword('AS')}\\s+build$`),
    new RegExp(`^${keyword('WORKDIR')}\\s+/src$`),
    new RegExp(`^${keyword('COPY')}\\s+src/Trainer\\.Api/Trainer\\.Api\\.csproj\\s+src/Trainer\\.Api/$`),
    new RegExp(`^${keyword('RUN')}\\s+dotnet\\s+restore\\s+src/Trainer\\.Api/Trainer\\.Api\\.csproj$`),
    new RegExp(`^${keyword('COPY')}\\s+\\.\\s+\\.$`),
    new RegExp(`^${keyword('RUN')}\\s+dotnet\\s+publish\\s+src/Trainer\\.Api/Trainer\\.Api\\.csproj\\s+-c\\s+Release\\s+-o\\s+(/app/publish)$`),
    new RegExp(`^${keyword('FROM')}\\s+(mcr\\.microsoft\\.com/dotnet/aspnet:10\\.0)\\s+${keyword('AS')}\\s+final$`),
    new RegExp(`^${keyword('WORKDIR')}\\s+/app$`),
    new RegExp(`^${keyword('ENV')}\\s+ASPNETCORE_HTTP_PORTS=(\\d+)$`),
    new RegExp(`^${keyword('COPY')}\\s+--from=build\\s+/app/publish\\s+\\.$`),
    new RegExp(`^${keyword('ENTRYPOINT')}\\s+\\[\\s*"dotnet"\\s*,\\s*"([^"\\\\]+)"\\s*\\]$`),
  ]
  const diagnostics = []
  if (meaningful.length !== expected.length) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Dockerfile must contain only the supported multi-stage instructions.', meaningful[Math.min(meaningful.length, expected.length)]?.line ?? 1))
  for (let index = 0; index < Math.min(meaningful.length, expected.length); index++) {
    if (!expected[index].test(meaningful[index].value)) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Unsupported Dockerfile instruction or order.', meaningful[index].line))
  }
  if (diagnostics.length) return { dockerSpec: null, diagnostics }
  const port = Number(expected[8].exec(meaningful[8].value)[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { dockerSpec: null, diagnostics: [diagnostic('INVALID_PORT', 'ASPNETCORE_HTTP_PORTS must be a valid port.', meaningful[8].line)] }
  const entrypoint = expected[10].exec(meaningful[10].value)[1]
  if (entrypoint !== 'Trainer.Api.dll') return { dockerSpec: null, diagnostics: [diagnostic('INVALID_ENTRYPOINT', 'The supported entrypoint is Trainer.Api.dll.', meaningful[10].line)] }
  return { dockerSpec: { sdkImage: expected[0].exec(meaningful[0].value)[1].toLowerCase(), runtimeImage: expected[6].exec(meaningful[6].value)[1].toLowerCase(), projectPath: 'src/Trainer.Api/Trainer.Api.csproj', publishPath: expected[5].exec(meaningful[5].value)[1], listeningPort: port, entrypoint }, diagnostics: [] }
}

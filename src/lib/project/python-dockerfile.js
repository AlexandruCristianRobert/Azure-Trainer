function diagnostic(code, message, line = 1, column = 1) { return { code, message, path: 'Dockerfile', line, column } }
export function parsePythonDockerfile(text, { buildFiles = ['app.py', 'server.py', 'Dockerfile'], installInstruction } = {}) {
  if (typeof text !== 'string') return { dockerSpec: null, diagnostics: [diagnostic('INVALID_DOCKERFILE', 'Dockerfile must be text.')] }
  const lines = text.split(/\r?\n/).map((raw, index) => ({ value: raw.trim(), line: index + 1 })).filter(item => item.value && !item.value.startsWith('#'))
  // A trusted manifest can supply one exact dependency-install scaffold.
  // Remove it only in its prescribed position, then retain the same parser.
  // Any extra/changed RUN still fails the normal instruction/order checks.
  if (installInstruction !== undefined) {
    if (lines[2]?.value !== installInstruction) return { dockerSpec: null, diagnostics: [diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Dockerfile must use the supplied dependency installation instruction after WORKDIR.', lines[2]?.line ?? 1)] }
    lines.splice(2, 1)
  }
  const expected = ['FROM', 'WORKDIR', 'COPY', 'EXPOSE', 'CMD']; const diagnostics = []
  if (lines.length !== expected.length) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Dockerfile must contain only the supported Python instructions.', lines[Math.min(lines.length, expected.length)]?.line ?? 1))
  for (let index = 0; index < Math.min(lines.length, expected.length); index++) if (!new RegExp(`^${expected[index]}\\b`, 'i').test(lines[index].value)) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Unsupported Dockerfile instruction or order.', lines[index].line))
  if (diagnostics.length) return { dockerSpec: null, diagnostics }
  if (!/^FROM\s+python:3\.12-slim$/i.test(lines[0].value) || !/^WORKDIR\s+\/app$/i.test(lines[1].value)) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'Only the taught Python base image and work directory are supported.', lines[0].line))
  const copy = /^COPY\s+(.+?)\s+(\.\/|\.)$/i.exec(lines[2].value)
  if (!copy) diagnostics.push(diagnostic('UNSUPPORTED_DOCKER_INSTRUCTION', 'COPY must copy named build files into /app.', lines[2].line))
  else { const sources = copy[1].trim().split(/\s+/); if (sources.some(source => !buildFiles.includes(source))) diagnostics.push(diagnostic('UNSUPPORTED_COPY_SOURCE', 'COPY sources must be declared build files.', lines[2].line)); const required = buildFiles.filter(path => path !== 'Dockerfile'); if (required.some(path => !sources.includes(path))) diagnostics.push(diagnostic('MISSING_COPY_SOURCE', 'COPY must include all required Python runtime files.', lines[2].line)) }
  const portMatch = /^EXPOSE\s+(\d+)$/i.exec(lines[3].value)
  if (!portMatch || Number(portMatch[1]) < 1 || Number(portMatch[1]) > 65535) diagnostics.push(diagnostic('INVALID_PORT', 'EXPOSE must declare a valid port.', lines[3].line))
  if (!/^CMD\s+\[\s*["']python["']\s*,\s*["']server\.py["']\s*\]$/i.test(lines[4].value)) diagnostics.push(diagnostic('INVALID_ENTRYPOINT', 'The supported entrypoint is python server.py.', lines[4].line))
  if (diagnostics.length) return { dockerSpec: null, diagnostics }
  return { dockerSpec: { baseImage: 'python:3.12-slim', workingDirectory: '/app', listeningPort: Number(portMatch[1]), entrypoint: ['python', 'server.py'] }, diagnostics: [] }
}

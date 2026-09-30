import { parseProject } from './files.js'
import { parseDockerfile } from './dockerfile.js'
import { getProjectManifest } from './manifests.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
function hash(text) {
  let first = 0x811c9dc5; let second = 0x9e3779b9
  for (let index = 0; index < text.length; index++) { first = Math.imul(first ^ text.charCodeAt(index), 0x01000193) >>> 0; second = Math.imul(second ^ first, 0x85ebca6b) >>> 0 }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`.repeat(4)
}
function snapshot(files) { return JSON.stringify(Object.fromEntries(Object.keys(files).sort().map((path) => [path, files[path]]))) }
export function projectSourceHash(files) { return `src-${hash(snapshot(files))}` }
function imageReference(loginServer, image) {
  if (typeof loginServer !== 'string' || typeof image !== 'string') return null
  if (!/^[a-z0-9]{5,50}\.azurecr\.io$/i.test(loginServer)) return null
  const match = /^([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*):([a-z0-9_][a-z0-9_.-]{0,127})$/i.exec(image)
  if (!match) return null
  return { loginServer: loginServer.toLowerCase(), repository: match[1].toLowerCase(), tag: match[2], key: `${loginServer.toLowerCase()}/${match[1].toLowerCase()}:${match[2]}` }
}

export function buildImage(run, { registryId, loginServer, image, file = 'Dockerfile', context = '.' } = {}) {
  const artifacts = clone(run?.artifacts ?? { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} })
  const files = run?.project?.savedFiles ?? {}; const diagnostics = []
  if (file !== 'Dockerfile' || context !== '.') diagnostics.push({ code: 'UNSUPPORTED_BUILD_CONTEXT', message: 'Builds support Dockerfile and local context only.', path: file, line: 1, column: 1 })
  const reference = imageReference(loginServer, image)
  if (!registryId || !reference) diagnostics.push({ code: 'INVALID_IMAGE', message: 'A registry and repository:tag image are required.', path: 'Dockerfile', line: 1, column: 1 })
  const project = parseProject(files, getProjectManifest(run?.project?.manifestId)); const docker = parseDockerfile(files.Dockerfile)
  diagnostics.push(...project.diagnostics, ...docker.diagnostics)
  if (!diagnostics.length && project.appSpec.listeningPort !== docker.dockerSpec.listeningPort) diagnostics.push({ code: 'PORT_MISMATCH', message: 'Application and Dockerfile listening ports must match.', path: 'Dockerfile', line: 1, column: 1 })
  if (diagnostics.length) return { artifacts, artifact: null, diagnostics, nextSequence: run?.nextSequence }
  const sourceHash = projectSourceHash(files); const id = `build-${run.nextSequence}`
  const artifact = {
    id, sourceHash, digest: `sha256:${hash(`${sourceHash}:${reference.key}`)}`,
    image: { registryId, loginServer: reference.loginServer, repository: reference.repository, tag: reference.tag },
    appSpec: clone(project.appSpec), dockerSpec: clone(docker.dockerSpec), diagnostics: [],
  }
  artifacts.sourceSnapshotsByHash[sourceHash] = { hash: sourceHash, files: clone(files) }
  artifacts.buildsById[id] = clone(artifact)
  artifacts.publishedTags[reference.key] = id
  return { artifacts, artifact: clone(artifact), diagnostics: [], nextSequence: run.nextSequence + 1 }
}

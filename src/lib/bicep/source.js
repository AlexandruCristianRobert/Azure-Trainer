import { AzError } from '../sandbox/errors.js'
import { getProjectManifest } from '../project/manifests.js'
import { bicepRootPath, parseBicepProject } from './parser.js'

function hash(text) {
  let first = 0x811c9dc5; let second = 0x9e3779b9
  for (const character of text) {
    first = Math.imul(first ^ character.charCodeAt(0), 0x01000193) >>> 0
    second = Math.imul(second ^ first, 0x85ebca6b) >>> 0
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

export function bicepSourceTuple(run, parameterPath = 'infra/first.bicepparam') {
  const files = run.project.savedFiles
  const manifest = getProjectManifest(run.project.manifestId)
  if (!manifest.bicepFiles?.includes(parameterPath) || !parameterPath.endsWith('.bicepparam'))
    throw new AzError('UnsupportedOperation', 'Select a manifest-listed local parameter file.', { kind: 'cli' })
  const paths = manifest.bicepRoots
    ? parseBicepProject(files, manifest, parameterPath).sourcePaths
    : [...manifest.bicepFiles.filter(path => path.endsWith('.bicep')), parameterPath]
  const sourceFiles = Object.fromEntries(paths.filter(path => path.endsWith('.bicep')).sort().map(path => [path, files[path]]))
  return { sourceHash: hash(JSON.stringify(sourceFiles)), parameterHash: hash(files[parameterPath]),
    fileVersions: Object.fromEntries(paths.map(path => [path, run.project.fileVersions[path] ?? 0])),
    ...(manifest.bicepRoots ? { templatePath: bicepRootPath(manifest, parameterPath) } : {}) }
}

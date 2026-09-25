import { describe, expect, it } from 'vitest'
import { FOUNDATION_FILES, FOUNDATION_MANIFEST } from '../src/data/templates/aks-python/foundation.js'
import { parsePythonDockerfile } from '../src/lib/project/python-dockerfile.js'
import { buildImage, projectSourceHash, selectBuildFiles } from '../src/lib/project/build.js'

const run = (files = FOUNDATION_FILES, drafts = files) => ({ nextSequence: 1,
  project: { manifestId: FOUNDATION_MANIFEST.id, savedFiles: files, draftFiles: drafts },
  artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } })
const build = (state) => buildImage(state, { registryId: 'registry-id', loginServer: 'aksregistry.azurecr.io', image: 'assistant:v1' })

describe('Python immutable build sources', () => {
  it('excludes deployment YAML from a Python image source hash', () => {
    const before = selectBuildFiles(FOUNDATION_FILES, FOUNDATION_MANIFEST)
    const after = selectBuildFiles({ ...FOUNDATION_FILES, 'k8s/deployment.yaml': 'not yet valid yaml: [' }, FOUNDATION_MANIFEST)
    expect(projectSourceHash(before)).toBe(projectSourceHash(after))
  })

  it('publishes only selected saved build files and ignores draft-only edits', () => {
    const first = build(run())
    expect(first.diagnostics).toEqual([])
    expect(first.artifacts.sourceSnapshotsByHash[first.artifact.sourceHash].files).toEqual(selectBuildFiles(FOUNDATION_FILES, FOUNDATION_MANIFEST))
    const yamlEdit = build(run({ ...FOUNDATION_FILES, 'k8s/deployment.yaml': 'bad: [' }))
    expect(yamlEdit.artifact.sourceHash).toBe(first.artifact.sourceHash)
    const sourceEdit = build(run({ ...FOUNDATION_FILES, 'app.py': FOUNDATION_FILES['app.py'].replace('"0.1"', '"1.0"') }))
    expect(sourceEdit.artifact.sourceHash).not.toBe(first.artifact.sourceHash)
    const draft = { ...FOUNDATION_FILES, 'app.py': 'not saved' }
    expect(build(run(FOUNDATION_FILES, draft)).artifact.sourceHash).toBe(first.artifact.sourceHash)
  })

  it('rejects missing source, disallowed COPY, entrypoint, and port mismatches without publishing', () => {
    expect(build(run({ ...FOUNDATION_FILES, 'app.py': undefined })).artifact).toBeNull()
    expect(parsePythonDockerfile(FOUNDATION_FILES.Dockerfile.replace('app.py server.py', 'app.py k8s/deployment.yaml')).diagnostics.map(item => item.code)).toContain('UNSUPPORTED_COPY_SOURCE')
    expect(build(run({ ...FOUNDATION_FILES, Dockerfile: FOUNDATION_FILES.Dockerfile.replace('server.py"]', 'app.py"]') })).artifact).toBeNull()
    expect(build(run({ ...FOUNDATION_FILES, Dockerfile: FOUNDATION_FILES.Dockerfile.replace('EXPOSE 8080', 'EXPOSE 9090') })).artifact).toBeNull()
  })
})

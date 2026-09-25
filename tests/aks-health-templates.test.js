import { describe, expect, it } from 'vitest'
import { HEALTH_MANIFEST, HEALTH_FILES, HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'
import { HEALTH_FIXTURES } from '../src/data/fixtures/aks/health.js'
import { parsePythonProject } from '../src/lib/project/python.js'
import { parsePythonDockerfile } from '../src/lib/project/python-dockerfile.js'
import { parseKubernetesYaml } from '../src/lib/kubernetes/yaml.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'

describe('AKS health teaching templates', () => {
  it('extends the complete integration project and copies the frozen health adapter into the image', () => {
    expect(HEALTH_MANIFEST.files).toHaveLength(13)
    expect(HEALTH_MANIFEST.files).toContain('training_health.py')
    expect(HEALTH_MANIFEST.buildFiles).toContain('training_health.py')
    expect(HEALTH_MANIFEST.fixedFiles['training_health.py']).toBe(HEALTH_SOLUTION_FILES['training_health.py'])
    expect(HEALTH_SOLUTION_FILES['training_health.py']).toMatch(/Training-only adapter[\s\S]*performs no network calls/)
    expect(HEALTH_SOLUTION_FILES['app.py']).toContain('def answer(question):')
    expect(HEALTH_SOLUTION_FILES.Dockerfile).toContain('COPY app.py server.py training_clients.py training_health.py retrieval.sql ./')
    expect(parsePythonDockerfile(HEALTH_SOLUTION_FILES.Dockerfile, { buildFiles: HEALTH_MANIFEST.buildFiles }).diagnostics).toEqual([])
    expect(parsePythonProject(HEALTH_SOLUTION_FILES, HEALTH_MANIFEST)).toMatchObject({ diagnostics: [], appSpec: { health: { version: 1 } } })
  })

  it('provides learner files with health stubs while preserving the answer integration', () => {
    expect(HEALTH_FILES['app.py']).toContain('def answer(question):')
    expect(HEALTH_FILES['app.py']).toContain('def startup():')
    expect(HEALTH_FILES['app.py']).toContain('return {"status": 503')
    expect(HEALTH_FILES['app.py']).not.toBe(HEALTH_SOLUTION_FILES['app.py'])
  })

  it('supplies a valid complete Deployment with all three health probes', () => {
    const parsed = parseKubernetesYaml(HEALTH_SOLUTION_FILES['k8s/deployment.yaml'], 'k8s/deployment.yaml')
    expect(parsed.diagnostics).toEqual([])
    const validated = validateKubernetesObject(parsed.documents[0], {
      namespace: 'assistant',
      capabilities: { kubernetes: true, kubernetesConfiguration: true, kubernetesProbes: true },
    })
    expect(validated.diagnostics).toEqual([])
    const container = validated.object.spec.template.spec.containers[0]
    expect(container.startupProbe.httpGet.path).toBe('/health/startup')
    expect(container.readinessProbe.httpGet.path).toBe('/health/ready')
    expect(container.livenessProbe.httpGet.path).toBe('/health/live')
    expect(container.imagePullPolicy).toBe('Always')
    expect(validated.object.spec.template.spec.terminationGracePeriodSeconds).toBe(1)
  })

  it('declares fixed, source-independent initialization and outage fixture facts', () => {
    expect(HEALTH_FIXTURES).toMatchObject({ version: 1, initializationSeconds: 24 })
    expect(HEALTH_FIXTURES.signalNames).toEqual(['initialized', 'accepting_requests', 'postgres_available', 'ai_available'])
    expect(HEALTH_FIXTURES.scenarios).toMatchObject({
      temporaryAdmissionClosure: { startAfterStartSeconds: 5, endAfterStartSeconds: 20, sampleAtSeconds: [9, 25], finishAfterStartSeconds: 30 },
      processHang: { startAfterStartSeconds: 5, endOnContainerTermination: true, firstSampleAfterStartSeconds: 9, sampleIntervalSeconds: 5, maxSamples: 20, finishAfterStartSeconds: 100 },
      optionalAiOutage: { startAfterStartSeconds: 5, endAfterStartSeconds: 35, sampleAtSeconds: [10, 12, 40], finishAfterStartSeconds: 45 },
      requiredPostgresOutage: { startAfterStartSeconds: 5, endAfterStartSeconds: 25, sampleAtSeconds: [10, 30], finishAfterStartSeconds: 35 },
      optionalAiCoupling: { startAfterStartSeconds: 5, endAfterStartSeconds: 35, sampleAtSeconds: [6], finishAfterStartSeconds: 45 },
    })
  })
})

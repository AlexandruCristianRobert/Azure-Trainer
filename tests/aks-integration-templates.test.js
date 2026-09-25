import { describe, expect, it } from 'vitest'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { parsePythonDockerfile } from '../src/lib/project/python-dockerfile.js'
import { parseRetrievalSql } from '../src/lib/project/retrieval-sql.js'
import { execFileSync } from 'node:child_process'

describe('assistant integration teaching template', () => {
  it('ships complete immutable helpers and a valid SQL snapshot', () => {
    expect(Object.keys(INTEGRATION_SOLUTION_FILES)).toHaveLength(INTEGRATION_MANIFEST.files.length)
    expect(INTEGRATION_MANIFEST).toMatchObject({ id: 'aks-python-integration-v1', language: 'python', runtimeFamily: 'aks', integrationVersion: 1 })
    expect(INTEGRATION_MANIFEST.buildFiles).toEqual(['app.py', 'server.py', 'training_clients.py', 'retrieval.sql', 'Dockerfile'])
    expect(INTEGRATION_MANIFEST.fixedFiles['schema.sql']).toContain('CREATE EXTENSION IF NOT EXISTS vector;')
    expect(INTEGRATION_MANIFEST.fixedFiles['schema.sql']).toContain('embedding vector(3) NOT NULL')
    const server = INTEGRATION_MANIFEST.fixedFiles['server.py']
    expect(server).toContain('json.loads(self.rfile.read(length) or b"{}")')
    expect(server).toContain('not isinstance(request, dict) or not isinstance(request.get("question"), str)')
    expect(server).toContain('response = app.answer(request["question"])')
    expect(server).not.toContain('request["question"].strip()')
    expect(server).toContain('if self.path != "/api/info":')
    expect(server).toContain('HTTPServer(("0.0.0.0", app.PORT), Handler).serve_forever()')
    expect(INTEGRATION_MANIFEST.fixedFiles['training_clients.py']).toContain('class RequestBudget')
    expect(INTEGRATION_MANIFEST.fixedFiles['training_clients.py']).not.toMatch(/\b(pass|NotImplementedError)\b/)
    expect(INTEGRATION_MANIFEST.fixedFiles['training_clients.py']).not.toMatch(/sleep\(|requests\.|urlopen\(/)
    expect(INTEGRATION_SOLUTION_FILES['app.py']).toContain('except DependencyError as error:')
    expect(INTEGRATION_SOLUTION_FILES['app.py']).toContain('"sources": [row["id"] for row in rows]')
    expect(INTEGRATION_SOLUTION_FILES['app.py']).toContain('"environment": cfg["environment"]')
    expect(INTEGRATION_SOLUTION_FILES['k8s/configmap.yaml']).not.toContain('settings.json')
    expect(INTEGRATION_SOLUTION_FILES['k8s/configmap.yaml']).toContain('AUDIENCE: employee')
    expect(INTEGRATION_SOLUTION_FILES['k8s/deployment.yaml']).toContain('key: PGPASSWORD')
    expect(parseRetrievalSql(INTEGRATION_SOLUTION_FILES['retrieval.sql']).diagnostics).toEqual([])
    expect(parsePythonDockerfile(INTEGRATION_SOLUTION_FILES.Dockerfile, { buildFiles: INTEGRATION_MANIFEST.buildFiles }).diagnostics).toEqual([])
  })

  it('keeps every reference file within the manifest byte limits', () => {
    const entries = Object.entries(INTEGRATION_SOLUTION_FILES)
    expect(entries.map(([name]) => name).sort()).toEqual([...INTEGRATION_MANIFEST.files].sort())
    expect(entries.every(([, source]) => Buffer.byteLength(source, 'utf8') <= INTEGRATION_MANIFEST.maxFileBytes)).toBe(true)
    expect(entries.reduce((size, [, source]) => size + Buffer.byteLength(source, 'utf8'), 0)).toBeLessThanOrEqual(INTEGRATION_MANIFEST.maxTotalBytes)
  })

  it('executes fixture retrieval, validation, profile selection and bounded retry timing', () => {
    const source = INTEGRATION_MANIFEST.fixedFiles['training_clients.py']
    const run = `import json\n${source}\n` + `
def answer_profile(profile_id):
    os.environ["SCENARIO_PROFILE"] = profile_id
    policy = RetryPolicy(3, ("THROTTLED", "UNAVAILABLE", "TIMEOUT"), 100, 200, 200)
    budget = RequestBudget(1000)
    ai = EmbeddingClient(endpoint="https://ai-training.example")
    db = PgClient(host="pg-training.example", database="knowledge", user="assistant_training", password="training-only-password")
    responder = AnswerClient(endpoint="https://ai-training.example")
    try:
        vector = budget.invoke(ai.embed, policy, question="How long are backups kept?", deployment="embeddings-v1")
        rows = budget.invoke(db.execute, policy, sql="SELECT id, content FROM documents WHERE collection = %(collection)s AND audience = %(audience)s AND published = %(published)s AND (embedding <=> %(embedding)s::vector) <= %(max_distance)s ORDER BY embedding <=> %(embedding)s::vector ASC, id ASC LIMIT %(limit)s", params={"collection":"training", "audience":"employee", "published":True, "embedding":as_vector(vector), "max_distance":0.2, "limit":1})
        context = [{"id":row["id"], "content":row["content"]} for row in rows]
        result = budget.invoke(responder.generate, policy, question="How long are backups kept?", context=context, deployment="answers-v1")
        return {"status":200, "elapsed":budget.elapsed_ms, "answer":result["answer"]}
    except DependencyError as error:
        return {"status":error.http_status, "code":error.code, "elapsed":budget.elapsed_ms}
` + `
training = FIXTURE_CATALOG["profiles"]["training"]
rows = PgClient(host=training["PGHOST"], database=training["PGDATABASE"], user=training["PGUSER"], password=training["PGPASSWORD"]).execute(
    "SELECT id, content FROM documents WHERE collection = %(collection)s AND audience = %(audience)s AND published = %(published)s AND (embedding <=> %(embedding)s::vector) <= %(max_distance)s ORDER BY embedding <=> %(embedding)s::vector ASC, id ASC LIMIT %(limit)s",
    {"collection":"training", "audience":"employee", "published":True, "embedding":"[1,0,0]", "max_distance":0.2, "limit":1})
answer = AnswerClient(endpoint=training["AI_ENDPOINT"]).generate("How long are backups kept?", [{"id": rows[0]["id"], "content": rows[0]["content"]}], "answers-v1")
profiles = {name:answer_profile(name) for name in FIXTURE_CATALOG["scenarioProfiles"]}
try:
    EmbeddingClient(endpoint=training["AI_ENDPOINT"]).embed("unknown", "embeddings-v1")
except DependencyError as error:
    unknown_code = error.code
try:
    as_vector([float("nan"), 0, 0])
except DependencyError as error:
    invalid_vector = error.code
print(json.dumps({"rows":[r["id"] for r in rows], "answer":answer, "unknown_code":unknown_code, "vector":as_vector([1,0,0]), "invalid_vector":invalid_vector, "profiles":profiles}))
`
    const output = execFileSync('python', ['-c', run], { encoding: 'utf8' })
    expect(JSON.parse(output)).toMatchObject({
      rows: ['training-backups'], answer: { answer: 'Training backups are kept for 30 days.' }, unknown_code: 'UNSUPPORTED_FIXTURE_INPUT',
      vector: '[1,0,0]', invalid_vector: 'VECTOR_DIMENSION',
      profiles: {
        healthy: { status: 200, elapsed: 120 },
        'embedding-throttle-once': { status: 200, elapsed: 310 },
        'postgres-unavailable-once': { status: 200, elapsed: 250 },
        'answer-unavailable-always': { status: 503, code: 'DEPENDENCY_UNAVAILABLE', elapsed: 520 },
        'embedding-timeout-always': { status: 504, code: 'DEPENDENCY_TIMEOUT', elapsed: 900 },
        'retry-after-too-long': { status: 504, code: 'DEADLINE_EXCEEDED', elapsed: 40 },
      },
    })
  })
})

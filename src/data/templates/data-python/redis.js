import { REDIS_RUNTIME_MANIFEST, REDIS_HELPER_FILES } from './redis-runtime.js'
import { REDIS_FIXTURES } from '../../fixtures/data/redis.js'

export const REDIS_PRODUCTS = Object.freeze([...new Set(Object.values(REDIS_FIXTURES.questions).map(question => question.product))])
export const REDIS_SOLUTION_FUNCTIONS = Object.freeze({
  cached_answer: `def cached_answer(question, product, version, language, ttl):
    key = response_key(question, product, version, language)
    cached = cache.get(key)
    if cached is not None:
        return decode_answer(cached)
    result = source_answer(question, product, version, language)
    cache.set(key, encode_answer(result), ex=ttl)
    return result
`,
  invalidate_product: `def invalidate_product(product):
    for key in cache.scan_iter(match="ka:answer:" + product + ":*"):
        cache.delete(key)
    for key in cache.scan_iter(match="ka:sem:" + product + ":*"):
        cache.delete(key)
`,
  remember_semantic: `def remember_semantic(question, product, version, language, result, ttl):
    key = semantic_key(question, product, version, language)
    cache.hset(key, mapping={"product": product, "version": version, "language": language,
        "embedding": pack_embedding(embed(question)), "payload": encode_answer(result)})
    cache.expire(key, ttl)
`,
  semantic_lookup: `def semantic_lookup(question, product, version, language, threshold):
    query = "(@product:{" + product + "} @version:{" + version + "} @language:{" + language + "})=>[KNN 1 @embedding $vec AS distance]"
    raw = cache.execute_command("FT.SEARCH", "idx:semantic", query, "PARAMS", 2,
        "vec", pack_embedding(embed(question)), "SORTBY", "distance", "ASC",
        "RETURN", 2, "payload", "distance", "DIALECT", 2)
    rows = decode_search(raw)
    for row in rows:
        if float(row["distance"]) <= threshold:
            return decode_answer(row["payload"])
    return None
`,
  answer: `def answer(question, product, version, language):
    exact = cache.get(response_key(question, product, version, language))
    if exact is not None:
        return decode_answer(exact)
    similar = semantic_lookup(question, product, version, language, 0.05)
    if similar is not None:
        return similar
    result = cached_answer(question, product, version, language, 60)
    remember_semantic(question, product, version, language, result, 60)
    return result
`,
})
const HEADER = `from clients import cache
from training_runtime import response_key, semantic_key, encode_answer, decode_answer, pack_embedding, decode_search, embed, source_answer

`
const CLIENTS = `import redis

# Fictional training-only access key. Never use this credential outside this Lab.
cache = redis.Redis(host="redis-assistant.eastus.redis.training.invalid", port=10000,
    password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)
`
const SERVER = `import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import app

PRODUCTS = ${JSON.stringify(REDIS_PRODUCTS)}

class Handler(BaseHTTPRequestHandler):
    def reply(self, result):
        body = json.dumps(result).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        value = lambda key: query.get(key, [""])[0]
        if url.path not in ("/cached", "/answer"):
            self.send_error(404)
            return
        question, product, version, language = [value(key) for key in ("question", "product", "version", "language")]
        if not question or len(question) > 8192 or product not in PRODUCTS or version not in ("v1", "v2") or language not in ("en", "de"):
            self.send_error(400)
            return
        if url.path == "/cached":
            try:
                ttl = int(value("ttl"))
            except ValueError:
                self.send_error(400)
                return
            if ttl < 1 or ttl > 300:
                self.send_error(400)
                return
            self.reply(app.cached_answer(question, product, version, language, ttl))
        else:
            self.reply(app.answer(question, product, version, language))

    def do_POST(self):
        if urlparse(self.path).path != "/invalidate":
            self.send_error(404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            product = body["product"]
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        if product not in PRODUCTS:
            self.send_error(400)
            return
        self.reply(app.invalidate_product(product))

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
`
const DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: assistant-api
  namespace: assistant
spec:
  replicas: 2
  selector:
    matchLabels:
      app: assistant-api
  template:
    metadata:
      labels:
        app: assistant-api
    spec:
      containers:
        - name: api
          image: acrassistant.azurecr.io/assistant:v1
          imagePullPolicy: Always
          ports:
            - name: http
              containerPort: 8080
`
const SERVICE = `apiVersion: v1
kind: Service
metadata:
  name: assistant-api
  namespace: assistant
spec:
  type: ClusterIP
  selector:
    app: assistant-api
  ports:
    - port: 80
      targetPort: http
`
const buildFiles = Object.freeze(['app.py', 'clients.py', 'training_runtime.py', 'server.py', 'Dockerfile'])
const kubernetesFiles = Object.freeze(['k8s/deployment.yaml', 'k8s/service.yaml'])
export const REDIS_MANIFEST = Object.freeze({
  ...REDIS_RUNTIME_MANIFEST,
  id: 'data-python-redis-v1', language: 'python', runtimeFamily: 'aks', dataApp: true,
  pythonInstallInstruction: 'RUN pip install redis',
  files: Object.freeze([...buildFiles, ...kubernetesFiles]), buildFiles, kubernetesFiles,
  fixedFiles: Object.freeze({ ...REDIS_HELPER_FILES, 'server.py': SERVER }),
  editZones: Object.freeze(Object.keys(REDIS_SOLUTION_FUNCTIONS)),
  routes: Object.freeze({ 'GET /cached': 'cached_answer', 'GET /answer': 'answer', 'POST /invalidate': 'invalidate_product' }),
  maxFiles: 16, maxFileBytes: 256 * 1024, maxTotalBytes: 512 * 1024, maxTokens: 50_000,
})
const COMMON = { ...REDIS_HELPER_FILES, 'clients.py': CLIENTS, 'server.py': SERVER,
  Dockerfile: 'FROM python:3.12-slim\nWORKDIR /app\nRUN pip install redis\nCOPY app.py clients.py training_runtime.py server.py ./\nEXPOSE 8080\nCMD ["python", "server.py"]\n',
  'k8s/deployment.yaml': DEPLOYMENT, 'k8s/service.yaml': SERVICE }
const signatures = ['cached_answer(question, product, version, language, ttl)', 'invalidate_product(product)', 'remember_semantic(question, product, version, language, result, ttl)', 'semantic_lookup(question, product, version, language, threshold)', 'answer(question, product, version, language)']
export const REDIS_STARTER_FILES = Object.freeze({ ...COMMON, 'app.py': HEADER + signatures.map(signature => `def ${signature}:\n    raise NotImplementedError("Lab task")\n`).join('\n\n') })
export const REDIS_SOLUTION_FILES = Object.freeze({ ...COMMON, 'app.py': HEADER + Object.values(REDIS_SOLUTION_FUNCTIONS).join('\n\n') })

import { REDIS_FIXTURES, redisEmbed, redisSourceAnswer } from '../../fixtures/data/redis.js'

export const REDIS_HELPER_ARITIES = Object.freeze({ response_key: [4], semantic_key: [4], encode_answer: [1], decode_answer: [1], pack_embedding: [1], decode_search: [1], embed: [1, 2], source_answer: [4] })
const normalize = text => text.trim().toLowerCase().replace(/\s+/g, ' ')
const aliases = Object.fromEntries(Object.entries(REDIS_FIXTURES.aliases).map(([text, entry]) => [normalize(text), normalize(entry.of)]))
const texts = [...Object.keys(REDIS_FIXTURES.questions), ...Object.keys(REDIS_FIXTURES.paraphrases), ...Object.keys(REDIS_FIXTURES.nearMisses)]
const vectors = Object.fromEntries(texts.map(text => [normalize(text), redisEmbed(text)]))
const scopes = [...REDIS_FIXTURES.scopeVariants.map(entry => entry.scope), ...Object.values(REDIS_FIXTURES.questions).map(entry => ({ product: entry.product, version: 'v1', language: 'en' }))]
const answers = {}
for (const text of texts) for (const scope of scopes) for (const revision of [1, 2]) {
  const answer = redisSourceAnswer(scope, text, revision)
  if (answer) answers[[normalize(text), scope.product, scope.version, scope.language, revision].join('\u001f')] = answer
}

// These are executable Python counterparts of the bounded simulator helpers.
// Fixture maps are generated from the same immutable, scoped teaching source.
export const REDIS_HELPER_FILES = Object.freeze({ 'training_runtime.py': `import hashlib
import json
import struct

_ALIASES = ${JSON.stringify(aliases)}
_VECTORS = ${JSON.stringify(vectors)}
_ANSWERS = ${JSON.stringify(answers)}
SOURCE_REVISIONS = {}

def _normalize(question):
    return " ".join(question.strip().lower().split())

def response_key(question, product, version, language):
    digest = hashlib.sha256(_normalize(question).encode("utf-8")).hexdigest()
    return "ka:answer:" + product + ":" + version + ":" + language + ":" + digest

def semantic_key(question, product, version, language):
    digest = hashlib.sha256(_normalize(question).encode("utf-8")).hexdigest()
    return "ka:sem:" + product + ":" + version + ":" + language + ":" + digest

def encode_answer(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")

def decode_answer(value):
    return json.loads(value)

def pack_embedding(vector):
    return struct.pack("<8f", *vector)

def decode_search(raw):
    rows = []
    for position in range(1, len(raw), 2):
        fields = raw[position + 1]
        row = {}
        for offset in range(0, len(fields), 2):
            name = fields[offset].decode("utf-8") if isinstance(fields[offset], bytes) else fields[offset]
            row[name] = fields[offset + 1]
        rows.append(row)
    return rows

def embed(question, deployment="embeddings-v1"):
    text = _normalize(question)
    text = _ALIASES.get(text, text)
    vector = _VECTORS.get(text)
    if vector is None or deployment not in ("embeddings-v1", "embeddings-v2"):
        return None
    return list(vector) + ([0, 0, 0, 0] if deployment == "embeddings-v2" else [])

def source_answer(question, product, version, language):
    text = _normalize(question)
    text = _ALIASES.get(text, text)
    revision = SOURCE_REVISIONS.get(product, 1)
    key = "\\x1f".join([text, product, version, language, str(revision)])
    value = _ANSWERS.get(key)
    return json.loads(json.dumps(value))
` })

export const REDIS_RUNTIME_MANIFEST = Object.freeze({ dataBackend: 'redis', runtimeFiles: Object.freeze(['training_runtime.py']), runtimeFunctions: Object.freeze(Object.keys(REDIS_HELPER_ARITIES)), fixedFiles: REDIS_HELPER_FILES })

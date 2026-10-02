import { CAPSTONE_QUESTIONS, CAPSTONE_NO_MATCH, CAPSTONE_WHITESPACE_PATTERN, capstoneNormalize } from '../../fixtures/data/capstone.js'

export const CAPSTONE_HELPER_ARITIES = Object.freeze({ response_key: [4], semantic_key: [4], encode_answer: [1], decode_answer: [1], pack_embedding: [1], decode_search: [1], embed: [1, 2], training_answer: [2] })
const vectors = Object.fromEntries(CAPSTONE_QUESTIONS.map(q => [capstoneNormalize(q.text), q.vector]))
// Real executable Python mirrors the bounded JS codecs and context helper.
// No fixture answer/ID map is available to the application.
export const CAPSTONE_HELPER_FILES = Object.freeze({ 'training_runtime.py': `import hashlib
import json
import re
import struct

_VECTORS = ${JSON.stringify(vectors)}
_WHITESPACE = re.compile(r"${CAPSTONE_WHITESPACE_PATTERN}")

def _normalize(question):
    return _WHITESPACE.sub(" ", question).strip(" ").lower()

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
    if deployment != "embeddings-v1":
        return None
    return list(_VECTORS.get(_normalize(question), [0.0] * 8))

def training_answer(question, context):
    sources = context.get("sources", [])
    passages = context.get("passages", "")
    if not sources or not isinstance(passages, str) or not passages:
        return ${JSON.stringify(CAPSTONE_NO_MATCH)}
    return passages.split("\\n\\n")[0]
` })
export const CAPSTONE_RUNTIME_MANIFEST = Object.freeze({ helperProfile: 'capstone', runtimeFiles: Object.freeze(['training_runtime.py']), runtimeFunctions: Object.freeze(Object.keys(CAPSTONE_HELPER_ARITIES)), fixedFiles: CAPSTONE_HELPER_FILES })

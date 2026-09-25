export const KNOWLEDGE_FIXTURES = Object.freeze({
  version: 1,
  profiles: Object.freeze({
    training: Object.freeze({ AI_ENDPOINT: 'https://ai-training.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1', PGHOST: 'pg-training.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_training', PGPASSWORD: 'training-only-password', COLLECTION: 'training' }),
    review: Object.freeze({ AI_ENDPOINT: 'https://ai-review.example', ANSWER_DEPLOYMENT: 'answers-v1', EMBEDDING_DEPLOYMENT: 'embeddings-v1', PGHOST: 'pg-review.example', PGDATABASE: 'knowledge', PGUSER: 'assistant_review', PGPASSWORD: 'review-only-password', COLLECTION: 'review' }),
  }),
  questions: Object.freeze({
    'How long are backups kept?': Object.freeze({ vector: [1, 0, 0], sourceIds: Object.freeze({ training: 'training-backups', review: 'review-backups' }), answers: Object.freeze({ training: 'Training backups are kept for 30 days.', review: 'Review backups are kept for 7 days.' }) }),
    'Who provides support?': Object.freeze({ vector: [0, 1, 0], sourceIds: Object.freeze({ training: 'training-support', review: 'review-support' }), answers: Object.freeze({ training: 'Contact the training desk for support.', review: 'Contact the training desk for support.' }) }),
  }),
  documents: Object.freeze({
    'training-backups': Object.freeze({ vector: [1, 0, 0], text: 'Fictional training policy: keep backups for 30 days.', collection: 'training', answer: 'Training backups are kept for 30 days.' }),
    'training-support': Object.freeze({ vector: [0, 1, 0], text: 'Fictional support policy: contact the training desk.', collection: 'training', answer: 'Contact the training desk for support.' }),
    'review-backups': Object.freeze({ vector: [1, 0, 0], text: 'Fictional review policy: keep backups for 7 days.', collection: 'review', answer: 'Review backups are kept for 7 days.' }),
    'review-support': Object.freeze({ vector: [0, 1, 0], text: 'Fictional support policy: contact the training desk.', collection: 'review', answer: 'Contact the training desk for support.' }),
  }),
})

export function renderKnowledgeHelper(fixtures = KNOWLEDGE_FIXTURES) {
  const catalog = JSON.stringify({ version: fixtures.version, profiles: fixtures.profiles, questions: fixtures.questions, documents: fixtures.documents }, null, 4)
  return `"""Teaching fixture adapter. No network, database or model is called."""
import json
import math

FIXTURE_VERSION = ${fixtures.version}
FIXTURE_CATALOG = json.loads(r'''${catalog}''')

def fixed_embedding(question):
    """Return the authored vector for a supplied practice question."""
    fixture = FIXTURE_CATALOG["questions"].get(question)
    return fixture["vector"] if fixture else None

def cosine_similarity(left, right):
    """Compare two authored vectors without calling an embedding service."""
    numerator = sum(a * b for a, b in zip(left, right))
    left_size = math.sqrt(sum(value * value for value in left))
    right_size = math.sqrt(sum(value * value for value in right))
    return numerator / (left_size * right_size) if left_size and right_size else 0.0

def retrieve(question, collection):
    vector = fixed_embedding(question)
    if vector is None:
        return None
    documents = FIXTURE_CATALOG["documents"]
    matches = [
        (document_id, document)
        for document_id, document in documents.items()
        if document["collection"] == collection
    ]
    return max(matches, key=lambda item: cosine_similarity(vector, item[1]["vector"])) if matches else None

def validate_settings(settings):
    profiles = FIXTURE_CATALOG["profiles"].values()
    profile = next((item for item in profiles if item["AI_ENDPOINT"] == settings["ai_endpoint"]), None)
    if profile is None:
        return profile, {"status": 502, "body": {"error": "AI endpoint unavailable.", "code": "AI_ENDPOINT"}}
    if settings["embedding_deployment"] != profile["EMBEDDING_DEPLOYMENT"] or settings["answer_deployment"] != profile["ANSWER_DEPLOYMENT"]:
        return profile, {"status": 502, "body": {"error": "AI deployment unavailable.", "code": "AI_DEPLOYMENT"}}
    if settings["pg_host"] != profile["PGHOST"] or settings["pg_database"] != profile["PGDATABASE"]:
        return profile, {"status": 503, "body": {"error": "PostgreSQL connection unavailable.", "code": "POSTGRES_CONNECTION"}}
    if settings["pg_user"] != profile["PGUSER"] or settings["pg_password"] != profile["PGPASSWORD"]:
        return profile, {"status": 503, "body": {"error": "PostgreSQL authentication failed.", "code": "POSTGRES_AUTH"}}
    return profile, None

def answer(question, settings):
    profile, error = validate_settings(settings)
    if error:
        return error
    question_fixture = FIXTURE_CATALOG["questions"].get(question)
    if question_fixture is None:
        return {"status": 400, "body": {"error": "Unsupported supplied question."}}
    profile_name = settings["collection"]
    match = retrieve(question, profile_name)
    if match is None:
        return {"status": 200, "body": {"answer": "No matching documents.", "sources": [], "environment": settings["environment"], "displayName": settings["display_name"]}}
    document_id, document = match
    if document_id != question_fixture["sourceIds"].get(settings["collection"]):
        return {"status": 200, "body": {"answer": "No matching documents.", "sources": [], "environment": settings["environment"], "displayName": settings["display_name"]}}
    return {"status": 200, "body": {
        "answer": settings["response_prefix"] + document["answer"],
        "sources": [document_id],
        "environment": settings["environment"],
        "displayName": settings["display_name"],
    }}
`
}

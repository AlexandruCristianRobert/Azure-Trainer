# Task 1: Corpus fixtures

Create src/data/fixtures/data/corpus.js.
Export CORPUS { version: 1, logicalRows: { documents: 20000, chunks: 250000 }, documents, chunks }, corpusRows(), corpusQuestions().
Documents: id, product, version, language, metadata { product, version, language, audience, tags: [] }, body, updated_at.
Chunks: id, document_id, chunk_index, content, embedding number[8].
Author 16 fictional training documents covering contoso-backup and contoso-support × v1/v2 × en/de, each with 2 chunks (32 chunks). Include near-duplicate pair for recall checks.
Author 6 practice questions { text, product, version, language, vector: number[8], expectedChunkIds: string[], answer }. Each filtered top-2 cosine neighbours must equal expectedChunkIds. Include a question whose unfiltered top-1 belongs to the wrong product. Reuse cosine from knowledge.js.
Verify using a throwaway node script, no permanent test. Run npm.cmd run build. Commit feat(data): add PostgreSQL RAG corpus fixtures.
Global: browser-local simulation only; no real services. Never full suite, AKS/Container Apps tests or browser tests. Only plan-named data tests; none needed for fixture task. Commit only owned files. Do not spawn subagents.

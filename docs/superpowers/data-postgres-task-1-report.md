# Task 1 implementation report

Implemented `src/data/fixtures/data/corpus.js` in the `data-postgres` worktree.

## Deliverables

- `CORPUS` version 1 declares logical sizes of 20,000 documents and 250,000 chunks, while containing 16 visible documents and 32 chunks.
- Every product/version/language combination (`contoso-backup` / `contoso-support`, `v1` / `v2`, `en` / `de`) has two documents with two chunks each. Each document includes matching JSON metadata, audience, tags, body and a deterministic ISO timestamp.
- Six practice questions provide authored eight-dimensional vectors, filter fields, expected top-two chunk IDs and grounded fictional answers.
- Backup v2 English retention chunks 9 and 10 form a near-duplicate recall pair. The Backup v1 English retention question deliberately ranks Support chunk 17 first without metadata filtering; its filtered expected chunks are 1 and 2.
- `corpusRows()` returns `{ documents, chunks }` with independent metadata tags and embedding arrays. `corpusQuestions()` returns independent vectors and expected-ID arrays.

## Requirement ruling

The Task 1 brief describes expected chunk IDs as strings, but the Lab 5 SQL schema uses `bigint` primary and foreign keys. The controller explicitly directed numeric IDs to align with that schema. Document IDs are 1–16 and chunk IDs are 1–32; question expected IDs use the same numeric values. The IDs remain safely representable as JavaScript integers. Consumers must compare these IDs as numbers rather than assuming descriptive string IDs.

## Verification commands and results

Only the allowed throwaway fixture check and production build ran. No permanent test, full suite, AKS/Container Apps test or browser test was created or run. No dependency installation was needed; the worktree resolves dependencies from the root repository.

1. Initial `node --input-type=module -e '<assertion script>'`: exit 1, 2.856 seconds. Windows native argument handling stripped the inner quote characters, causing a JavaScript syntax error before fixture assertions executed. No fixture failure was indicated.
2. Corrected PowerShell here-string piped to `node --input-type=module`: exit 0, 0.447 seconds. Checked row counts, eight filter groups, unique IDs, metadata, timestamps, chunk membership and indexes, eight-dimensional finite vectors, all six ordered filtered cosine top-two results using the existing `cosine` from `knowledge.js`, a wrong-product unfiltered first result, near-duplicate cosine above 0.999, and independent returned copies.
3. Initial `npm.cmd run build`: exit 1. Vite transformed 514 modules but the restricted environment prevented creating the worktree `dist` directory (`EPERM`). Vite reported 9.94 seconds. No escalation was requested.
4. After the platform changed to unrestricted filesystem access and IDs were aligned to the bigint schema, the same here-string fixture check was rerun with numeric-ID assertions and numeric sorting for ties: exit 0, 0.143 seconds. All assertions passed, including safe integer IDs and exact expected result ordering.
5. Normal `npm.cmd run build` after that change: exit 0, 6.499 seconds wall time; Vite reported 5.26 seconds, with 514 modules transformed. The build emitted the existing large-bundle advisory (some chunks exceed 500 kB), with no build error.

The throwaway check lived only in command stdin and was not saved as a permanent test file.

## Self-review

Reviewed every Task 1 field and count against the brief. Passages and answers distinguish version-specific retention, restore, support coverage and escalation behavior, including German-language variants. Filtering uses the document product/version/language; chunks preserve the parent foreign key. The top-two neighbors have distinct cosine scores within each question filter, so expected order does not depend on tie-breaking. Metadata/vector mutation through the returned row APIs does not alter the canonical fixtures. The misleading Support embedding is explicitly documented as an authored teaching trap rather than an actual embedding output.

This task adds no services, network calls, SQL engine code or lab behavior. Its remaining integration consideration is the controller-approved numeric-ID deviation from the original string-ID annotation. The build verifies compilation of currently reachable code; the direct fixture import check verifies this newly added module itself.

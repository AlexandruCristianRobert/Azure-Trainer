# Task 3 report — bounded PostgreSQL SQL parser

Implemented `src/lib/data/pg-sql.js` (353 lines) and the five specified cases in `tests/data-pg-sql.test.js`. No dependencies installed. The progress ledger was read and its numeric-ID and accurate-attribution rulings followed; its existing changes are outside this commit.

The parser recognizes the task's CREATE EXTENSION/TABLE/INDEX, DROP INDEX, SET, INSERT, SELECT and EXPLAIN subset. This includes column constraints, identity/default-now metadata, one qualified equality JOIN, JSON text extraction and containment, IN, vector distance expressions and predicates, casts, expression/partial indexes, index options and multi-row INSERT. Unquoted names and keywords normalize to lowercase; quoted identifiers preserve case. Table aliases and projection AS aliases are represented for qualified retrieval. Cast targets are restricted to supported column types (including JSONB for literal inserts). Strings support doubled SQL quotes. Line and nested block comments are skipped; semicolons inside strings/comments do not split statements.

## Shared AST contract for engine/planner

`parsePgSql(text)` returns `{ statements: [...] }` or `{ error: { code, message, line, column } }`. No statement executes during parsing. Statements have these fields:

| Kind | Fields beyond `kind` |
| --- | --- |
| `create-extension` | `name`, `ifNotExists` |
| `create-table` | `name`, `ifNotExists`, `columns`, `primaryKey` (array for the optional table-level key) |
| `create-index` | `name`, `table`, `method` (defaults to `btree`), `columns`, `with` (option object), `where` (condition array), `concurrently`, `ifNotExists` |
| `drop-index` | `name`, `ifExists` |
| `set` | `name`, `value` |
| `insert` | `table`, `columns` (name strings), `rows` (arrays of values) |
| `select` | `table`, optional `alias`, `columns` (projection expressions), `joins`, `where`, `orderBy`, `limit` (null when omitted), optional `explain: { analyze: boolean }` |

Column definitions have `{ name, type, dimensions? }` plus optional `primaryKey`, `notNull`, `references: { table, column }`, `identity`, and `default: { kind: 'now' }`. The engine should account for both column-level `primaryKey: true` and the table-level `primaryKey` array. Index columns are `{ name, opclass? }` or `{ expression, opclass? }`; wrapped halfvec casts use the expression form.

SQL values are primitive strings/numbers/booleans/null or parameter/cast nodes. Vector and JSON strings stay strings until engine type handling; this parser does not decode or validate vector dimensions of literal values. Expressions are:

```js
{ kind: 'column', name, table? }
{ kind: 'star' }
{ kind: 'json-extract', column: columnExpression, key }
{ kind: 'cast', expression, type, dimensions? }
{ kind: 'distance', column: expression, operator: '<=>' | '<->' | '<#>', value }
```

Projection expressions may additionally carry `alias`. A cast's `expression` may be a primitive or another expression/parameter. Conditions are `{ expression, operator, value }`, or `{ expression, operator: 'in', values }`. A simple column condition additionally exposes `column: name` and optional `table` as convenient fields. Distance predicates put their distance expression under `expression`; the predicate comparison is their outer `operator`. JSON extraction predicates put the extraction expression under `expression`. All WHERE predicates in an array are combined with AND.

ORDER BY entries spread the expression fields and append `direction: 'ASC' | 'DESC'`. Thus a distance ordering exposes its distance `operator`, `column` expression and `value` directly. Joins are `{ table, alias?, on: { left: qualifiedColumn, right: qualifiedColumn, operator: '=' } }`.

Parameter nodes are `{ kind: 'param', style: 'positional', index }` for `%s`, `{ kind: 'param', style: 'named', name }` for `%(name)s`, or `{ kind: 'param', style: 'numbered', index }` for `$n`. Indices are zero-based and positional numbering restarts per statement. A repeated named/numbered placeholder resolves to the same supplied value.

`bindParams(stmt, params)` returns the cloned, bound statement directly (not a wrapper). It replaces parameter nodes with supplied data values without SQL interpolation or reparsing and preserves surrounding cast nodes. `%s`/`$n` require arrays; named parameters require a dictionary with each referenced own property. Positional counts must match (numbered count is the highest referenced number); missing/undefined values and mixed placeholder styles produce `{ error: { code: 'ProgrammingError', message } }`. Extra named dictionary keys are permitted. Statements with no placeholders permit omitted/null/empty parameters and reject extra positional values. Input statement objects are not mutated.

## Verification

Only the explicitly named test file was run. No full suite, AKS, Container Apps or browser tests were run.

| Step | Command | Result | Elapsed |
| --- | --- | --- | --- |
| Red before implementation | `npm.cmd test -- tests/data-pg-sql.test.js` | Exit 1: expected missing `pg-sql.js` module; one failed suite, no collected tests | 9.031 s command wall time (Vitest 2.57 s) |
| Green | `npm.cmd test -- tests/data-pg-sql.test.js` | Exit 0: 5/5 tests passed | 4.190 s command wall time (Vitest 1.21 s) |
| Build | `npm.cmd run build` | Exit 0: 519 modules transformed; production artifacts generated | Vite reported 11.94 s |
| Whitespace review | `git diff --check` | No whitespace errors; existing ledger CRLF advisory only | 0.596 s combined inspection command |

Existing Vite bundle-size advisory remains. The five tests protect the required table/index shape, filtered vector ordering, JSONB containment, binding count checks and unsupported-SQL classification. The broader grammar branches were reviewed in source rather than adding tests beyond the specified five; those branches retain that explicit coverage limitation.

## Self-review and concerns

Tokenization bounds input to 1,000,000 characters and 100,000 tokens, expressions to 32 nested levels, and parsing to 1,000 statements. Binding bounds traversal nesting to avoid crashing on invalid recursive statement objects. Unsupported statements/constructs return `DATA_UNSUPPORTED` with `Not supported by the simulator:`; unterminated quoted strings/identifiers and block comments return `SyntaxError` with one-based line/column. The distinction supports the later unsafe-interpolation lesson.

The parser preserves learner predicates and ordering explicitly; runtime consumers must evaluate those fields without post-filtering checks or independent SQL regex matching. Type/existence/constraint validation and vector/JSON decoding remain the engine's responsibility. Numeric literals stay JavaScript numbers, so bigint identifiers are suitable for the numeric corpus IDs but arbitrary integers beyond JavaScript exact precision are not promised. No external SQL execution, Azure/network calls, runtime routing or existing journey behavior changed.

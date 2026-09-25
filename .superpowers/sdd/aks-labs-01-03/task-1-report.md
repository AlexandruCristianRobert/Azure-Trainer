# Task 1 report: Python files and immutable image builds

Status: complete.

Implemented the Python AKS foundation template and fixed server adapter, a bounded Lezer AST projector for `app.py`, the supported Python Dockerfile parser, Python manifest registration, and Python-specific image source selection. The parser reads only the active `info()` return dictionary, resolves top-level literal constants, ignores comments, and reports syntax or unsupported constructs with source locations. Existing static file limits and fixed-file validation run before language-specific parsing. Python image hashes and saved artifact snapshots include only manifest `buildFiles`; draft edits and Kubernetes YAML do not affect the image source hash. The C# build path remains unchanged in behavior.

Added exact dependencies `@lezer/python@1.1.19` and `yaml@2.9.1`, plus focused project/build tests and `tests/helpers/aks.js`.

Validation evidence:

- `npm.cmd test -- tests/aks-python-project.test.js tests/aks-python-build.test.js tests/project-build.test.js tests/project-capstone.test.js tests/az-registry-identity.test.js` — 5 files, 37 tests passed.
- `npm.cmd test` — 90 files, 788 tests passed.
- `npm.cmd run build` — production build completed.
- `git diff --check` — passed.

Remaining concern: Vite reports the existing main JavaScript chunk is over 500 kB after minification. The build succeeds; chunk splitting is outside Task 1 scope.

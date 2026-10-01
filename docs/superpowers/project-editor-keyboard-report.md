# Project editor keyboard report

Implemented the approved keyboard behavior in `ProjectEditor.vue` and a reusable pure text-edit helper. Tab indents the current row or selected rows; Shift+Tab removes up to one indent unit or a leading tab. Python/C# use four spaces; other files use two. A selection ending at the next row's start excludes that row. Selection endpoints and direction remain with the edited text.

Enter replaces a selection, preserves the pre-caret row indentation, and adds one Python indent when the actual pre-caret code ends in a colon. A small line-local quote/comment scan ignores trailing comments while retaining quoted `#` characters. The helper preserves CRLF for CRLF input. This is intentionally not a parser, formatter, or automatic dedenter; multiline string context is outside its scope.

The component writes through the existing `edit()` draft dispatch and error handling. Its keyboard boundary checks the existing locked/fixed guards, IME composition, and modifier keys. Selection restoration waits for Vue's next tick and checks the file, lab, attempt, text, focus, and locked/fixed state. Escape followed by Tab or Shift+Tab allows native focus navigation; a short accessible hint describes the shortcuts.

## Verification

- Initial RED: `npm.cmd test -- tests/project-editor-keyboard.test.js` against the null-returning helper stub: six expected behavior failures, one native-key case passed; exit 1, Vitest duration 313 ms.
- Helper GREEN: the same command: seven tests passed; exit 0, duration 354 ms.
- Added one focused actual SFC setup/handler boundary test without a browser or custom DOM host. Temporarily disabling the handler produced the expected missing-preventDefault failure (seven passed, one failed); exit 1, duration 411 ms. Restored the handler before final verification. This is a mutation check, not a claim that the boundary test preceded its implementation.
- Final `npm.cmd test -- tests/project-editor-keyboard.test.js`: eight passed, zero failed; exit 0, duration 478 ms.
- `npm.cmd run build`: exit 0, 536 modules transformed, Vite build duration 4.05 s. The existing large-chunk advisory remains (chunks above 500 kB).
- `git diff --check`: exit 0, no whitespace errors.

Active implementation and verification took approximately three minutes. Verification remained limited to this focused test file and the production build, following the user's explicit lightweight-test instruction. No dependency installation, real network/Azure/Python execution, full suites, or unrelated lab tests were used.

## Self-review

Reviewed row boundary exclusion, literal caret/selection mappings, partial unindent, quoted comments, pre-caret-only colon detection, CRLF, editable-key dispatch, native Escape/modifier/IME keys, read-only/fixed guards, and stale restoration after switching files. Existing save/error paths remain in place. Used APIs compatible with the declared Node 18 minimum. Changes are confined to the helper, component wiring/hint, eight focused tests, and this report. Terminal/pool work, controller handoff files, main, and remote branches are outside this commit. No blocking concerns; browser behavior was not exercised.

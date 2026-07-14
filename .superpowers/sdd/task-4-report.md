# Task 4 Report

## Scope

Implemented only the My Recall domain records, SafetyKorea v2.0 HTTPS adapter, matching engine, fixtures, and focused tests.

## TDD Record

### Red

Command:

```sh
cd naekkeo-recall && npm test -- test/safety-korea-api.test.ts test/matcher.test.ts
```

The first run exited 1 before production code existed, with the expected missing-module failures:

```text
Cannot find module '../src/safety-korea-api.js'
Cannot find module '../src/matcher.js'
```

After adding the base implementation, the v2.0 field-preservation expectations were added to the fixtures and parser tests. The focused API test then exited 1 because `recallMeans`, barcode, inquiry phone, accident details, and the documented certification fields were not yet mapped. Those fields were subsequently added to the typed domain records and parser.

### Green

Command:

```sh
cd naekkeo-recall && npm test && npm run typecheck && git diff --check
```

Output:

```text
Test Files  3 passed (3)
Tests  17 passed (17)
tsc --noEmit: exit 0
git diff --check: exit 0
```

## Implementation

- The adapter is limited to the two required HTTPS SafetyKorea list endpoints.
- Requests use the case-sensitive `AuthKey` header and a 2,000ms `AbortSignal` deadline.
- Product, model, and certification-number searches use the documented v2.0 `conditionKey` values.
- Both string and numeric `2000` result codes are accepted; malformed successful payloads are rejected.
- The parser uses the documented `resultData` array and preserves core recall and certification fields used for matching and follow-up actions.
- Without a service ID, the adapter makes no request and exposes `availability: "unavailable"`.
- Matching normalizes Korean and ASCII text, confirms only a unique exact certification-number match, marks model/product token candidates as `needs_confirmation`, and returns the required non-guarantee wording for `no_match`.

## Remaining Risk

Fixtures follow the published SafetyKorea Open API interface design v2.0, but a live request still requires a runtime-issued service ID. Production validation should confirm provider availability, result-code behavior, and field completeness with that credential.

## Review Finding Remediation

### Red

`cd naekkeo-recall && npm test -- test/matcher.test.ts test/safety-korea-api.test.ts` exited 1 with 10 expected failures. The matcher returned `confirmed` when both input and recall data contained `공급자적합성` or `CB1`, and generated a candidate from the one-character model token `A`. After a successful lookup, timeout, HTTP, network, and `4000`/`4001`/`4005`/`5000` provider failures left `availability` as `available`.

### Green

`cd naekkeo-recall && npm test && npm run typecheck` and `git diff --check` passed: 3 test files and 29 tests passed, and `tsc --noEmit` exited 0. The repository-wide `minwon-run` test and typecheck were also attempted, but currently fail because externally added, untracked Task 3 tests import absent `src/http.ts` and `src/mcp.ts`; no `minwon-run` file was modified for this Task 4 fix.

### Safety Rules Added

- `confirmed` now requires a unique exact match where both values use a conservative KC identifier shape: a sufficiently long letter/number identifier with a final hyphenated serial segment, or the structured `R-*-...` radio-equipment form. Descriptive values, non-ASCII text, and short values cannot confirm a recall.
- Model and product matching only uses identifiers: two or more digits, two or more Hangul syllables, non-generic English tokens of at least three characters, mixed letter-number identifiers, or a one-letter-plus-number combination such as `A-123`. Standalone one-character tokens and generic descriptors such as `Pro` do not create candidates.
- A parsed `2004` no-data result remains official data that is `available`. Every failed upstream request, including provider error codes, HTTP/network errors, malformed responses, and timeouts, changes availability to `unavailable` before returning the error so stale availability is not exposed.
- Added coverage for `2004`, `4000`, `4001`, `4005`, `5000`, success-then-failure availability changes, `공급자적합성`, short cert values, standalone one-character tokens, generic `Pro`, and the valid `A-123` model combination.

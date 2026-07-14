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

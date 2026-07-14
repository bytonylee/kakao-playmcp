# Task 2 Report

## Scope

Implemented only the Minwon Run domain data, fixed service checklists, official public-data adapter, fixtures, and focused tests.

## TDD Record

### Red

Command:

```sh
cd minwon-run && npm test -- test/domain.test.ts test/minwon-api.test.ts
```

The first run exposed a test syntax error in the malformed-response fixture. After correcting that test-only error, the same command exited 1 with the expected missing-module failures:

```text
Cannot find module '../src/checklists.js'
Cannot find module '../src/minwon-api.js'
```

The failures occurred before any production implementation existed, rather than because of fixture data.

The ranking test was then rerun with `TZ=UTC` to emulate the deployment container. It failed because the initial open-state calculation depended on the host timezone. The domain implementation was updated to evaluate civil-office hours in `Asia/Seoul`.

### Green

Command:

```sh
cd minwon-run && npm test && npm run typecheck
```

Output:

```text
Test Files  3 passed (3)
Tests  16 passed (16)
tsc --noEmit: exit 0
```

The timezone regression check also passed:

```sh
cd minwon-run && TZ=UTC npm test -- test/domain.test.ts
```

## Implementation

- Added typed civil-office, wait-status, ranking, and checklist domain models.
- Ranking is deterministic: service support, current open state, lower wait count, supplied-coordinate distance, then office ID.
- Open-state evaluation uses `Asia/Seoul`, independent of the container timezone.
- Added all five requested initial civil-service checklists.
- Added the official `cso_info_v2` and `cso_realtime_v2` adapter with the documented query fields only.
- Normalized both single-object and array `item` responses, rejected malformed payloads, and converted aborted upstream requests into explicit timeout errors.
- The service key remains only in the upstream request query and is absent from returned records and error messages.
- `MinwonApi.liveDataAvailable` is explicitly `false` when no credential or current wait records are available; ranked rows also expose the same availability state per office.

## Validation

`git diff --check` completed with no output.

## Remaining Risk

The adapter is fixture-verified only. Live validation needs a runtime Data.go.kr service key and confirmation of the provider's production field names and availability behavior.

## Review Remediation

### Red

Before changing production code, the official-contract fixtures and regression tests were added, then run with:

```sh
cd minwon-run && npm test -- test/domain.test.ts test/minwon-api.test.ts
```

The run exited 1: 9 of 16 tests failed. The failures demonstrated the reviewed defects: `csoSn`/`roadNmAddr`/`wkdyOperBgngTm`/`wtngCnt` were rejected, duplicate counter rows were not aggregated, pagination did not request page 2, K03/empty data was not handled, and the checklist still exposed unconditional `onlineAvailable` and `fee` fields.

### Green

After the fix, the complete owned package checks passed:

```sh
cd minwon-run && npm test && npm run typecheck
```

Output:

```text
Test Files  3 passed (3)
Tests  19 passed (19)
tsc --noEmit: exit 0
```

The deployment-timezone regression remains green:

```sh
cd minwon-run && TZ=UTC npm test -- test/domain.test.ts
```

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

### Changes

- `cso_info_v2` now maps `csoSn`, `roadNmAddr`, `lotnoAddr`, `lat`, `lot`, and `wkdyOperBgngTm`/`wkdyOperEndTm`. HHMMSS values are range-checked and normalized to HH:MM; invalid or partial hours reject the response rather than guessing an open state.
- The documented contract used here supplies only weekday operating times. Weekend and night fields are therefore intentionally not inferred or modeled; `rankOffices` remains conservative and reports offices closed on weekends unless a supported schedule is added from a verified contract.
- `cso_realtime_v2` now maps `csoSn`, `wtngCnt`, and `totDt`, removes exact duplicate records, ignores negative/non-integer counters, aggregates valid business/window records by office, and retains the newest `totDt`.
- K03 and empty items return current no-data. `liveDataAvailable` resets before every wait query, including upstream errors and timeouts, so it cannot remain stale after a previous success.
- Requests use `totalCount` pagination, cap at 100 pages, stop on empty pages, and remove duplicate office records. Tests cover requests with and without `stdgCd`.
- Checklists now expose `visit`, conditionally available `online`, a conditional fee summary, and `officialGuidance` (`sourceUrl`, `checkedAt`, and the required verification notice). Consumers must use these structured fields instead of the removed `onlineAvailable` boolean and `fee` string.

## Re-review Remediation

### Red

Before changing the adapter or domain, the pagination and operating-schedule regressions were added and run with:

```sh
cd minwon-run && npm test -- test/domain.test.ts test/minwon-api.test.ts
```

The run exited 1: 5 of 19 tests failed. The no-`totalCount` partial-page regression made 100 requests instead of one; a partial second page with `totalCount: 300` requested a third page; and the fixture's official weekend fields were not represented in the domain. The Saturday case had no explicit unknown state and was therefore indistinguishable from a confirmed closure.

### Green

After the changes, the focused regression suite and typecheck passed:

```sh
cd minwon-run && npm test -- test/domain.test.ts test/minwon-api.test.ts && npm run typecheck
```

```text
Test Files  2 passed (2)
Tests  20 passed (20)
tsc --noEmit: exit 0
```

### Changes

- Pagination now requests a following page only when the immediately previous response contains exactly `PAGE_SIZE` items. This applies whether `totalCount` is present or absent; an empty or partial response ends pagination while the 100-page cap remains in force.
- The official Swagger fields are modeled without natural-language parsing: `nghtOperYn`/`nghtDowExpln` and `wkndOperYn`/`wkndDowExpln`. `Y` and `N` map to explicit `operating` and `closed` schedule availability, and their explanations are retained verbatim as schedule notes. Any other or missing flag remains unmodeled/unknown.
- `RankedOffice` retains the existing boolean `isOpen` and legacy `weekdayHours` for downstream callers, then adds `openState` (`open`, `closed`, or `unknown`) and the explicit `operatingSchedule`. A weekend `Y` is `unknown` unless its natural-language condition can be verified; it never becomes a speculative `true` or a false `closed` result.

### Final Validation

```sh
cd minwon-run && npm test && npm run typecheck && TZ=UTC npm test
cd ../naekkeo-recall && npm test && npm run typecheck
```

Both Minwon Run suites passed 3 files / 23 tests, including the `TZ=UTC` run; its typecheck passed. The untouched Naekkeo Recall suite also passed 3 files / 17 tests and its typecheck passed.

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

# Task 3 Report: Minwon Run MCP and HTTP Server

## Scope

- Added the three MCP tools: `plan_civil_visit`, `compare_civil_offices`, and `get_civil_checklist`.
- Added a stateless Streamable HTTP endpoint at `POST /mcp` and `GET /healthz`.
- Added the required runtime and test dependencies with exact versions.
- Preserved the existing `5a4113f` live-gateway `K0` parser behavior. No domain, checklist, config, or public-data adapter files were changed.

## TDD Evidence

### RED

1. Before production files existed, `npm test -- test/tools.test.ts test/http.test.ts` failed because `../src/mcp.js` and `../src/http.js` could not be resolved.
2. After the initial implementation, the service-list regression test failed: an office response without `serviceTypes` did not show the required unknown availability wording.
3. The HTTP initialize test failed with `406` when no `Accept` header was supplied. SDK 1.29's Node adapter constructs its web request from `rawHeaders`, so setting only `req.headers.accept` was insufficient.
4. The first test helper incorrectly treated SDK 1.29's private tool registry as a `Map`; it was corrected to an object record before asserting tool behavior.

### GREEN

- Empty service lists now produce `serviceAvailability: "unknown"` and Korean guidance to confirm before visiting, never an unsupported-service conclusion.
- Missing or `*/*` `Accept` is normalized in both `headers` and `rawHeaders` to `application/json, text/event-stream` before transport handling.
- Final verification:

```text
npm test
5 test files passed, 39 tests passed

npm run typecheck
tsc --noEmit passed
```

## Behavior Delivered

- All tools have English descriptions containing `Minwon Run(민원런)`, an input schema, and five annotations.
- Results are compact Korean Markdown with structured content, official source URLs, query timestamps, live-data state, and honest `openState: "unknown"` when needed.
- Inputs are bounded and office candidates are limited to ten. Provider failures are transformed into safe `isError` responses.
- `/mcp` requires JSON, applies a 64KB body limit, safely handles malformed JSON, and rejects non-POST methods with `405`.
- Each MCP request creates a new `McpServer` and `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` and JSON responses enabled.
- Request logs contain only request ID, optional tool name, duration, and status.

## Remaining Risk

- No live service key was used during this task; upstream behavior remains covered by existing adapter fixtures rather than a production-key call.
- The API does not provide a per-office supported-service list in the verified response shape, so the server intentionally reports that condition as unconfirmed rather than attempting a service-specific conclusion.

## P1 Follow-up Fixes

- Moved the JSON body parser onto `POST /mcp` itself, so every non-POST request is rejected with `405` and `Allow: POST` before malformed or oversized bodies can be parsed.
- Added regressions for malformed `PUT` JSON and a `DELETE` body larger than 64KB; both now return `405`.
- Moved `MinwonApi` construction into the `createServer` closure in `index.ts`, preserving the loaded config values while giving each MCP request its own API and MCP server instance.
- Added a factory-call regression that verifies two MCP requests create two servers.

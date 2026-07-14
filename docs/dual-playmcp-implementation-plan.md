# Dual PlayMCP Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, package, and prepare independent PlayMCP deployments for Minwon Run(민원런) and My Recall(내꺼리콜).

**Architecture:** Each service is a standalone TypeScript package with its own MCP server, domain logic, tests, Dockerfile, and deployment lifecycle. Both use stateless Streamable HTTP and official public-data adapters behind small typed interfaces so fixtures and live APIs exercise the same behavior.

**Tech Stack:** Node.js 22 LTS, TypeScript 5.9, `@modelcontextprotocol/sdk` 1.29, Express 5, Zod 4, Vitest 4, Docker.

## Global Constraints

- PlayMCP protocol range: 2025-03-26 through 2025-11-25.
- Streamable HTTP only; public remote endpoint; stateless, no session.
- MCP server and tool names must not contain `kakao` in any position.
- Each tool defines name, description, inputSchema, and all five annotations.
- Three to ten tools per server; compact Markdown and structured results.
- Cache-hit response target 100ms; complete request deadline 2.8s; p99 below 3s.
- No secrets, raw user queries, cookies, tokens, or personal identifiers in Git or logs.
- Both images must build and run as `linux/amd64` under an unprivileged user.

---

### Task 1: Repository and Independent Package Foundations

**Files:**
- Create: `.gitignore`, `.dockerignore`, `README.md`
- Create: `minwon-run/package.json`, `minwon-run/tsconfig.json`, `minwon-run/src/config.ts`, `minwon-run/test/config.test.ts`
- Create: `naekkeo-recall/package.json`, `naekkeo-recall/tsconfig.json`, `naekkeo-recall/src/config.ts`, `naekkeo-recall/test/config.test.ts`

**Interfaces:**
- Produces `loadConfig(env)` in each package with `port`, external API credentials, and 2,000ms upstream timeout.

- [ ] Write tests asserting default port 8000, integer `PORT` validation, and credentials never appear in serialized config.
- [ ] Run each test and confirm failure because `src/config.ts` is absent.
- [ ] Add the minimum package configuration and `loadConfig` implementations.
- [ ] Install exact dependencies and commit both lockfiles.
- [ ] Run both config test suites and TypeScript checks.
- [ ] Commit as `chore: initialize independent MCP services`.

### Task 2: Minwon Run Domain and Public-Data Adapter

**Files:**
- Create: `minwon-run/src/domain.ts`, `minwon-run/src/checklists.ts`, `minwon-run/src/minwon-api.ts`
- Create: `minwon-run/test/domain.test.ts`, `minwon-run/test/minwon-api.test.ts`, `minwon-run/test/fixtures/minwon-info.json`, `minwon-run/test/fixtures/minwon-wait.json`

**Interfaces:**
- `MinwonApi.listOffices(stdgCd?: string): Promise<CivilOffice[]>`
- `MinwonApi.listWaits(stdgCd?: string): Promise<WaitStatus[]>`
- `rankOffices(offices, waits, query): RankedOffice[]`
- `getChecklist(serviceType): CivilChecklist`

- [ ] Write failing tests for object-or-array API normalization, malformed response rejection, timeout conversion, office/wait joins, open-office ranking, and five supported checklists.
- [ ] Confirm failures reference missing exports rather than fixture errors.
- [ ] Implement the API endpoints `https://apis.data.go.kr/B551982/cso_v2/cso_info_v2` and `/cso_realtime_v2`, passing the service key only as a query parameter and never returning it.
- [ ] Implement deterministic ranking by service match, open state, wait count, then distance when coordinates are supplied.
- [ ] Return an explicit `liveDataAvailable: false` state when credentials or current wait data are unavailable.
- [ ] Run tests, typecheck, and commit as `feat: add minwon public-data planning`.

### Task 3: Minwon Run MCP and HTTP Server

**Files:**
- Create: `minwon-run/src/tools.ts`, `minwon-run/src/mcp.ts`, `minwon-run/src/http.ts`, `minwon-run/src/index.ts`
- Create: `minwon-run/test/tools.test.ts`, `minwon-run/test/http.test.ts`

**Interfaces:**
- Registers `plan_civil_visit`, `compare_civil_offices`, and `get_civil_checklist`.
- Serves `POST /mcp`, `GET /healthz`; rejects unsupported methods on `/mcp`.

- [ ] Write failing tool tests for Korean Markdown, structured results, source timestamps, annotations, input limits, and upstream errors.
- [ ] Write failing HTTP tests for health, 64KB body limit, JSON content type, and method rejection.
- [ ] Implement the three read-only, idempotent, open-world tools with English descriptions containing `Minwon Run(민원런)`.
- [ ] Create a fresh stateless transport and MCP server per request.
- [ ] Add request IDs and duration logs without request bodies or credentials.
- [ ] Run tests and typecheck; commit as `feat: expose minwon MCP server`.

### Task 4: My Recall Search and Match Engine

**Files:**
- Create: `naekkeo-recall/src/domain.ts`, `naekkeo-recall/src/safety-korea-api.ts`, `naekkeo-recall/src/matcher.ts`
- Create: `naekkeo-recall/test/safety-korea-api.test.ts`, `naekkeo-recall/test/matcher.test.ts`
- Create: `naekkeo-recall/test/fixtures/recall-list.json`, `naekkeo-recall/test/fixtures/cert-list.json`

**Interfaces:**
- `SafetyKoreaApi.searchRecalls(criteria): Promise<RecallRecord[]>`
- `SafetyKoreaApi.searchCertifications(criteria): Promise<CertificationRecord[]>`
- `matchRecall(product, candidates): RecallMatch[]`
- Match levels: `confirmed`, `needs_confirmation`, `no_match`.

- [ ] Write failing tests for `AuthKey` header use, product/model/cert searches, response validation, Korean/ASCII normalization, exact cert match, model token match, ambiguous candidates, and no-match safety wording.
- [ ] Confirm tests fail because the API and matcher exports do not exist.
- [ ] Implement only allowlisted SafetyKorea HTTPS endpoints and a two-second abort deadline.
- [ ] Implement transparent match reasons without probabilistic or medical claims.
- [ ] Run tests and typecheck; commit as `feat: add official recall matching`.

### Task 5: My Recall Tools and HTTP Server

**Files:**
- Create: `naekkeo-recall/src/actions.ts`, `naekkeo-recall/src/tools.ts`, `naekkeo-recall/src/mcp.ts`, `naekkeo-recall/src/http.ts`, `naekkeo-recall/src/index.ts`
- Create: `naekkeo-recall/test/actions.test.ts`, `naekkeo-recall/test/tools.test.ts`, `naekkeo-recall/test/http.test.ts`

**Interfaces:**
- Registers `search_product_safety`, `verify_recall_match`, `make_recall_action_plan`, and `check_products_batch`.
- Serves `POST /mcp`, `GET /healthz`.

- [ ] Write failing tests for action guidance, batch limit 10, compact outputs, source links, query timestamps, all annotations, and explicit non-guarantee language.
- [ ] Implement action selection from official recall fields: stop use, preserve model evidence, contact manufacturer, request repair/exchange/refund, and verify official notice.
- [ ] Implement the four tools with English descriptions containing `My Recall(내꺼리콜)`.
- [ ] Reuse the same stateless HTTP and privacy-log behavior within this independent package.
- [ ] Run tests and typecheck; commit as `feat: expose recall safety MCP server`.

### Task 6: Container, Security, and Performance Verification

**Files:**
- Create: `minwon-run/Dockerfile`, `minwon-run/docker-healthcheck.mjs`
- Create: `naekkeo-recall/Dockerfile`, `naekkeo-recall/docker-healthcheck.mjs`
- Create: `scripts/verify-no-secrets.sh`, `scripts/smoke-mcp.mjs`
- Modify: `README.md`

**Interfaces:**
- Both images listen on port 8000 and expose `/healthz` and `/mcp`.

- [ ] Write a failing smoke check that expects healthy containers and a successful MCP initialize/tools/list sequence.
- [ ] Add multi-stage Node 22 Bookworm Slim Dockerfiles, production-only installs, nonroot execution, and health checks.
- [ ] Build both images with `--platform linux/amd64` and inspect architecture.
- [ ] Run dependency audit, secret scan, full tests, typechecks, and cached performance samples.
- [ ] Update operational documentation with exact local, Docker, and PlayMCP commands.
- [ ] Commit as `build: harden MCP deployment images`.

### Task 7: GitHub and PlayMCP Deployment

**Files:**
- Modify: `README.md`
- Create: `docs/deployment-record.md`

**Interfaces:**
- Produces two active KC Endpoint URLs and two PlayMCP draft records.

- [ ] Merge the implementation branch only after all verification passes.
- [ ] Create public repository `bytonylee/kakao-playmcp` and push `main` without credentials.
- [ ] In PlayMCP in KC, create `minwon-run` with `minwon-run/Dockerfile` and `naekkeo-recall` with `naekkeo-recall/Dockerfile`.
- [ ] Record Active status and endpoints without recording credentials.
- [ ] In PlayMCP, upload each icon, enter the prepared names, identifiers, descriptions, examples, no-auth mode, and Endpoint.
- [ ] Use `정보 불러오기`, save as temporary, and verify all representative and error conversations.
- [ ] Request review only after the previews pass.

### Task 8: Final Public Registration and Contest Form

**Files:**
- Modify: `docs/deployment-record.md`

**Interfaces:**
- Produces two full-public PlayMCP detail URLs and one submitted Kakao form response.

- [ ] After approval, change both records to full public and verify each public detail URL.
- [ ] Populate the twelve form responses from the approved design document.
- [ ] Recheck names, URLs, 200-character introduction, affiliation, public state, and finalist-development confirmation.
- [ ] Obtain action-time confirmation before the final external submission click.
- [ ] Submit and capture the confirmation state.

---

## Plan Self-Review

- Spec coverage: service behavior, error handling, security, protocol, performance, container, deployment, registration, and final form are each assigned to a task.
- Type consistency: API adapters return domain records; tools consume those records; HTTP layers only create transports and route requests.
- Scope control: food, medicine, vehicle recall, OAuth, persistent storage, reservation, and payments remain excluded from this preliminary release.
- Runtime dependencies: live data requires a Data.go.kr service key and a SafetyKorea service ID supplied outside Git. The server remains healthy and reports live-data unavailability when either is absent.


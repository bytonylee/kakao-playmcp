# Dual PlayMCP Services

This repository contains two independently deployable Remote MCP services for PlayMCP.

- `minwon-run`: civil-office planning using official public data.
- `naekkeo-recall`: product safety and recall matching using official data.

Both services expose `GET /healthz` and `POST /mcp` on port `8000`. They are stateless Streamable HTTP MCP servers and use no in-image credentials.

Runtime protections are enabled by default: JSON-RPC batches are rejected, browser origins are limited to `https://playmcp.kakao.com`, validated tool traffic is capped at 32 concurrent calls per process, request bodies are limited to 64KB, and slow request/header reads are cut off within ten/five seconds. Official API requests have a two-second total deadline, reject redirects, cap decoded responses at 2MB, and validate record and field sizes. A 30-second, 32-entry in-memory cache reduces duplicate official API calls without persisting results to disk. Per-client rate limits must be configured at the trusted deployment gateway; a process-wide request counter is intentionally not used because one anonymous client could exhaust it for everyone.

## Local Development

Install, test, typecheck, build, and run one service at a time:

```sh
cd minwon-run
npm ci
npm test
npm run typecheck
npm run build
npm start
```

```sh
cd naekkeo-recall
npm ci
npm test
npm run typecheck
npm run build
npm start
```

Use only runtime secret injection for official API credentials. Never add credentials, PEM files, or dotenv files to the repository or Docker build context. Both services remain healthy without an API credential.

## Docker

Run these commands from the repository root. The Docker build context is the repository root because each Dockerfile copies its own service directory.

```sh
docker build --platform linux/amd64 -f minwon-run/Dockerfile -t minwon-run:local .
docker run --detach --name minwon-run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 -p 18000:8000 minwon-run:local
node scripts/smoke-mcp.mjs http://127.0.0.1:18000 minwon-run
docker inspect --format '{{.State.Health.Status}}' minwon-run
docker rm --force minwon-run
```

```sh
docker build --platform linux/amd64 -f naekkeo-recall/Dockerfile -t naekkeo-recall:local .
docker run --detach --name naekkeo-recall --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 -p 18001:8000 naekkeo-recall:local
node scripts/smoke-mcp.mjs http://127.0.0.1:18001 naekkeo-recall
docker inspect --format '{{.State.Health.Status}}' naekkeo-recall
docker rm --force naekkeo-recall
```

Inject credentials only at runtime through the deployment platform's secret mechanism. For a local Minwon Run container, Docker can pass an already-set shell variable without placing its value in an image:

```sh
docker run --rm -p 18000:8000 -e DATA_GO_KR_SERVICE_KEY minwon-run:local
```

The Dockerfiles pin the Node 22 Bookworm Slim image digest, keep application files root-owned and read-only, and run as the unprivileged `node` user. Before deployment, run the Git-history-aware secret check and dependency audits:

```sh
scripts/verify-no-secrets.sh
(cd minwon-run && npm audit --omit=dev)
(cd naekkeo-recall && npm audit --omit=dev)
```

## PlayMCP In KC

Create two separate servers in [PlayMCP in KC](https://playmcp.kakaocloud.io) from the same repository and branch. Leave the PAT field empty for the public repository and use the repository root as the build context.

| Server | Dockerfile path | Port | Health endpoint | MCP endpoint |
| --- | --- | --- | --- | --- |
| `minwon-run` | `minwon-run/Dockerfile` | `8000` | `/healthz` | `/mcp` |
| `naekkeo-recall` | `naekkeo-recall/Dockerfile` | `8000` | `/healthz` | `/mcp` |

Add official API credentials only with KC runtime secrets when that feature is available. Do not use Docker build arguments, Dockerfile `ENV`, repository variables, or source files for credential values.

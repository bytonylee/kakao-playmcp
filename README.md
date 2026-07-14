# Dual PlayMCP Services

This repository contains two independently deployable Remote MCP services for PlayMCP.

- `minwon-run`: civil-office planning using official public data.
- `naekkeo-recall`: product safety and recall matching using official data.

Each service has an isolated Node.js package, lockfile, and deployment lifecycle.

## Development

Run checks from the service you are working on:

```sh
cd minwon-run
npm test
npm run typecheck
```

```sh
cd naekkeo-recall
npm test
npm run typecheck
```

External API credentials are runtime configuration only. Do not commit them to this repository.

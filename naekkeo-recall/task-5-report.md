# Task 5 Runtime Configuration

- `createRuntime` reads `PORT` and SafetyKorea settings from the environment.
- Each valid MCP POST creates its own `SafetyKoreaApi` and MCP server.
- `/healthz` remains available without a SafetyKorea service ID.
- Imports do not listen; `startServer` runs only for direct execution.

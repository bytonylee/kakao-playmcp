import request from "supertest";
import { expect, test, vi } from "vitest";

import { createHttpApp } from "../src/http.js";
import { createRuntime } from "../src/index.js";
import type { SafetyKoreaApiOptions } from "../src/safety-korea-api.js";

test("responds to the health check even without a SafetyKorea service key", async () => {
  const response = await request(createHttpApp()).get("/healthz");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "ok" });
});

test.each(["get", "delete"] as const)("rejects %s requests to the MCP route", async (method) => {
  const response = await request(createHttpApp())[method]("/mcp");

  expect(response.status).toBe(405);
  expect(response.headers.allow).toBe("POST");
  expect(response.body).toMatchObject({
    jsonrpc: "2.0",
    error: { message: "Method not allowed" },
    id: null,
  });
});

test("requires JSON content for MCP requests", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .type("text")
    .send("not json");

  expect(response.status).toBe(415);
  expect(response.body).toMatchObject({ error: { message: "Content-Type must be application/json" } });
});

test("rejects JSON-RPC batches before creating an API client", async () => {
  const createApi = vi.fn(() => ({
    availability: "unavailable" as const,
    searchRecalls: vi.fn(),
    searchCertifications: vi.fn(),
  }));
  const response = await request(createHttpApp({ createApi }))
    .post("/mcp")
    .set("content-type", "application/json")
    .send([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);

  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ error: { message: "JSON-RPC batch requests are not supported" } });
  expect(createApi).not.toHaveBeenCalled();
});

test("rejects untrusted browser origins before creating an API client", async () => {
  const createApi = vi.fn(() => ({
    availability: "unavailable" as const,
    searchRecalls: vi.fn(),
    searchCertifications: vi.fn(),
  }));
  const response = await request(createHttpApp({ createApi }))
    .post("/mcp")
    .set("origin", "https://attacker.example")
    .set("content-type", "application/json")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ error: { message: "Origin not allowed" } });
  expect(createApi).not.toHaveBeenCalled();
});

test("does not expose a process-wide request budget that one client can exhaust", async () => {
  const app = createHttpApp({ maxConcurrentRequests: 1 });

  const statuses = [];
  for (let index = 0; index < 121; index += 1) {
    statuses.push((await initialize(app)).status);
  }

  expect(new Set(statuses)).toEqual(new Set([200]));
});

test("limits concurrent MCP requests", async () => {
  let releaseRecalls!: (value: []) => void;
  const recalls = new Promise<[]>((resolve) => {
    releaseRecalls = resolve;
  });
  const searchRecalls = vi.fn(() => recalls);
  const api = {
    availability: "available" as const,
    searchRecalls,
    searchCertifications: vi.fn(async () => []),
  };
  const app = createHttpApp({ api, maxConcurrentRequests: 1 });
  const firstRequest = request(app)
    .post("/mcp")
    .set("content-type", "application/json")
    .set("accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "verify_recall_match", arguments: { productName: "전기포트" } },
    })
    .then((response) => response);
  await vi.waitFor(() => expect(searchRecalls).toHaveBeenCalledTimes(1));

  const response = await request(app)
    .post("/mcp")
    .set("content-type", "application/json")
    .send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  expect(response.status).toBe(429);
  releaseRecalls([]);
  expect((await firstRequest).status).toBe(200);
});

test("rejects an MCP request body larger than 64KB", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .set("content-type", "application/json")
    .send(Buffer.alloc(64 * 1024 + 1, " "));

  expect(response.status).toBe(413);
  expect(response.body).toMatchObject({ error: { message: "Request body too large" } });
});

test("serves an MCP initialize response without assigning a session", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .set("origin", "https://playmcp.kakao.com")
    .set("content-type", "application/json")
    .set("accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

  expect(response.status).toBe(200);
  expect(response.headers["mcp-session-id"]).toBeUndefined();
  expect(response.body).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: { serverInfo: { name: "naekkeo-recall" } },
  });
});

test("creates a fresh API for each MCP request", async () => {
  const createApi = vi.fn(() => ({
    availability: "unavailable" as const,
    searchRecalls: vi.fn(),
    searchCertifications: vi.fn(),
  }));
  const app = createHttpApp({ createApi });

  await initialize(app);
  await initialize(app);

  expect(createApi).toHaveBeenCalledTimes(2);
});

test("creates a runtime with configured port and SafetyKorea API options", async () => {
  const createApi = vi.fn((_options: SafetyKoreaApiOptions) => ({
    availability: "unavailable" as const,
    searchRecalls: vi.fn(),
    searchCertifications: vi.fn(),
  }));
  const runtime = createRuntime({
    env: { PORT: "8123", SAFETY_KOREA_SERVICE_ID: "runtime-service-id" },
    createApi,
  });

  await initialize(runtime.app);
  await initialize(runtime.app);

  expect(runtime.port).toBe(8123);
  expect(createApi).toHaveBeenCalledTimes(2);
  expect(createApi).toHaveBeenCalledWith(expect.objectContaining({ serviceId: "runtime-service-id", timeoutMs: 2_000 }));
  expect(createApi.mock.calls[0][0].cache).toBe(createApi.mock.calls[1][0].cache);
});

test("logs request metadata without logging a body, key, or product information", async () => {
  const info = vi.fn();
  const secret = "do-not-log-this-service-key";
  const productName = "private product name";
  const app = createHttpApp({ logger: { info } });

  await request(app)
    .post("/mcp")
    .set("content-type", "application/json")
    .set("authorization", `Bearer ${secret}`)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_product_safety", arguments: { productName } } });

  const logs = info.mock.calls.map((call) => JSON.stringify(call)).join("\n");
  expect(logs).not.toContain(secret);
  expect(logs).not.toContain(productName);
  expect(logs).not.toContain("arguments");
});

async function initialize(app: ReturnType<typeof createHttpApp>) {
  const response = await request(app)
    .post("/mcp")
    .set("content-type", "application/json")
    .set("accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

  return response;
}

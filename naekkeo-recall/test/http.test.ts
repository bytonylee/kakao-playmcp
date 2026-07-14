import request from "supertest";
import { expect, test, vi } from "vitest";

import { createHttpApp } from "../src/http.js";

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

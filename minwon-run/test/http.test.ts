import request from "supertest";
import { expect, test } from "vitest";

import { createHttpApp } from "../src/http.js";

test("responds to the health check", async () => {
  const response = await request(createHttpApp()).get("/healthz");

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: "ok" });
});

test.each(["get", "delete", "put"] as const)("rejects %s requests to the MCP route", async (method) => {
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
  expect(response.body).toMatchObject({
    jsonrpc: "2.0",
    error: { message: "Content-Type must be application/json" },
    id: null,
  });
});

test("handles malformed JSON without exposing a parser error", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .set("content-type", "application/json")
    .send("{");

  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    jsonrpc: "2.0",
    error: { message: "Invalid JSON" },
    id: null,
  });
  expect(response.text).not.toContain("SyntaxError");
});

test("rejects an MCP request body larger than 64KB", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .set("content-type", "application/json")
    .send(Buffer.alloc(64 * 1024 + 1, " "));

  expect(response.status).toBe(413);
  expect(response.body).toMatchObject({
    jsonrpc: "2.0",
    error: { message: "Request body too large" },
    id: null,
  });
});

test("serves an MCP initialize response without assigning a session", async () => {
  const response = await request(createHttpApp())
    .post("/mcp")
    .set("content-type", "application/json")
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
    result: {
      serverInfo: { name: "minwon-run" },
    },
  });
});

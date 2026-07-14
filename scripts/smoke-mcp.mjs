#!/usr/bin/env node

const [baseUrl, service] = process.argv.slice(2);

if (!baseUrl || !service || !["minwon-run", "naekkeo-recall"].includes(service)) {
  fail("Usage: node scripts/smoke-mcp.mjs <base-url> <minwon-run|naekkeo-recall>");
}

const endpoint = new URL("/mcp", normalizeBaseUrl(baseUrl));
const healthUrl = new URL("/healthz", normalizeBaseUrl(baseUrl));

await healthcheck(healthUrl);

const initialize = await mcpRequest(endpoint, 1, "initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "deployment-smoke", version: "1.0.0" },
});

if (initialize.result?.serverInfo?.name !== service) {
  fail("MCP initialize returned an unexpected server name");
}

const listed = await mcpRequest(endpoint, 2, "tools/list", {});
const toolName = service === "minwon-run" ? "get_civil_checklist" : "search_product_safety";
if (!Array.isArray(listed.result?.tools) || !listed.result.tools.some((tool) => tool?.name === toolName)) {
  fail("MCP tools/list did not return the required smoke tool");
}

const called = await mcpRequest(endpoint, 3, "tools/call", {
  name: toolName,
  arguments: service === "minwon-run" ? { serviceType: "주민등록표 등본" } : { productName: "smoke-check" },
});

if (!Array.isArray(called.result?.content) || called.result.content.length === 0) {
  fail("MCP tools/call did not return tool content");
}

console.log(`Smoke check passed for ${service}`);

async function healthcheck(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    fail("Health check request failed");
  }

  if (!response.ok) {
    fail(`Health check returned HTTP ${response.status}`);
  }

  const body = await parseJson(response);
  if (body?.status !== "ok") {
    fail("Health check returned an unexpected response");
  }
}

async function mcpRequest(url, id, method, params) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch {
    fail(`MCP ${method} request failed`);
  }

  if (!response.ok) {
    fail(`MCP ${method} returned HTTP ${response.status}`);
  }

  const message = await parseMcpResponse(response);
  if (message?.error) {
    fail(`MCP ${method} returned a JSON-RPC error`);
  }
  if (message?.id !== id) {
    fail(`MCP ${method} returned an unexpected JSON-RPC response`);
  }
  return message;
}

async function parseMcpResponse(response) {
  const body = await response.text();
  if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (data) {
        return parseJsonText(data);
      }
    }
    fail("MCP event stream did not contain JSON-RPC data");
  }
  return parseJsonText(body);
}

async function parseJson(response) {
  return parseJsonText(await response.text());
}

function parseJsonText(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail("Service returned invalid JSON");
  }
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    fail("Base URL must be an HTTP(S) URL");
  }
}

function fail(message) {
  console.error(`Smoke check failed: ${message}`);
  process.exit(1);
}

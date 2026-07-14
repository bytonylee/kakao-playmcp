import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";

import { createMcpServer } from "./mcp.js";
import { SafetyKoreaApi } from "./safety-korea-api.js";
import type { RecallSafetyApi } from "./tools.js";

interface Logger {
  info(metadata: Record<string, unknown>): void;
}

export interface HttpAppOptions {
  readonly api?: RecallSafetyApi;
  readonly createApi?: () => RecallSafetyApi;
  readonly logger?: Logger;
  readonly allowedOrigins?: readonly string[];
  readonly maxConcurrentRequests?: number;
}

const DEFAULT_ALLOWED_ORIGINS = ["https://playmcp.kakao.com"];
const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;

export function createHttpApp(options: HttpAppOptions = {}) {
  const app = express();
  const createApi = options.createApi ?? (() => options.api ?? new SafetyKoreaApi());
  const requireAllowedOrigin = originGuard(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const limitConcurrency = concurrencyGuard(options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS);

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/mcp", requireAllowedOrigin, requireJson, express.json({ limit: "64kb", type: "application/json" }), rejectBatch, limitConcurrency, async (request, response, next) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createMcpServer({ api: createApi() });
      try {
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
        options.logger?.info({ event: "mcp_request", method: "POST", path: "/mcp", statusCode: response.statusCode });
      } finally {
        await transport.close();
        await server.close();
      }
    } catch (error) {
      next(error);
    }
  });

  app.all("/mcp", (_request, response) => {
    response.set("allow", "POST").status(405).json(jsonRpcError("Method not allowed"));
  });

  app.use(jsonErrorHandler);
  app.use(errorHandler(options.logger));
  return app;
}

function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map(canonicalOrigin));
  return (request, response, next) => {
    const origin = request.get("origin");
    if (origin === undefined) {
      next();
      return;
    }

    try {
      if (origin === canonicalOrigin(origin) && allowed.has(origin)) {
        next();
        return;
      }
    } catch {
      // Invalid origins are rejected below.
    }
    response.status(403).json(jsonRpcError("Origin not allowed"));
  };
}

function canonicalOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Origin must use HTTP or HTTPS");
  }
  return url.origin;
}

function concurrencyGuard(maxConcurrentRequests: number): RequestHandler {
  assertPositiveInteger(maxConcurrentRequests, "maxConcurrentRequests");
  let activeRequests = 0;

  return (_request, response, next) => {
    if (activeRequests >= maxConcurrentRequests) {
      response.set("Retry-After", "1").status(429).json(jsonRpcError("Too many requests"));
      return;
    }

    activeRequests += 1;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        activeRequests -= 1;
      }
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

const requireJson: RequestHandler = (request, response, next) => {
  if (!request.is("application/json")) {
    response.status(415).json(jsonRpcError("Content-Type must be application/json"));
    return;
  }
  next();
};

const rejectBatch: RequestHandler = (request, response, next) => {
  if (Array.isArray(request.body)) {
    response.status(400).json(jsonRpcError("JSON-RPC batch requests are not supported"));
    return;
  }
  next();
};

const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json(jsonRpcError("Invalid JSON"));
    return;
  }
  if (isBodyTooLarge(error)) {
    response.status(413).json(jsonRpcError("Request body too large"));
    return;
  }
  next(error);
};

function errorHandler(logger: Logger | undefined): ErrorRequestHandler {
  return (_error, _request, response, _next) => {
    logger?.info({ event: "mcp_error", method: "POST", path: "/mcp", statusCode: 500 });
    if (!response.headersSent) {
      response.status(500).json(jsonRpcError("Internal server error"));
    }
  };
}

function isBodyTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}

function jsonRpcError(message: string) {
  return { jsonrpc: "2.0", error: { code: -32600, message }, id: null };
}

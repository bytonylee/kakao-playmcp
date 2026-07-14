import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";

import { createMcpServer } from "./mcp.js";

interface RequestLog {
  readonly requestId: string;
  readonly tool?: string;
  readonly durationMs: number;
  readonly status: number;
}

export interface HttpAppOptions {
  readonly createServer?: typeof createMcpServer;
  readonly log?: (entry: RequestLog) => void;
  readonly allowedOrigins?: readonly string[];
  readonly maxConcurrentRequests?: number;
}

const DEFAULT_ALLOWED_ORIGINS = ["https://playmcp.kakao.com"];
const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;

export function createHttpApp(options: HttpAppOptions = {}) {
  const app = express();
  const createServer = options.createServer ?? createMcpServer;
  const log = options.log ?? ((entry: RequestLog) => console.info(JSON.stringify(entry)));
  const requireAllowedOrigin = originGuard(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const limitConcurrency = concurrencyGuard(options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS);

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.on("finish", () => {
      const tool = res.locals.tool as string | undefined;
      log({
        requestId,
        ...(tool ? { tool } : {}),
        durationMs: Date.now() - startedAt,
        status: res.statusCode,
      });
    });
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post(
    "/mcp",
    requireAllowedOrigin,
    requireJson,
    express.json({ limit: "64kb", type: "application/json" }),
    rejectBatch,
    limitConcurrency,
    async (req, res) => {
      ensureMcpAccept(req);
      res.locals.tool = toolName(req);
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) {
          jsonRpcError(res, 500, "Internal server error");
        }
      } finally {
        await transport.close();
        await server.close();
      }
    },
  );

  app.all("/mcp", (_req, res) => {
    res.set("Allow", "POST");
    jsonRpcError(res, 405, "Method not allowed");
  });

  app.use(httpErrorHandler);
  return app;
}

function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map(canonicalOrigin));
  return (req, res, next) => {
    const origin = req.get("origin");
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
    jsonRpcError(res, 403, "Origin not allowed");
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

  return (_req, res, next) => {
    if (activeRequests >= maxConcurrentRequests) {
      res.set("Retry-After", "1");
      jsonRpcError(res, 429, "Too many requests");
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
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

const requireJson: RequestHandler = (req, res, next) => {
  if (!req.is("application/json")) {
    jsonRpcError(res, 415, "Content-Type must be application/json");
    return;
  }
  next();
};

const rejectBatch: RequestHandler = (req, res, next) => {
  if (Array.isArray(req.body)) {
    jsonRpcError(res, 400, "JSON-RPC batch requests are not supported");
    return;
  }
  next();
};

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

const httpErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.type === "entity.too.large") {
    jsonRpcError(res, 413, "Request body too large");
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    jsonRpcError(res, 400, "Invalid JSON");
    return;
  }
  jsonRpcError(res, 400, "Invalid request");
};

function toolName(req: Request): string | undefined {
  const body = req.body;
  if (!isRecord(body) || body.method !== "tools/call" || !isRecord(body.params)) {
    return undefined;
  }
  return typeof body.params.name === "string" ? body.params.name : undefined;
}

function ensureMcpAccept(req: Request): void {
  const accept = req.get("accept")?.trim();
  if (accept && accept !== "*/*") {
    return;
  }

  const supportedAccept = "application/json, text/event-stream";
  req.headers.accept = supportedAccept;
  const acceptHeaderIndex = req.rawHeaders.findIndex((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "accept",
  );
  if (acceptHeaderIndex === -1) {
    req.rawHeaders.push("Accept", supportedAccept);
  } else {
    req.rawHeaders[acceptHeaderIndex + 1] = supportedAccept;
  }
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32600, message },
    id: null,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

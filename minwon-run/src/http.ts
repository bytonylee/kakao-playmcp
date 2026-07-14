import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";

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
}

export function createHttpApp(options: HttpAppOptions = {}) {
  const app = express();
  const createServer = options.createServer ?? createMcpServer;
  const log = options.log ?? ((entry: RequestLog) => console.info(JSON.stringify(entry)));

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
    express.json({ limit: "64kb", type: "application/json" }),
    async (req, res) => {
      if (!req.is("application/json")) {
        jsonRpcError(res, 415, "Content-Type must be application/json");
        return;
      }

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

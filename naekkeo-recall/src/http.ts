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
  readonly logger?: Logger;
}

export function createHttpApp(options: HttpAppOptions = {}) {
  const app = express();
  const api = options.api ?? new SafetyKoreaApi();

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.post("/mcp", requireJson, express.json({ limit: "64kb", type: "application/json" }), async (request, response, next) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const server = createMcpServer({ api });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      await server.close();
      options.logger?.info({ event: "mcp_request", method: "POST", path: "/mcp", statusCode: response.statusCode });
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

const requireJson: RequestHandler = (request, response, next) => {
  if (!request.is("application/json")) {
    response.status(415).json(jsonRpcError("Content-Type must be application/json"));
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

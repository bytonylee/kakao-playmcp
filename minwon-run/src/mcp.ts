import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { MinwonApi } from "./minwon-api.js";
import { registerMinwonTools, type CivilDataProvider } from "./tools.js";

export interface McpServerOptions {
  readonly api?: CivilDataProvider;
  readonly now?: () => Date;
}

export function createMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: "minwon-run",
    version: "0.1.0",
  });

  registerMinwonTools(server, {
    api: options.api ?? new MinwonApi(),
    now: options.now,
  });
  return server;
}

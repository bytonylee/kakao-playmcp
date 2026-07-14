import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { MinwonApi } from "./minwon-api.js";

const { env } = process;
const config = loadConfig(env);

createHttpApp({
  createServer: () => createMcpServer({
    api: new MinwonApi({
      serviceKey: config.credentials.dataGoKrServiceKey,
      timeoutMs: config.upstreamTimeoutMs,
    }),
  }),
}).listen(config.port);

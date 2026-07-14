import { MemoryTtlCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { MinwonApi } from "./minwon-api.js";

const { env } = process;
const config = loadConfig(env);
const cache = new MemoryTtlCache<Record<string, unknown>[]>({ ttlMs: 30_000, maxEntries: 32 });

const server = createHttpApp({
  createServer: () => createMcpServer({
    api: new MinwonApi({
      serviceKey: config.credentials.dataGoKrServiceKey,
      timeoutMs: config.upstreamTimeoutMs,
      cache,
    }),
  }),
}).listen(config.port);
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.timeout = 10_000;

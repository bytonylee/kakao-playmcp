import { pathToFileURL } from "node:url";

import { MemoryTtlCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { SafetyKoreaApi } from "./safety-korea-api.js";
import type { SafetyKoreaApiOptions } from "./safety-korea-api.js";
import type { RecallSafetyApi } from "./tools.js";

type Environment = Readonly<Record<string, string | undefined>>;
type CreateApi = (options: SafetyKoreaApiOptions) => RecallSafetyApi;

export interface RuntimeOptions {
  readonly env?: Environment;
  readonly createApi?: CreateApi;
}

export function createRuntime(options: RuntimeOptions = {}) {
  const config = loadConfig(options.env ?? process.env);
  const createApi = options.createApi ?? ((apiOptions) => new SafetyKoreaApi(apiOptions));
  const cache = new MemoryTtlCache<Record<string, unknown>[]>({ ttlMs: 30_000, maxEntries: 32 });

  return {
    port: config.port,
    app: createHttpApp({
      createApi: () => createApi({
        serviceId: config.credentials.safetyKoreaServiceId,
        timeoutMs: config.upstreamTimeoutMs,
        cache,
      }),
    }),
  };
}

export function startServer(options: RuntimeOptions = {}) {
  const runtime = createRuntime(options);
  const server = runtime.app.listen(runtime.port);
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

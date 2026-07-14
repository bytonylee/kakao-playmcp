import { pathToFileURL } from "node:url";

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

  return {
    port: config.port,
    app: createHttpApp({
      createApi: () => createApi({
        serviceId: config.credentials.safetyKoreaServiceId,
        timeoutMs: config.upstreamTimeoutMs,
      }),
    }),
  };
}

export function startServer(options: RuntimeOptions = {}) {
  const runtime = createRuntime(options);
  return runtime.app.listen(runtime.port);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

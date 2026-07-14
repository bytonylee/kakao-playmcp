type Environment = Readonly<Record<string, string | undefined>>;

export interface MinwonRunConfig {
  readonly port: number;
  readonly upstreamTimeoutMs: number;
  readonly credentials: {
    readonly dataGoKrServiceKey: string | undefined;
  };
}

export function loadConfig(env: Environment): MinwonRunConfig {
  const config = {
    port: parsePort(env.PORT),
    upstreamTimeoutMs: 2_000,
  };

  return Object.defineProperty(config, "credentials", {
    value: Object.freeze({
      dataGoKrServiceKey: env.DATA_GO_KR_SERVICE_KEY,
    }),
    enumerable: false,
    writable: false,
    configurable: false,
  }) as MinwonRunConfig;
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return 8_000;
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const port = Number(rawPort);
  if (port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

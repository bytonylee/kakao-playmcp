import { expect, test } from "vitest";

import { loadConfig } from "../src/config.js";

test("uses port 8000 when PORT is not set", () => {
  const config = loadConfig({});

  expect(config.port).toBe(8000);
  expect(config.upstreamTimeoutMs).toBe(2_000);
});

test("rejects a non-integer PORT", () => {
  expect(() => loadConfig({ PORT: "8000.5" })).toThrow(
    /PORT must be an integer/,
  );
});

test("does not serialize the Data.go.kr service key", () => {
  const serviceKey = "minwon-service-key";
  const config = loadConfig({ DATA_GO_KR_SERVICE_KEY: serviceKey });

  expect(config.credentials.dataGoKrServiceKey).toBe(serviceKey);
  expect(JSON.stringify(config)).not.toContain(serviceKey);
});

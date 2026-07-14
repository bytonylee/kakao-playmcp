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

test("does not serialize the SafetyKorea service ID", () => {
  const serviceId = "recall-service-id";
  const config = loadConfig({ SAFETY_KOREA_SERVICE_ID: serviceId });

  expect(config.credentials.safetyKoreaServiceId).toBe(serviceId);
  expect(JSON.stringify(config)).not.toContain(serviceId);
});

import { readFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import { MemoryTtlCache } from "../src/cache.js";
import { SafetyKoreaApi, SafetyKoreaApiError } from "../src/safety-korea-api.js";

const fixturePath = new URL("./fixtures/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixturePath), "utf8"));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

test("searches recalls by product name with the official AuthKey header", async () => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(await fixture("recall-list.json")));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "아동용 카시트" })).resolves.toEqual([
    {
      id: "3802",
      productName: "아동용 카시트",
      brandName: "Safe Ride",
      modelName: "A-123 Pro, A-124 Pro",
      recallMeans: "교환",
      barcodeNumber: "8801234567890",
      certificationNumbers: ["CB123A123-1234"],
      recallType: "자발적리콜",
      inquiryPhone: "080-123-4567",
      companyName: "세이프라이드코리아",
      manufacturerName: "Safe Ride Co.",
      publishedAt: "20260701",
      defectDescription: "고정 장치 결함",
      accidentDescription: "사고 사례 없음",
      actionGuidance: "사용을 중지하고 제조사에 문의",
    },
  ]);

  const [requestUrl, requestInit] = fetch.mock.calls[0] as [string, RequestInit];
  expect(requestUrl).toBe("https://www.safetykorea.kr/openapi/api/recall/recallList.json?conditionKey=recallProductName&conditionValue=%EC%95%84%EB%8F%99%EC%9A%A9+%EC%B9%B4%EC%8B%9C%ED%8A%B8");
  expect(requestInit.headers).toEqual({ AuthKey: "service-id" });
  expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  expect(requestInit.redirect).toBe("error");
  expect(api.availability).toBe("available");
});

test("shares a bounded TTL cache across API clients", async () => {
  let now = 0;
  const cache = new MemoryTtlCache<Record<string, unknown>[]>({ ttlMs: 30_000, maxEntries: 2, now: () => now });
  const fetch = vi.fn(async () => jsonResponse(await fixture("recall-list.json")));
  const first = new SafetyKoreaApi({ serviceId: "service-id", fetch, cache });
  const second = new SafetyKoreaApi({ serviceId: "service-id", fetch, cache });

  await first.searchRecalls({ productName: "카시트" });
  await second.searchRecalls({ productName: "카시트" });
  expect(fetch).toHaveBeenCalledTimes(1);

  now = 30_001;
  await second.searchRecalls({ productName: "카시트" });
  expect(fetch).toHaveBeenCalledTimes(2);

  cache.set("other-a", []);
  cache.set("other-b", []);
  expect(cache.get("recall:recallProductName:카시트")).toBeUndefined();
});

test.each([
  ["modelName", "A-123 Pro", "recallModelName"],
  ["certificationNumber", "CB123A123-1234", "certNum"],
] as const)("searches recalls by %s", async (key, value, conditionKey) => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(await fixture("recall-list.json")));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await api.searchRecalls({ [key]: value });

  const requestUrl = new URL(fetch.mock.calls[0][0] as string);
  expect(requestUrl.searchParams.get("conditionKey")).toBe(conditionKey);
  expect(requestUrl.searchParams.get("conditionValue")).toBe(value);
});

test.each([
  ["productName", "아동용 카시트", "productName"],
  ["modelName", "A-123 Pro", "modelName"],
  ["certificationNumber", "CB123A123-1234", "certNum"],
] as const)("searches certifications by %s", async (key, value, conditionKey) => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(await fixture("cert-list.json")));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchCertifications({ [key]: value })).resolves.toEqual([
    {
      id: "1231231",
      certificationNumber: "CB123A123-1234",
      status: "적합",
      certificationType: "어린이제품 특별법 대상>안전확인 대상",
      firstCertificationNumber: "CB123A123-1234",
      productName: "아동용 카시트",
      brandName: "Safe Ride",
      modelName: "A-123 Pro",
      categoryName: "어린이제품>카시트",
      manufacturerName: "Safe Ride Co.",
      importerName: "세이프라이드코리아",
      certifiedAt: "20240115",
      registeredAt: "20240116",
    },
  ]);

  const requestUrl = new URL(fetch.mock.calls[0][0] as string);
  expect(requestUrl.origin + requestUrl.pathname).toBe(
    "https://www.safetykorea.kr/openapi/api/cert/certificationList.json",
  );
  expect(requestUrl.searchParams.get("conditionKey")).toBe(conditionKey);
  expect(requestUrl.searchParams.get("conditionValue")).toBe(value);
});

test("rejects malformed successful official responses", async () => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse({
    resultCode: "2000",
    resultMsg: "Success",
    resultData: [{ recallProductName: "식별자 없음" }],
  }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).rejects.toMatchObject({
    name: "SafetyKoreaApiError",
    code: "invalid_response",
  });
});

test("rejects an upstream result set with more than five thousand records", async () => {
  const resultData = Array.from({ length: 5_001 }, (_, index) => ({
    recallUid: String(index),
    recallProductName: "카시트",
  }));
  const fetch = vi.fn(async () => jsonResponse({ resultCode: "2000", resultData }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).rejects.toMatchObject({ code: "invalid_response" });
});

test("rejects unreasonably long upstream fields", async () => {
  const fetch = vi.fn(async () => jsonResponse({
    resultCode: "2000",
    resultData: [{ recallUid: "1", recallProductName: "가".repeat(10_001) }],
  }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).rejects.toMatchObject({ code: "invalid_response" });
});

test("rejects an upstream response declared larger than two megabytes", async () => {
  const payload = await fixture("recall-list.json");
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { "content-length": String(2 * 1024 * 1024 + 1), "content-type": "application/json" },
  }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).rejects.toMatchObject({ code: "invalid_response" });
});

test("stops reading a chunked upstream response after two megabytes", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).rejects.toMatchObject({ code: "invalid_response" });
});

test("converts an aborted request to an explicit timeout error", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse(await fixture("recall-list.json")))
    .mockImplementationOnce((_: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch, timeoutMs: 1 });

  await api.searchRecalls({ productName: "카시트" });
  expect(api.availability).toBe("available");
  await expect(api.searchCertifications({ modelName: "A-123" })).rejects.toEqual(
    new SafetyKoreaApiError("timeout", "제품안전정보센터 조회 시간이 초과되었습니다."),
  );
  expect(api.availability).toBe("unavailable");
});

test("keeps official data available for a successful no-data result", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse(await fixture("recall-list.json")))
    .mockResolvedValueOnce(jsonResponse({ resultCode: "2004", resultMsg: "No data", resultData: [] }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await api.searchRecalls({ productName: "카시트" });
  await expect(api.searchRecalls({ productName: "없는 제품" })).resolves.toEqual([]);

  expect(api.availability).toBe("available");
});

test.each(["4000", "4001", "4005", "5000"])("marks official data unavailable after provider failure code %s", async (resultCode) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse(await fixture("recall-list.json")))
    .mockResolvedValueOnce(jsonResponse({ resultCode, resultMsg: "Failure" }));
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await api.searchRecalls({ productName: "카시트" });
  await expect(api.searchRecalls({ productName: "없는 제품" })).rejects.toMatchObject({
    name: "SafetyKoreaApiError",
    code: "upstream_error",
  });

  expect(api.availability).toBe("unavailable");
});

test.each([
  ["HTTP error", async () => new Response(null, { status: 503 })],
  ["network error", async () => { throw new TypeError("network failed"); }],
] as const)("marks official data unavailable after a %s", async (_name, failedResponse) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse(await fixture("recall-list.json")))
    .mockImplementationOnce(failedResponse);
  const api = new SafetyKoreaApi({ serviceId: "service-id", fetch });

  await api.searchRecalls({ productName: "카시트" });
  await expect(api.searchRecalls({ productName: "없는 제품" })).rejects.toMatchObject({
    name: "SafetyKoreaApiError",
    code: "upstream_error",
  });

  expect(api.availability).toBe("unavailable");
});

test("reports unavailable official data without a service ID", async () => {
  const fetch = vi.fn();
  const api = new SafetyKoreaApi({ fetch });

  await expect(api.searchRecalls({ productName: "카시트" })).resolves.toEqual([]);
  expect(api.availability).toBe("unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

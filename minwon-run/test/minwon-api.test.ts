import { readFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

import { MemoryTtlCache } from "../src/cache.js";
import { MinwonApi, MinwonApiError } from "../src/minwon-api.js";

const fixturePath = new URL("./fixtures/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixturePath), "utf8"));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

test("normalizes a single office item and sends only documented query parameters", async () => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(await fixture("minwon-info.json")));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices("1168051000")).resolves.toEqual([
    {
      id: "1168051000-001",
      name: "강남구청 민원실",
      address: "서울특별시 강남구 학동로 426",
      roadAddress: "서울특별시 강남구 학동로 426",
      lotNumberAddress: "서울특별시 강남구 삼성동 16",
      stdgCd: "1168051000",
      serviceTypes: ["주민등록표 등본", "여권"],
      weekdayHours: { opensAt: "09:00", closesAt: "18:00" },
      operatingSchedule: {
        weekdayHours: { opensAt: "09:00", closesAt: "18:00" },
        night: {
          availability: "closed",
          explanation: "매주 목요일 18:00 ~ 20:00 미운영",
        },
        weekend: {
          availability: "operating",
          explanation: "매월 첫번째 토요일 09:00 ~ 13:00 운영",
        },
      },
      latitude: 37.5172,
      longitude: 127.0473,
    },
  ]);

  const requestUrl = new URL(fetch.mock.calls[0][0] as string);
  expect(requestUrl.origin + requestUrl.pathname).toBe(
    "https://apis.data.go.kr/B551982/cso_v2/cso_info_v2",
  );
  expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
    serviceKey: "secret-key",
    pageNo: "1",
    numOfRows: "100",
    type: "JSON",
    stdgCd: "1168051000",
  });
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
});

test("shares a bounded TTL cache across API clients", async () => {
  let now = 0;
  const cache = new MemoryTtlCache<Record<string, unknown>[]>({ ttlMs: 30_000, maxEntries: 2, now: () => now });
  const fetch = vi.fn(async () => jsonResponse(await fixture("minwon-info.json")));
  const first = new MinwonApi({ serviceKey: "secret-key", fetch, cache });
  const second = new MinwonApi({ serviceKey: "secret-key", fetch, cache });

  await first.listOffices("1168051000");
  await second.listOffices("1168051000");
  expect(fetch).toHaveBeenCalledTimes(1);

  now = 30_001;
  await second.listOffices("1168051000");
  expect(fetch).toHaveBeenCalledTimes(2);

  cache.set("other-a", []);
  cache.set("other-b", []);
  expect(cache.get("cso_info_v2:1168051000")).toBeUndefined();
});

test("accepts the live gateway's top-level K0 success envelope", async () => {
  const payload = await fixture("minwon-info.json") as {
    response: { header: Record<string, unknown>; body: Record<string, unknown> };
  };
  const fetch = vi.fn(async () => jsonResponse({
    header: { ...payload.response.header, resultCode: "K0", resultMsg: "NORMAL_SERVICE" },
    body: payload.response.body,
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices("2900000000")).resolves.toHaveLength(1);
});

test("normalizes official wait fields, aggregates counters, and retains the newest observation", async () => {
  const fetch = vi.fn(async (_input: string) => jsonResponse(await fixture("minwon-wait.json")));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).resolves.toEqual([
    {
      officeId: "1168051000-001",
      waitingCount: 7,
      updatedAt: "20260714100500",
    },
  ]);
  expect(api.liveDataAvailable).toBe(true);
});

test("follows totalCount pagination without a region filter and does not retain duplicated offices", async () => {
  const firstPage = [
    { csoSn: "1", csoNm: "첫째", roadNmAddr: "서울 1", lat: "37", lot: "127" },
    ...Array.from({ length: 99 }, () => ({ csoSn: "2", csoNm: "둘째", lotnoAddr: "서울 2" })),
  ];
  const pages = [
    {
      response: {
        header: { resultCode: "00" },
        body: {
          totalCount: "101",
          items: { item: firstPage },
        },
      },
    },
    {
      response: {
        header: { resultCode: "00" },
        body: {
          totalCount: "101",
          items: { item: [{ csoSn: "2", csoNm: "둘째", lotnoAddr: "서울 2" }, { csoSn: "3", csoNm: "셋째", roadNmAddr: "서울 3" }] },
        },
      },
    },
  ];
  const fetch = vi.fn(async (_input: string) => jsonResponse(pages[fetch.mock.calls.length - 1]));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).resolves.toMatchObject([{ id: "1" }, { id: "2" }, { id: "3" }]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(fetch.mock.calls[0][0] as string).searchParams.has("stdgCd")).toBe(false);
  expect(new URL(fetch.mock.calls[1][0] as string).searchParams.get("pageNo")).toBe("2");
});

test("does not request a second page when totalCount is absent and the first page is partial", async () => {
  const fetch = vi.fn(async () => jsonResponse({
    response: {
      header: { resultCode: "00" },
      body: { items: { item: [{ csoSn: "1", wtngCnt: "1" }] } },
    },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).resolves.toEqual([{ officeId: "1", waitingCount: 1 }]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("requests the next page without totalCount only after a full page", async () => {
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ csoSn: String(index), wtngCnt: "1" }));
  const pages = [
    { response: { header: { resultCode: "00" }, body: { items: { item: fullPage } } } },
    { response: { header: { resultCode: "00" }, body: { items: { item: [] } } } },
  ];
  const fetch = vi.fn(async () => jsonResponse(pages[fetch.mock.calls.length - 1]));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).resolves.toHaveLength(100);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("stops after a partial page even when totalCount reports additional pages", async () => {
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ csoSn: String(index), wtngCnt: "1" }));
  const pages = [
    { response: { header: { resultCode: "00" }, body: { totalCount: "300", items: { item: fullPage } } } },
    { response: { header: { resultCode: "00" }, body: { totalCount: "300", items: { item: [{ csoSn: "100", wtngCnt: "1" }] } } } },
  ];
  const fetch = vi.fn(async () => jsonResponse(pages[fetch.mock.calls.length - 1]));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).resolves.toHaveLength(101);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("treats K03 and empty items as current no-data and clears previously available live data", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(jsonResponse(await fixture("minwon-wait.json")))
    .mockResolvedValueOnce(jsonResponse(await fixture("minwon-wait-k03.json")))
    .mockResolvedValueOnce(jsonResponse({ response: { header: { resultCode: "00" }, body: { totalCount: "0", items: { item: [] } } } }))
    .mockRejectedValueOnce(new Error("network unavailable"));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await api.listWaits();
  expect(api.liveDataAvailable).toBe(true);
  await expect(api.listWaits()).resolves.toEqual([]);
  expect(api.liveDataAvailable).toBe(false);
  await expect(api.listWaits()).resolves.toEqual([]);
  expect(api.liveDataAvailable).toBe(false);
  await expect(api.listWaits()).rejects.toMatchObject({ code: "upstream_error" });
  expect(api.liveDataAvailable).toBe(false);
});

test("rejects invalid HHMMSS weekday hours instead of guessing whether an office is open", async () => {
  const fetch = vi.fn(async () => jsonResponse({
    response: {
      header: { resultCode: "00" },
      body: { totalCount: "1", items: { item: { csoSn: "1", csoNm: "민원실", roadNmAddr: "서울", wkdyOperBgngTm: "246000", wkdyOperEndTm: "180000" } } },
    },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({ code: "invalid_response" });
});

test("rejects malformed successful API responses", async () => {
  const fetch = vi.fn(async (_input: string) => jsonResponse({
    response: { body: { items: { item: [{ csoNm: "이름만" }] } } },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({
    name: "MinwonApiError",
    code: "invalid_response",
  });
});

test("rejects an upstream page with more records than requested", async () => {
  const items = Array.from({ length: 101 }, (_, index) => ({
    csoSn: String(index),
    csoNm: `민원실 ${index}`,
    roadNmAddr: `서울 ${index}`,
  }));
  const fetch = vi.fn(async () => jsonResponse({
    response: { header: { resultCode: "00" }, body: { totalCount: "101", items: { item: items } } },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({ code: "invalid_response" });
});

test("rejects unreasonably long upstream fields", async () => {
  const fetch = vi.fn(async () => jsonResponse({
    response: {
      header: { resultCode: "00" },
      body: { totalCount: "1", items: { item: { csoSn: "1", csoNm: "민원실", roadNmAddr: "가".repeat(10_001) } } },
    },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({ code: "invalid_response" });
});

test("rejects an upstream response declared larger than two megabytes", async () => {
  const payload = await fixture("minwon-info.json");
  const fetch = vi.fn(async () => new Response(JSON.stringify(payload), {
    headers: { "content-length": String(2 * 1024 * 1024 + 1), "content-type": "application/json" },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({ code: "invalid_response" });
});

test("stops reading a chunked upstream response after two megabytes", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices()).rejects.toMatchObject({ code: "invalid_response" });
});

test("caps the combined size of all pages in one upstream request", async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ csoSn: String(index), wtngCnt: "1" }));
  const responseBody = JSON.stringify({
    response: { header: { resultCode: "00" }, body: { totalCount: "200", items: { item: items } } },
  });
  const fetch = vi.fn(async () => new Response(responseBody, {
    headers: { "content-length": String(1_100_000), "content-type": "application/json" },
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).rejects.toMatchObject({ code: "invalid_response" });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("converts an aborted upstream request to an explicit timeout error", async () => {
  const fetch = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch, timeoutMs: 1 });

  await expect(api.listWaits()).rejects.toEqual(
    new MinwonApiError("timeout", "민원실 실시간 정보 조회 시간이 초과되었습니다."),
  );
});

test("applies the timeout to the whole paginated request instead of each page", async () => {
  vi.useFakeTimers();
  try {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ csoSn: String(index), wtngCnt: "1" }));
    const fetch = vi.fn((_input: string, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(jsonResponse({
            response: {
              header: { resultCode: "00" },
              body: { totalCount: "200", items: { item: fullPage } },
            },
          })), 60);
        });
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const api = new MinwonApi({ serviceKey: "secret-key", fetch, timeoutMs: 100 });
    let settled = false;
    const request = api.listWaits().catch((error: unknown) => {
      settled = true;
      return error;
    });

    await vi.advanceTimersByTimeAsync(100);
    const settledAtDeadline = settled;
    await vi.advanceTimersByTimeAsync(100);
    const error = await request;

    expect(settledAtDeadline).toBe(true);
    expect(error).toEqual(new MinwonApiError("timeout", "민원실 실시간 정보 조회 시간이 초과되었습니다."));
  } finally {
    vi.useRealTimers();
  }
});

test("reports unavailable live data without issuing a request when credentials are absent", async () => {
  const fetch = vi.fn();
  const api = new MinwonApi({ fetch });

  await expect(api.listWaits()).resolves.toEqual([]);
  expect(api.liveDataAvailable).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

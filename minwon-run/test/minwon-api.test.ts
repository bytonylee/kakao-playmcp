import { readFile } from "node:fs/promises";

import { expect, test, vi } from "vitest";

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
  const fetch = vi.fn(async (_input: string) => jsonResponse(await fixture("minwon-info.json")));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listOffices("1168051000")).resolves.toEqual([
    {
      id: "1168051000-001",
      name: "강남구청 민원실",
      address: "서울특별시 강남구 학동로 426",
      stdgCd: "1168051000",
      serviceTypes: ["주민등록표 등본", "여권"],
      weekdayHours: { opensAt: "09:00", closesAt: "18:00" },
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
});

test("normalizes an array of wait items", async () => {
  const fetch = vi.fn(async (_input: string) => jsonResponse(await fixture("minwon-wait.json")));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch });

  await expect(api.listWaits()).resolves.toEqual([
    {
      officeId: "1168051000-001",
      waitingCount: 4,
      updatedAt: "2026-07-14T10:00:00+09:00",
    },
    {
      officeId: "1168051000-002",
      waitingCount: 12,
      updatedAt: "2026-07-14T10:00:00+09:00",
    },
  ]);
  expect(api.liveDataAvailable).toBe(true);
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

test("converts an aborted upstream request to an explicit timeout error", async () => {
  const fetch = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const api = new MinwonApi({ serviceKey: "secret-key", fetch, timeoutMs: 1 });

  await expect(api.listWaits()).rejects.toEqual(
    new MinwonApiError("timeout", "민원실 실시간 정보 조회 시간이 초과되었습니다."),
  );
});

test("reports unavailable live data without issuing a request when credentials are absent", async () => {
  const fetch = vi.fn();
  const api = new MinwonApi({ fetch });

  await expect(api.listWaits()).resolves.toEqual([]);
  expect(api.liveDataAvailable).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

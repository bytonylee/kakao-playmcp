import { expect, test, vi } from "vitest";

import type { CivilOffice, WaitStatus } from "../src/domain.js";
import { registerMinwonTools } from "../src/tools.js";

const offices: CivilOffice[] = [
  {
    id: "office-open",
    name: "강남구청 민원실",
    address: "서울특별시 강남구 학동로 426",
    serviceTypes: ["주민등록표 등본"],
    operatingSchedule: { weekdayHours: { opensAt: "09:00", closesAt: "18:00" } },
  },
  {
    id: "office-unknown",
    name: "안내 미확인 민원실",
    address: "서울특별시 강남구",
    serviceTypes: ["주민등록표 등본"],
  },
];

const waits: WaitStatus[] = [
  { officeId: "office-open", waitingCount: 3, updatedAt: "2026-07-14T10:00:00+09:00" },
];

function createApi(overrides: Partial<{
  liveDataAvailable: boolean;
  listOffices: () => Promise<CivilOffice[]>;
  listWaits: () => Promise<WaitStatus[]>;
}> = {}) {
  return {
    liveDataAvailable: true,
    listOffices: vi.fn(async () => offices),
    listWaits: vi.fn(async () => waits),
    ...overrides,
  };
}

function toolsFor(api = createApi()) {
  const tools: Record<string, {
    description?: string;
    annotations?: Record<string, unknown>;
    inputSchema: { safeParse(value: unknown): { success: boolean } };
    handler: (args: never) => Promise<ToolResult>;
  }> = {};
  const server = {
    registerTool(name: string, config: Omit<typeof tools[string], "handler">, handler: typeof tools[string]["handler"]) {
      tools[name] = { ...config, handler };
    },
  };

  registerMinwonTools(server as never, {
    api,
    now: () => new Date("2026-07-14T01:23:45.000Z"),
  });
  return tools;
}

interface ToolResult {
  readonly content: readonly { readonly type: string; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

test("registers three annotated Minwon Run(민원런) tools with input schemas", () => {
  const tools = toolsFor();

  expect(Object.keys(tools)).toEqual([
    "plan_civil_visit",
    "compare_civil_offices",
    "get_civil_checklist",
  ]);

  for (const [name, tool] of Object.entries(tools)) {
    expect(tool.inputSchema).toBeDefined();
    expect(tool.description).toContain("Minwon Run(민원런)");
    expect(tool.annotations).toMatchObject({
      title: expect.any(String),
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(name).not.toContain("ka" + "kao");
  }
  expect(tools.plan_civil_visit.annotations?.openWorldHint).toBe(true);
  expect(tools.compare_civil_offices.annotations?.openWorldHint).toBe(true);
  expect(tools.get_civil_checklist.annotations?.openWorldHint).toBe(false);
});

test("returns compact Korean visit guidance with structured official source and honest office states", async () => {
  const tools = toolsFor();
  const result = await tools.plan_civil_visit.handler({
    serviceType: "주민등록표 등본",
    limit: 2,
  } as never);

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain("방문 계획");
  expect(result.content[0].text).toContain("공식 출처");
  expect(result.content[0].text).toContain("조회 시각: 2026-07-14T01:23:45.000Z");
  expect(result.structuredContent).toMatchObject({
    serviceType: "주민등록표 등본",
    queriedAt: "2026-07-14T01:23:45.000Z",
    liveDataAvailable: true,
    sourceUrls: [
      "https://apis.data.go.kr/B551982/cso_v2/cso_info_v2",
      "https://apis.data.go.kr/B551982/cso_v2/cso_realtime_v2",
    ],
    offices: [
      { id: "office-open", openState: "open", waitingCount: 3 },
      { id: "office-unknown", openState: "unknown" },
    ],
  });
});

test("limits returned office candidates to ten", async () => {
  const api = createApi({
    listOffices: async () => Array.from({ length: 12 }, (_, index) => ({
      ...offices[0],
      id: `office-${index}`,
    })),
  });
  const tools = toolsFor(api);
  const result = await tools.compare_civil_offices.handler({
    serviceType: "주민등록표 등본",
    limit: 10,
  } as never);

  expect(result.structuredContent?.offices).toHaveLength(10);
});

test("keeps service availability unknown when the official office record has no service list", async () => {
  const tools = toolsFor(createApi({
    listOffices: async () => [{ ...offices[0], serviceTypes: [] }],
  }));
  const result = await tools.compare_civil_offices.handler({
    serviceType: "주민등록표 등본",
  } as never);

  expect(result.content[0].text).toContain("업무 제공 여부: 미확인, 방문 전 확인 필요");
  expect(result.structuredContent?.offices).toEqual([
    expect.objectContaining({ serviceAvailability: "unknown" }),
  ]);
});

test("rejects overlong and over-limit tool input before it reaches the provider", () => {
  const tools = toolsFor();

  expect(tools.compare_civil_offices.inputSchema.safeParse({
    serviceType: "가".repeat(51),
  }).success).toBe(false);
  expect(tools.compare_civil_offices.inputSchema.safeParse({
    serviceType: "주민등록표 등본",
    limit: 11,
  }).success).toBe(false);
});

test("converts provider errors into a safe tool error", async () => {
  const tools = toolsFor(createApi({
    listOffices: async () => { throw new Error("upstream failure"); },
  }));
  const result = await tools.compare_civil_offices.handler({
    serviceType: "주민등록표 등본",
  } as never);

  expect(result).toMatchObject({ isError: true });
  expect(result.content[0].text).toContain("불러오지 못했습니다");
  expect(result.content[0].text).not.toContain("upstream failure");
});

test("returns a checklist with official source, query time, and unavailable live state", async () => {
  const tools = toolsFor();
  const result = await tools.get_civil_checklist.handler({
    serviceType: "여권",
  } as never);

  expect(result.content[0].text).toContain("여권");
  expect(result.content[0].text).toContain("실시간 대기 정보: 제공하지 않음");
  expect(result.structuredContent).toMatchObject({
    serviceType: "여권",
    queriedAt: "2026-07-14T01:23:45.000Z",
    liveDataAvailable: false,
    openState: "unknown",
    sourceUrl: expect.stringMatching(/^https:\/\/www\.gov\.kr\//),
  });
});

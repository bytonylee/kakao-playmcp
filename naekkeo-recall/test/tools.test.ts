import { expect, test, vi } from "vitest";

import type { CertificationRecord, RecallRecord } from "../src/domain.js";
import { createMcpServer } from "../src/mcp.js";

const recall: RecallRecord = {
  id: "3802",
  productName: "아동용 카시트",
  modelName: "A-123 Pro",
  certificationNumbers: ["CB123A123-1234"],
  companyName: "세이프라이드코리아",
  actionGuidance: "무상 수리 또는 교환",
};

const certification: CertificationRecord = {
  id: "1231231",
  certificationNumber: "CB123A123-1234",
  productName: "아동용 카시트",
  modelName: "A-123 Pro",
};

function createApi(overrides: Partial<{
  availability: "available" | "unavailable";
  searchRecalls: () => Promise<RecallRecord[]>;
  searchCertifications: () => Promise<CertificationRecord[]>;
}> = {}) {
  return {
    availability: "available" as const,
    searchRecalls: vi.fn(async () => [recall]),
    searchCertifications: vi.fn(async () => [certification]),
    ...overrides,
  };
}

interface ToolResult {
  readonly content: readonly { readonly type: string; readonly text: string }[];
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
}

function toolsFor(api = createApi()) {
  const server = createMcpServer({ api, now: () => new Date("2026-07-14T01:23:45.000Z") });
  const registered = (server as unknown as { _registeredTools: Record<string, {
    description?: string;
    annotations?: Record<string, unknown>;
    inputSchema: { safeParse(value: unknown): { success: boolean } };
    handler: (args: never) => Promise<ToolResult>;
  }> })._registeredTools;
  return new Map(Object.entries(registered));
}

test("registers four annotated My Recall(내꺼리콜) tools with input schemas", () => {
  const tools = toolsFor();

  expect([...tools.keys()]).toEqual([
    "search_product_safety",
    "verify_recall_match",
    "make_recall_action_plan",
    "check_products_batch",
  ]);

  for (const [name, tool] of tools) {
    expect(tool.description).toContain("My Recall(내꺼리콜)");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.annotations).toMatchObject({
      title: expect.any(String),
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(name).not.toContain("kakao");
  }
});

test("returns compact Korean safety results with official sources, query time, and structured content", async () => {
  const result = await toolsFor().get("search_product_safety")!.handler({
    productName: "아동용 카시트",
  } as never);

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain("제품 안전 조회");
  expect(result.content[0].text).toContain("공식 출처");
  expect(result.content[0].text).toContain("조회 시각: 2026-07-14T01:23:45.000Z");
  expect(result.content[0].text.length).toBeLessThan(1_000);
  expect(result.structuredContent).toMatchObject({
    queriedAt: "2026-07-14T01:23:45.000Z",
    availability: "available",
    sourceUrls: [
      "https://www.safetykorea.kr/openapi/api/recall/recallList.json",
      "https://www.safetykorea.kr/openapi/api/cert/certificationList.json",
    ],
    recalls: [{ id: "3802", productName: "아동용 카시트" }],
    certifications: [{ id: "1231231", certificationNumber: "CB123A123-1234" }],
  });
});

test("states that no match is not a safety guarantee", async () => {
  const result = await toolsFor(createApi({
    searchRecalls: async () => [],
    searchCertifications: async () => [],
  })).get("verify_recall_match")!.handler({ modelName: "Z-999" } as never);

  expect(result.content[0].text).toContain("제품의 안전을 보장하지 않습니다");
  expect(result.structuredContent).toMatchObject({ matches: [{ level: "no_match" }] });
});

test("returns an explicit live-data unavailable result when the service key is absent", async () => {
  const result = await toolsFor(createApi({
    availability: "unavailable",
    searchRecalls: async () => [],
    searchCertifications: async () => [],
  })).get("search_product_safety")!.handler({ productName: "아동용 카시트" } as never);

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain("실시간 공식 조회를 사용할 수 없습니다");
  expect(result.structuredContent).toMatchObject({ availability: "unavailable" });
});

test("limits batch checks to ten products and rejects oversized strings or payloads", async () => {
  const tool = toolsFor().get("check_products_batch")!;

  expect(tool.inputSchema.safeParse({
    products: Array.from({ length: 11 }, () => ({ productName: "카시트" })),
  }).success).toBe(false);
  expect(tool.inputSchema.safeParse({
    products: [{ productName: "가".repeat(101) }],
  }).success).toBe(false);
  expect(tool.inputSchema.safeParse({
    products: Array.from({ length: 10 }, () => ({
      productName: "가".repeat(100),
      modelName: "가".repeat(100),
      manufacturerName: "가".repeat(100),
      manufacturedAt: "가".repeat(100),
    })),
  }).success).toBe(false);
});

test("produces an action plan from confirmed official recall information", async () => {
  const result = await toolsFor().get("make_recall_action_plan")!.handler({
    certificationNumber: "CB123A123-1234",
  } as never);

  expect(result.content[0].text).toContain("즉시 사용을 중지하세요");
  expect(result.content[0].text).toContain("공식 조치 안내: 무상 수리 또는 교환");
  expect(result.structuredContent).toMatchObject({
    availability: "available",
    plan: { steps: expect.arrayContaining(["즉시 사용을 중지하세요."]) },
  });
});

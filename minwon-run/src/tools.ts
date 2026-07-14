import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getChecklist } from "./checklists.js";
import { rankOffices, type CivilOffice, type RankedOffice, type WaitStatus } from "./domain.js";

const OFFICE_SOURCE_URL = "https://apis.data.go.kr/B551982/cso_v2/cso_info_v2";
const WAIT_SOURCE_URL = "https://apis.data.go.kr/B551982/cso_v2/cso_realtime_v2";
const MAX_CANDIDATES = 10;

export interface CivilDataProvider {
  readonly liveDataAvailable: boolean;
  listOffices(stdgCd?: string): Promise<CivilOffice[]>;
  listWaits(stdgCd?: string): Promise<WaitStatus[]>;
}

export interface MinwonToolOptions {
  readonly api: CivilDataProvider;
  readonly now?: () => Date;
}

const officeInputSchema = z.object({
  serviceType: z.string().trim().min(1).max(50),
  stdgCd: z.string().regex(/^\d{10}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  limit: z.number().int().min(1).max(MAX_CANDIDATES).default(5),
});

const checklistInputSchema = z.object({
  serviceType: z.string().trim().min(1).max(50),
});

export function registerMinwonTools(server: McpServer, options: MinwonToolOptions): void {
  const now = options.now ?? (() => new Date());

  server.registerTool("plan_civil_visit", {
    description: "Minwon Run(민원런) creates a civil-office visit plan from official office and live waiting data.",
    inputSchema: officeInputSchema,
    annotations: annotations("민원 방문 계획", true),
  }, async (input) => {
    try {
      const checklist = getChecklist(input.serviceType);
      const result = await officeResult(options.api, input, now, "방문 계획");
      if ("isError" in result && result.isError) {
        return result;
      }
      return {
        ...result,
        content: [{
          type: "text",
          text: `${result.content[0].text}\n\n준비물: ${checklist.preparations.join(", ")}\n온라인: ${checklist.online.note}`,
        }],
        structuredContent: {
          ...result.structuredContent,
          checklist: {
            preparations: checklist.preparations,
            online: checklist.online,
            fee: checklist.fee,
            sourceUrl: checklist.officialGuidance.sourceUrl,
          },
        },
      };
    } catch {
      return toolError(now());
    }
  });

  server.registerTool("compare_civil_offices", {
    description: "Minwon Run(민원런) compares nearby civil offices by service availability, open state, and official wait data.",
    inputSchema: officeInputSchema,
    annotations: annotations("민원실 비교", true),
  }, async (input) => officeResult(options.api, input, now, "민원실 비교"));

  server.registerTool("get_civil_checklist", {
    description: "Minwon Run(민원런) provides an official civil-service checklist before a visit or online application.",
    inputSchema: checklistInputSchema,
    annotations: annotations("민원 준비물", false),
  }, async (input) => {
    const queriedAt = now().toISOString();
    try {
      const checklist = getChecklist(input.serviceType);
      return {
        content: [{
          type: "text",
          text: [
            `# ${checklist.serviceType} 준비물`,
            `* 조회 시각: ${queriedAt}`,
            "* 실시간 대기 정보: 제공하지 않음",
            "* 운영 상태: 확인할 수 없음",
            `* 공식 출처: ${checklist.officialGuidance.sourceUrl}`,
            "",
            `준비물: ${checklist.preparations.join(", ")}`,
            `온라인: ${checklist.online.note}`,
            `수수료: ${checklist.fee.summary}`,
          ].join("\n"),
        }],
        structuredContent: {
          serviceType: checklist.serviceType,
          queriedAt,
          liveDataAvailable: false,
          openState: "unknown",
          sourceUrl: checklist.officialGuidance.sourceUrl,
          checklist,
        },
      };
    } catch {
      return toolError(new Date(queriedAt));
    }
  });
}

function annotations(title: string, openWorldHint: boolean) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint,
  };
}

async function officeResult(
  api: CivilDataProvider,
  input: z.infer<typeof officeInputSchema>,
  now: () => Date,
  heading: string,
) {
  const queriedAtDate = now();
  const queriedAt = queriedAtDate.toISOString();
  try {
    const [offices, waits] = await Promise.all([
      api.listOffices(input.stdgCd),
      api.listWaits(input.stdgCd),
    ]);
    const ranked = rankOffices(offices, waits, {
      serviceType: input.serviceType,
      at: queriedAtDate,
      ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
      ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
    }).slice(0, input.limit);
    const liveDataAvailable = api.liveDataAvailable;

    return {
      content: [{
        type: "text" as const,
        text: officeMarkdown(heading, input.serviceType, ranked, queriedAt, liveDataAvailable),
      }],
      structuredContent: {
        serviceType: input.serviceType,
        queriedAt,
        liveDataAvailable,
        openState: ranked[0]?.openState ?? "unknown",
        sourceUrls: [OFFICE_SOURCE_URL, WAIT_SOURCE_URL],
        offices: ranked.map(officeSummary),
      },
    };
  } catch {
    return toolError(new Date(queriedAt));
  }
}

function officeMarkdown(
  heading: string,
  serviceType: string,
  offices: readonly RankedOffice[],
  queriedAt: string,
  liveDataAvailable: boolean,
): string {
  const details = offices.length === 0
    ? "조건에 맞는 민원실을 찾지 못했습니다."
    : offices.map((office, index) => `${index + 1}. **${office.name}** | ${openStateText(office.openState)} | 대기 ${waitText(office)}\n   업무 제공 여부: ${serviceAvailabilityText(office)}\n   ${office.address}`).join("\n");

  return [
    `# ${serviceType} ${heading}`,
    `* 조회 시각: ${queriedAt}`,
    `* 실시간 대기 정보: ${liveDataAvailable ? "공식 데이터 제공" : "현재 제공되지 않음"}`,
    `* 공식 출처: ${OFFICE_SOURCE_URL}, ${WAIT_SOURCE_URL}`,
    "",
    details,
  ].join("\n");
}

function officeSummary(office: RankedOffice) {
  return {
    id: office.id,
    name: office.name,
    address: office.address,
    serviceAvailability: serviceAvailability(office),
    openState: office.openState,
    waitingCount: office.waitingCount,
    waitUpdatedAt: office.waitUpdatedAt,
    distanceMeters: office.distanceMeters,
    liveDataAvailable: office.liveDataAvailable,
  };
}

function openStateText(openState: RankedOffice["openState"]): string {
  if (openState === "open") {
    return "운영 중";
  }
  if (openState === "closed") {
    return "운영 종료";
  }
  return "운영 정보 미확인";
}

function waitText(office: RankedOffice): string {
  return office.waitingCount === undefined ? "미제공" : `${office.waitingCount}명`;
}

function serviceAvailability(office: RankedOffice): "available" | "unavailable" | "unknown" {
  if (office.serviceTypes.length === 0) {
    return "unknown";
  }
  return office.serviceAvailable ? "available" : "unavailable";
}

function serviceAvailabilityText(office: RankedOffice): string {
  const availability = serviceAvailability(office);
  if (availability === "available") {
    return "제공 확인";
  }
  if (availability === "unavailable") {
    return "제공 정보에 없음, 방문 전 확인 필요";
  }
  return "미확인, 방문 전 확인 필요";
}

function toolError(queriedAt: Date) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: "공식 민원실 정보를 지금 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }],
    structuredContent: {
      queriedAt: queriedAt.toISOString(),
      liveDataAvailable: false,
      openState: "unknown",
      sourceUrls: [OFFICE_SOURCE_URL, WAIT_SOURCE_URL],
    },
  };
}

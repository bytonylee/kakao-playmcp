import { z } from "zod";

import { makeRecallActionPlan } from "./actions.js";
import type {
  CertificationRecord,
  OfficialDataAvailability,
  ProductInput,
  RecallMatch,
  RecallRecord,
  SearchCriteria,
} from "./domain.js";
import { matchRecall } from "./matcher.js";

export const RECALL_SOURCE_URL = "https://www.safetykorea.kr/openapi/api/recall/recallList.json";
export const CERTIFICATION_SOURCE_URL = "https://www.safetykorea.kr/openapi/api/cert/certificationList.json";

export interface RecallSafetyApi {
  readonly availability: OfficialDataAvailability;
  searchRecalls(criteria: SearchCriteria): Promise<RecallRecord[]>;
  searchCertifications(criteria: SearchCriteria): Promise<CertificationRecord[]>;
}

export interface RecallToolDependencies {
  readonly api: RecallSafetyApi;
  readonly now?: () => Date;
}

const fieldSchema = z.string().trim().min(1).max(100);
const productInputSchema = z.object({
  productName: fieldSchema.optional(),
  modelName: fieldSchema.optional(),
  certificationNumber: fieldSchema.optional(),
  manufacturerName: fieldSchema.optional(),
  manufacturedAt: fieldSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.productName && !value.modelName && !value.certificationNumber) {
    context.addIssue({ code: "custom", message: "제품명, 모델명 또는 인증번호가 필요합니다." });
  }
});

export const searchProductSafetyInputSchema = productInputSchema;
export const verifyRecallMatchInputSchema = productInputSchema;
export const makeRecallActionPlanInputSchema = productInputSchema;
export const checkProductsBatchInputSchema = z.object({
  products: z.array(productInputSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value).length > 2_048) {
    context.addIssue({ code: "custom", message: "입력 전체 크기는 2048자 이하여야 합니다." });
  }
});

export async function searchProductSafety(dependencies: RecallToolDependencies, product: ProductInput): Promise<ToolResult> {
  const queriedAt = queryTime(dependencies);
  try {
    const criteria = toSearchCriteria(product);
    const [recalls, certifications] = await Promise.all([
      dependencies.api.searchRecalls(criteria),
      dependencies.api.searchCertifications(criteria),
    ]);
    const availability = dependencies.api.availability;
    const structuredContent = {
      queriedAt,
      availability,
      sourceUrls: [RECALL_SOURCE_URL, CERTIFICATION_SOURCE_URL],
      recalls: recalls.slice(0, 5).map(recallSummary),
      certifications: certifications.slice(0, 5).map(certificationSummary),
    };
    const text = availability === "unavailable"
      ? `## 제품 안전 조회\n실시간 공식 조회를 사용할 수 없습니다. 서비스 키 설정 또는 공식 출처를 확인하세요.\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`
      : `## 제품 안전 조회\n리콜 ${recalls.length}건, 인증 ${certifications.length}건을 찾았습니다.\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`;
    return success(text, structuredContent);
  } catch {
    return providerError(queriedAt);
  }
}

export async function verifyRecallMatch(dependencies: RecallToolDependencies, product: ProductInput): Promise<ToolResult> {
  const queriedAt = queryTime(dependencies);
  try {
    const recalls = await dependencies.api.searchRecalls(toSearchCriteria(product));
    const availability = dependencies.api.availability;
    const matches = availability === "unavailable" ? [] : matchRecall(product, recalls);
    const structuredContent = { queriedAt, availability, sourceUrls: [RECALL_SOURCE_URL], matches: matches.map(matchSummary) };
    if (availability === "unavailable") {
      return success(`## 리콜 대조\n실시간 공식 조회를 사용할 수 없습니다. 일치 여부를 판단하지 않았습니다.\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`, structuredContent);
    }
    return success(`## 리콜 대조\n${matches.map((match) => `- ${match.level}: ${match.reasons.join(" ")}`).join("\n")}\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`, structuredContent);
  } catch {
    return providerError(queriedAt);
  }
}

export async function createRecallActionPlan(dependencies: RecallToolDependencies, product: ProductInput): Promise<ToolResult> {
  const queriedAt = queryTime(dependencies);
  try {
    const recalls = await dependencies.api.searchRecalls(toSearchCriteria(product));
    const availability = dependencies.api.availability;
    const matches = availability === "unavailable" ? [] : matchRecall(product, recalls);
    const confirmed = matches.find((match) => match.level === "confirmed" && match.candidate)?.candidate;
    const structuredContent = {
      queriedAt,
      availability,
      sourceUrls: [RECALL_SOURCE_URL],
      matches: matches.map(matchSummary),
      ...(confirmed ? { plan: makeRecallActionPlan(confirmed) } : {}),
    };
    if (!confirmed) {
      const message = availability === "unavailable"
        ? "실시간 공식 조회를 사용할 수 없습니다. 조치 내용을 단정하지 않았습니다."
        : "공식 리콜 일치가 확인되지 않아 조치 내용을 단정하지 않습니다. 일치 정보 없음은 제품의 안전을 보장하지 않습니다.";
      return success(`## 리콜 조치 계획\n${message}\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`, structuredContent);
    }
    const plan = makeRecallActionPlan(confirmed);
    return success(`## 리콜 조치 계획\n${plan.steps.map((step) => `- ${step}`).join("\n")}\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`, structuredContent);
  } catch {
    return providerError(queriedAt);
  }
}

export async function checkProductsBatch(dependencies: RecallToolDependencies, products: readonly ProductInput[]): Promise<ToolResult> {
  const queriedAt = queryTime(dependencies);
  try {
    const checks = await Promise.all(products.map(async (product) => {
      const recalls = await dependencies.api.searchRecalls(toSearchCriteria(product));
      return matchRecall(product, recalls).map(matchSummary);
    }));
    const availability = dependencies.api.availability;
    const structuredContent = { queriedAt, availability, sourceUrls: [RECALL_SOURCE_URL], checks: availability === "available" ? checks : [] };
    const summary = availability === "unavailable"
      ? "실시간 공식 조회를 사용할 수 없습니다. 일괄 판정을 하지 않았습니다."
      : `${products.length}개 제품을 조회했습니다. 일치 정보 없음은 제품의 안전을 보장하지 않습니다.`;
    return success(`## 제품 일괄 점검\n${summary}\n\n공식 출처: ${RECALL_SOURCE_URL}\n조회 시각: ${queriedAt}`, structuredContent);
  } catch {
    return providerError(queriedAt);
  }
}

interface ToolResult extends Record<string, unknown> {
  readonly content: [{ type: "text"; text: string }];
  readonly structuredContent: Record<string, unknown>;
  readonly isError?: boolean;
}

function queryTime(dependencies: RecallToolDependencies): string {
  return (dependencies.now ?? (() => new Date()))().toISOString();
}

function toSearchCriteria(product: ProductInput): SearchCriteria {
  return {
    ...(product.productName ? { productName: product.productName } : {}),
    ...(product.modelName ? { modelName: product.modelName } : {}),
    ...(product.certificationNumber ? { certificationNumber: product.certificationNumber } : {}),
  };
}

function recallSummary(recall: RecallRecord): Record<string, unknown> {
  return {
    id: recall.id,
    productName: recall.productName,
    ...(recall.modelName ? { modelName: recall.modelName } : {}),
    ...(recall.companyName ? { companyName: recall.companyName } : {}),
    ...(recall.publishedAt ? { publishedAt: recall.publishedAt } : {}),
  };
}

function certificationSummary(certification: CertificationRecord): Record<string, unknown> {
  return {
    id: certification.id,
    certificationNumber: certification.certificationNumber,
    ...(certification.productName ? { productName: certification.productName } : {}),
    ...(certification.modelName ? { modelName: certification.modelName } : {}),
  };
}

function matchSummary(match: RecallMatch): Record<string, unknown> {
  return { level: match.level, reasons: match.reasons, ...(match.candidate ? { candidate: recallSummary(match.candidate) } : {}) };
}

function success(text: string, structuredContent: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}

function providerError(queriedAt: string): ToolResult {
  return {
    content: [{ type: "text", text: `공식 제품안전정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.\n조회 시각: ${queriedAt}` }],
    structuredContent: { queriedAt, availability: "unavailable", sourceUrls: [RECALL_SOURCE_URL] },
    isError: true,
  };
}

import type {
  CertificationRecord,
  OfficialDataAvailability,
  RecallRecord,
  SearchCriteria,
} from "./domain.js";
import type { MemoryTtlCache } from "./cache.js";

const RECALL_LIST_URL = "https://www.safetykorea.kr/openapi/api/recall/recallList.json";
const CERTIFICATION_LIST_URL = "https://www.safetykorea.kr/openapi/api/cert/certificationList.json";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 5_000;
const MAX_FIELD_LENGTH = 10_000;

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface SafetyKoreaApiOptions {
  readonly serviceId?: string;
  readonly fetch?: FetchFunction;
  readonly timeoutMs?: number;
  readonly cache?: Pick<MemoryTtlCache<Record<string, unknown>[]>, "get" | "set">;
}

export class SafetyKoreaApiError extends Error {
  constructor(
    readonly code: "timeout" | "upstream_error" | "invalid_response" | "invalid_criteria",
    message: string,
  ) {
    super(message);
    this.name = "SafetyKoreaApiError";
  }
}

export class SafetyKoreaApi {
  private readonly fetch: FetchFunction;
  private readonly serviceId: string | undefined;
  private readonly timeoutMs: number;
  private readonly cache: Pick<MemoryTtlCache<Record<string, unknown>[]>, "get" | "set"> | undefined;

  availability: OfficialDataAvailability = "unavailable";

  constructor(options: SafetyKoreaApiOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.serviceId = options.serviceId;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.cache = options.cache;
  }

  async searchRecalls(criteria: SearchCriteria): Promise<RecallRecord[]> {
    const data = await this.fetchList("recall", recallCondition(criteria));
    return data.map(toRecallRecord);
  }

  async searchCertifications(criteria: SearchCriteria): Promise<CertificationRecord[]> {
    const data = await this.fetchList("certification", certificationCondition(criteria));
    return data.map(toCertificationRecord);
  }

  private async fetchList(
    list: "recall" | "certification",
    { key, value }: { readonly key: string; readonly value: string },
  ): Promise<Record<string, unknown>[]> {
    if (!this.serviceId) {
      this.availability = "unavailable";
      return [];
    }

    const cacheKey = `${list}:${key}:${value}`;
    const cached = this.cache?.get(cacheKey);
    if (cached !== undefined) {
      this.availability = "available";
      return cached;
    }

    const baseUrl = list === "recall" ? RECALL_LIST_URL : CERTIFICATION_LIST_URL;
    const query = new URLSearchParams({ conditionKey: key, conditionValue: value });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${baseUrl}?${query.toString()}`, {
        headers: { AuthKey: this.serviceId },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw upstreamError();
      }

      const data = parseResponse(await readBoundedJson(response));
      this.availability = "available";
      this.cache?.set(cacheKey, data);
      return data;
    } catch (error) {
      this.availability = "unavailable";
      if (controller.signal.aborted || isAbortError(error)) {
        throw new SafetyKoreaApiError("timeout", "제품안전정보센터 조회 시간이 초과되었습니다.");
      }
      if (error instanceof SafetyKoreaApiError) {
        throw error;
      }
      throw upstreamError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    throw invalidResponse();
  }
  if (!response.body) {
    throw invalidResponse();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw invalidResponse();
  }
}

function recallCondition(criteria: SearchCriteria): { key: string; value: string } {
  if (nonEmpty(criteria.certificationNumber)) {
    return { key: "certNum", value: criteria.certificationNumber.trim() };
  }
  if (nonEmpty(criteria.modelName)) {
    return { key: "recallModelName", value: criteria.modelName.trim() };
  }
  if (nonEmpty(criteria.productName)) {
    return { key: "recallProductName", value: criteria.productName.trim() };
  }
  throw new SafetyKoreaApiError("invalid_criteria", "제품명, 모델명 또는 인증번호가 필요합니다.");
}

function certificationCondition(criteria: SearchCriteria): { key: string; value: string } {
  if (nonEmpty(criteria.certificationNumber)) {
    return { key: "certNum", value: criteria.certificationNumber.trim() };
  }
  if (nonEmpty(criteria.modelName)) {
    return { key: "modelName", value: criteria.modelName.trim() };
  }
  if (nonEmpty(criteria.productName)) {
    return { key: "productName", value: criteria.productName.trim() };
  }
  throw new SafetyKoreaApiError("invalid_criteria", "제품명, 모델명 또는 인증번호가 필요합니다.");
}

function parseResponse(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }

  if (payload.resultCode === "2004" || payload.resultCode === 2004) {
    return [];
  }
  if (payload.resultCode !== "2000" && payload.resultCode !== 2000) {
    throw upstreamError();
  }
  if (!Array.isArray(payload.resultData) || payload.resultData.length > MAX_RECORDS) {
    throw invalidResponse();
  }
  return payload.resultData.map(asRecord);
}

function toRecallRecord(item: Record<string, unknown>): RecallRecord {
  const brandName = optionalString(item, ["recallBrandName"]);
  const modelName = optionalString(item, ["recallModelName"]);
  const recallMeans = optionalString(item, ["recallMeans"]);
  const barcodeNumber = optionalString(item, ["barcodeNum"]);
  const recallType = optionalString(item, ["recallTypeName"]);
  const inquiryPhone = optionalString(item, ["recallInqryTel"]);
  const companyName = optionalString(item, ["recallCmpnyName"]);
  const manufacturerName = optionalString(item, ["makerName"]);
  const publishedAt = optionalString(item, ["publishDate"]);
  const defectDescription = optionalString(item, ["harmDscr"]);
  const accidentDescription = optionalString(item, ["accidentCaseDscr"]);
  const actionGuidance = optionalString(item, ["publishActionDscr"]);

  return {
    id: requiredString(item, ["recallUid"]),
    productName: requiredString(item, ["recallProductName"]),
    ...(brandName ? { brandName } : {}),
    ...(modelName ? { modelName } : {}),
    ...(recallMeans ? { recallMeans } : {}),
    ...(barcodeNumber ? { barcodeNumber } : {}),
    certificationNumbers: splitValues(item.certNum),
    ...(recallType ? { recallType } : {}),
    ...(inquiryPhone ? { inquiryPhone } : {}),
    ...(companyName ? { companyName } : {}),
    ...(manufacturerName ? { manufacturerName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(defectDescription ? { defectDescription } : {}),
    ...(accidentDescription ? { accidentDescription } : {}),
    ...(actionGuidance ? { actionGuidance } : {}),
  };
}

function toCertificationRecord(item: Record<string, unknown>): CertificationRecord {
  const status = optionalString(item, ["certState"]);
  const certificationType = optionalString(item, ["certDiv"]);
  const firstCertificationNumber = optionalString(item, ["firstCertNum"]);
  const productName = optionalString(item, ["productName"]);
  const brandName = optionalString(item, ["brandName"]);
  const modelName = optionalString(item, ["modelName"]);
  const categoryName = optionalString(item, ["categoryName"]);
  const manufacturerName = optionalString(item, ["makerName"]);
  const importerName = optionalString(item, ["importerName"]);
  const certifiedAt = optionalString(item, ["certDate"]);
  const registeredAt = optionalString(item, ["signDate"]);

  return {
    id: requiredString(item, ["certUid"]),
    certificationNumber: requiredString(item, ["certNum"]),
    ...(status ? { status } : {}),
    ...(certificationType ? { certificationType } : {}),
    ...(firstCertificationNumber ? { firstCertificationNumber } : {}),
    ...(productName ? { productName } : {}),
    ...(brandName ? { brandName } : {}),
    ...(modelName ? { modelName } : {}),
    ...(categoryName ? { categoryName } : {}),
    ...(manufacturerName ? { manufacturerName } : {}),
    ...(importerName ? { importerName } : {}),
    ...(certifiedAt ? { certifiedAt } : {}),
    ...(registeredAt ? { registeredAt } : {}),
  };
}

function requiredString(item: Record<string, unknown>, keys: readonly string[]): string {
  const value = optionalString(item, keys);
  if (!value) {
    throw invalidResponse();
  }
  return value;
}

function optionalString(item: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") {
      return boundedString(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function splitValues(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return boundedString(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}

function boundedString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    throw invalidResponse();
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function invalidResponse(): SafetyKoreaApiError {
  return new SafetyKoreaApiError("invalid_response", "제품안전정보센터 응답 형식이 올바르지 않습니다.");
}

function upstreamError(): SafetyKoreaApiError {
  return new SafetyKoreaApiError("upstream_error", "제품안전정보센터 정보를 불러오지 못했습니다.");
}

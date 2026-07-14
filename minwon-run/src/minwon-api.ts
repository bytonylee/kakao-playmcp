import type { CivilOffice, WaitStatus } from "./domain.js";

const API_BASE_URL = "https://apis.data.go.kr/B551982/cso_v2/";
const OFFICE_PATH = "cso_info_v2";
const WAIT_PATH = "cso_realtime_v2";

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;

export interface MinwonApiOptions {
  readonly serviceKey?: string;
  readonly fetch?: FetchFunction;
  readonly timeoutMs?: number;
}

export class MinwonApiError extends Error {
  constructor(
    readonly code: "timeout" | "upstream_error" | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "MinwonApiError";
  }
}

export class MinwonApi {
  private readonly fetch: FetchFunction;
  private readonly serviceKey: string | undefined;
  private readonly timeoutMs: number;

  liveDataAvailable = false;

  constructor(options: MinwonApiOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.serviceKey = options.serviceKey;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  async listOffices(stdgCd?: string): Promise<CivilOffice[]> {
    const items = await this.request(OFFICE_PATH, stdgCd);
    return items.map(toCivilOffice);
  }

  async listWaits(stdgCd?: string): Promise<WaitStatus[]> {
    if (!this.serviceKey) {
      this.liveDataAvailable = false;
      return [];
    }

    const waits = (await this.request(WAIT_PATH, stdgCd)).map(toWaitStatus);
    this.liveDataAvailable = waits.length > 0;
    return waits;
  }

  private async request(path: string, stdgCd?: string): Promise<Record<string, unknown>[]> {
    if (!this.serviceKey) {
      return [];
    }

    const url = new URL(path, API_BASE_URL);
    url.search = new URLSearchParams({
      serviceKey: this.serviceKey,
      pageNo: "1",
      numOfRows: "100",
      type: "JSON",
      ...(stdgCd ? { stdgCd } : {}),
    }).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new MinwonApiError("upstream_error", "민원실 정보를 불러오지 못했습니다.");
      }
      return parseItems(await response.json());
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new MinwonApiError("timeout", "민원실 실시간 정보 조회 시간이 초과되었습니다.");
      }
      if (error instanceof MinwonApiError) {
        throw error;
      }
      throw new MinwonApiError("upstream_error", "민원실 정보를 불러오지 못했습니다.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseItems(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }

  const response = isRecord(payload.response) ? payload.response : payload;
  const header = isRecord(response.header) ? response.header : undefined;
  const resultCode = header?.resultCode ?? header?.resultcode;
  if (resultCode !== undefined && resultCode !== "00") {
    throw new MinwonApiError("upstream_error", "민원실 정보를 불러오지 못했습니다.");
  }

  const body = isRecord(response.body) ? response.body : undefined;
  const items = body && isRecord(body.items) ? body.items.item : undefined;
  if (items === undefined) {
    throw invalidResponse();
  }
  if (Array.isArray(items)) {
    return items.map(asRecord);
  }
  return [asRecord(items)];
}

function toCivilOffice(item: Record<string, unknown>): CivilOffice {
  const id = requiredString(item, ["csoId", "csoid", "CSO_ID", "id"]);
  const name = requiredString(item, ["csoNm", "csoName", "CSO_NM", "name"]);
  const address = requiredString(item, ["addr", "address", "adres", "ADDR"]);
  const opensAt = optionalString(item, ["weekdayStartTime", "openTime", "WKDAY_BGN_TIME"]);
  const closesAt = optionalString(item, ["weekdayEndTime", "closeTime", "WKDAY_END_TIME"]);
  const latitude = optionalNumber(item, ["latitude", "lat", "LAT"]);
  const longitude = optionalNumber(item, ["longitude", "lng", "lon", "LON"]);

  if ((opensAt === undefined) !== (closesAt === undefined)) {
    throw invalidResponse();
  }
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw invalidResponse();
  }

  return {
    id,
    name,
    address,
    ...(optionalString(item, ["stdgCd", "stdgcd", "STDG_CD"]) ? { stdgCd: optionalString(item, ["stdgCd", "stdgcd", "STDG_CD"]) } : {}),
    serviceTypes: splitServices(item.workList ?? item.serviceTypes ?? item.serviceList),
    ...(opensAt && closesAt ? { weekdayHours: { opensAt, closesAt } } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
  };
}

function toWaitStatus(item: Record<string, unknown>): WaitStatus {
  const waitingCount = optionalNumber(item, ["waitCnt", "waitCount", "waitingCount", "WAIT_CNT"]);
  if (waitingCount === undefined || waitingCount < 0 || !Number.isInteger(waitingCount)) {
    throw invalidResponse();
  }

  return {
    officeId: requiredString(item, ["csoId", "csoid", "CSO_ID", "officeId"]),
    waitingCount,
    ...(optionalString(item, ["updatedAt", "updateTime", "regDt", "UPDT_DT"]) ? { updatedAt: optionalString(item, ["updatedAt", "updateTime", "regDt", "UPDT_DT"]) } : {}),
  };
}

function splitServices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
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
      return value.trim();
    }
  }
  return undefined;
}

function optionalNumber(item: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function invalidResponse(): MinwonApiError {
  return new MinwonApiError("invalid_response", "민원실 정보 응답 형식이 올바르지 않습니다.");
}

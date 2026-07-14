import type { CivilOffice, ConditionalOperatingSchedule, WaitStatus } from "./domain.js";
import type { MemoryTtlCache } from "./cache.js";

const API_BASE_URL = "https://apis.data.go.kr/B551982/cso_v2/";
const OFFICE_PATH = "cso_info_v2";
const WAIT_PATH = "cso_realtime_v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FIELD_LENGTH = 10_000;

type FetchFunction = (input: string, init?: RequestInit) => Promise<Response>;
type Item = Record<string, unknown>;

interface ApiPage {
  readonly items: Item[];
  readonly totalCount?: number;
  readonly bytesRead: number;
}

export interface MinwonApiOptions {
  readonly serviceKey?: string;
  readonly fetch?: FetchFunction;
  readonly timeoutMs?: number;
  readonly cache?: Pick<MemoryTtlCache<Item[]>, "get" | "set">;
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
  private readonly cache: Pick<MemoryTtlCache<Item[]>, "get" | "set"> | undefined;

  liveDataAvailable = false;

  constructor(options: MinwonApiOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.serviceKey = options.serviceKey;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.cache = options.cache;
  }

  async listOffices(stdgCd?: string): Promise<CivilOffice[]> {
    const offices = new Map<string, CivilOffice>();
    for (const item of await this.request(OFFICE_PATH, stdgCd)) {
      const office = toCivilOffice(item);
      if (!offices.has(office.id)) {
        offices.set(office.id, office);
      }
    }
    return [...offices.values()];
  }

  async listWaits(stdgCd?: string): Promise<WaitStatus[]> {
    this.liveDataAvailable = false;
    if (!this.serviceKey) {
      return [];
    }

    const waits = aggregateWaits(await this.request(WAIT_PATH, stdgCd));
    this.liveDataAvailable = waits.length > 0;
    return waits;
  }

  private async request(path: string, stdgCd?: string): Promise<Item[]> {
    if (!this.serviceKey) {
      return [];
    }

    const cacheKey = `${path}:${stdgCd ?? ""}`;
    const cached = this.cache?.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const deadline = Date.now() + this.timeoutMs;
    let remainingBytes = MAX_RESPONSE_BYTES;
    let page = await this.requestPage(path, 1, deadline, remainingBytes, stdgCd);
    remainingBytes -= page.bytesRead;
    const items = [...page.items];
    const expectedPages = page.totalCount === undefined
      ? MAX_PAGES
      : Math.min(Math.ceil(page.totalCount / PAGE_SIZE), MAX_PAGES);

    for (let pageNo = 2; pageNo <= expectedPages && page.items.length === PAGE_SIZE; pageNo += 1) {
      page = await this.requestPage(path, pageNo, deadline, remainingBytes, stdgCd);
      remainingBytes -= page.bytesRead;
      items.push(...page.items);
    }

    this.cache?.set(cacheKey, items);
    return items;
  }

  private async requestPage(path: string, pageNo: number, deadline: number, maxResponseBytes: number, stdgCd?: string): Promise<ApiPage> {
    const url = new URL(path, API_BASE_URL);
    url.search = new URLSearchParams({
      serviceKey: this.serviceKey!,
      pageNo: String(pageNo),
      numOfRows: String(PAGE_SIZE),
      type: "JSON",
      ...(stdgCd ? { stdgCd } : {}),
    }).toString();

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw timeoutError();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await this.fetch(url.toString(), { redirect: "error", signal: controller.signal });
      if (!response.ok) {
        throw new MinwonApiError("upstream_error", "민원실 정보를 불러오지 못했습니다.");
      }
      const body = await readBoundedJson(response, maxResponseBytes);
      return { ...parsePage(body.value), bytesRead: body.bytesRead };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw timeoutError();
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

async function readBoundedJson(response: Response, maxBytes: number): Promise<{ readonly value: unknown; readonly bytesRead: number }> {
  const declaredLength = response.headers.get("content-length");
  const declaredBytes = declaredLength === null ? undefined : Number(declaredLength);
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || declaredBytes! > maxBytes)) {
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
      if (totalBytes > maxBytes) {
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
    return {
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
      bytesRead: Math.max(totalBytes, declaredBytes ?? 0),
    };
  } catch (error) {
    if (error instanceof MinwonApiError) {
      throw error;
    }
    throw invalidResponse();
  }
}

function timeoutError(): MinwonApiError {
  return new MinwonApiError("timeout", "민원실 실시간 정보 조회 시간이 초과되었습니다.");
}

function parsePage(payload: unknown): Omit<ApiPage, "bytesRead"> {
  if (!isRecord(payload)) {
    throw invalidResponse();
  }

  const response = isRecord(payload.response) ? payload.response : payload;
  const header = isRecord(response.header) ? response.header : undefined;
  const resultCode = optionalString(header, ["resultCode", "resultcode"]);
  if (resultCode === "K03") {
    return { items: [], totalCount: 0 };
  }
  if (resultCode !== undefined && resultCode !== "00" && resultCode !== "K0") {
    throw new MinwonApiError("upstream_error", "민원실 정보를 불러오지 못했습니다.");
  }

  const body = isRecord(response.body) ? response.body : undefined;
  if (!body) {
    throw invalidResponse();
  }
  const totalCount = optionalCount(body.totalCount);
  const rawItems = isRecord(body.items) ? body.items.item : undefined;
  if (rawItems === undefined || rawItems === null || rawItems === "") {
    if (totalCount === undefined || totalCount === 0) {
      return { items: [], totalCount };
    }
    throw invalidResponse();
  }
  if (Array.isArray(rawItems)) {
    if (rawItems.length > PAGE_SIZE) {
      throw invalidResponse();
    }
    return { items: rawItems.map(asRecord), totalCount };
  }
  return { items: [asRecord(rawItems)], totalCount };
}

function toCivilOffice(item: Item): CivilOffice {
  const roadAddress = optionalString(item, ["roadNmAddr"]);
  const lotNumberAddress = optionalString(item, ["lotnoAddr"]);
  const address = roadAddress ?? lotNumberAddress;
  const stdgCd = optionalString(item, ["stdgCd"]);
  const opensAt = normalizeOperatingTime(optionalString(item, ["wkdyOperBgngTm"]));
  const closesAt = normalizeOperatingTime(optionalString(item, ["wkdyOperEndTm"]));
  const night = toConditionalOperatingSchedule(item, "nghtOperYn", "nghtDowExpln");
  const weekend = toConditionalOperatingSchedule(item, "wkndOperYn", "wkndDowExpln");
  const latitude = optionalNumber(item, ["lat"]);
  const longitude = optionalNumber(item, ["lot"]);

  if ((opensAt === undefined) !== (closesAt === undefined)) {
    throw invalidResponse();
  }
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw invalidResponse();
  }
  if (!address) {
    throw invalidResponse();
  }

  return {
    id: requiredString(item, ["csoSn"]),
    name: requiredString(item, ["csoNm"]),
    address,
    ...(roadAddress ? { roadAddress } : {}),
    ...(lotNumberAddress ? { lotNumberAddress } : {}),
    ...(stdgCd ? { stdgCd } : {}),
    serviceTypes: splitServices(item.workList),
    ...(opensAt && closesAt ? { weekdayHours: { opensAt, closesAt } } : {}),
    ...(opensAt || night || weekend ? {
      operatingSchedule: {
        ...(opensAt && closesAt ? { weekdayHours: { opensAt, closesAt } } : {}),
        ...(night ? { night } : {}),
        ...(weekend ? { weekend } : {}),
      },
    } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
  };
}

function toConditionalOperatingSchedule(
  item: Item,
  availabilityKey: string,
  explanationKey: string,
): ConditionalOperatingSchedule | undefined {
  const value = optionalString(item, [availabilityKey]);
  if (value !== "Y" && value !== "N") {
    return undefined;
  }

  const explanation = optionalString(item, [explanationKey]);
  return {
    availability: value === "Y" ? "operating" : "closed",
    ...(explanation ? { explanation } : {}),
  };
}

function aggregateWaits(items: readonly Item[]): WaitStatus[] {
  const seenRecords = new Set<string>();
  const waitsByOffice = new Map<string, WaitStatus>();

  for (const item of items) {
    const recordKey = stableRecordKey(item);
    if (seenRecords.has(recordKey)) {
      continue;
    }
    seenRecords.add(recordKey);

    const wait = toWaitStatus(item);
    if (!wait) {
      continue;
    }
    const previous = waitsByOffice.get(wait.officeId);
    if (!previous) {
      waitsByOffice.set(wait.officeId, wait);
      continue;
    }

    const waitingCount = previous.waitingCount + wait.waitingCount;
    if (!Number.isSafeInteger(waitingCount)) {
      continue;
    }
    waitsByOffice.set(wait.officeId, {
      officeId: wait.officeId,
      waitingCount,
      ...(newerTimestamp(wait.updatedAt, previous.updatedAt) ? { updatedAt: wait.updatedAt } : previous.updatedAt ? { updatedAt: previous.updatedAt } : {}),
    });
  }

  return [...waitsByOffice.values()].sort((left, right) => left.officeId.localeCompare(right.officeId, "ko"));
}

function toWaitStatus(item: Item): WaitStatus | undefined {
  const officeId = optionalString(item, ["csoSn"]);
  const waitingCount = optionalNumber(item, ["wtngCnt"]);
  if (!officeId || waitingCount === undefined || !Number.isSafeInteger(waitingCount) || waitingCount < 0) {
    return undefined;
  }

  const updatedAt = optionalString(item, ["totDt"]);
  return { officeId, waitingCount, ...(updatedAt ? { updatedAt } : {}) };
}

function normalizeOperatingTime(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) {
    throw invalidResponse();
  }
  const [hours, minutes, seconds] = match.slice(1).map(Number);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw invalidResponse();
  }
  return `${match[1]}:${match[2]}`;
}

function splitServices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && boundedString(item) !== "").map((item) => boundedString(item));
  }
  if (typeof value === "string") {
    return boundedString(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function newerTimestamp(candidate: string | undefined, current: string | undefined): boolean {
  if (!candidate) {
    return false;
  }
  if (!current) {
    return true;
  }
  return candidate > current;
}

function stableRecordKey(item: Item): string {
  return JSON.stringify(Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))));
}

function optionalCount(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw invalidResponse();
  }
  return count;
}

function requiredString(item: Item, keys: readonly string[]): string {
  const value = optionalString(item, keys);
  if (!value) {
    throw invalidResponse();
  }
  return value;
}

function optionalString(item: Item | undefined, keys: readonly string[]): string | undefined {
  if (!item) {
    return undefined;
  }
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") {
      return boundedString(value);
    }
  }
  return undefined;
}

function boundedString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    throw invalidResponse();
  }
  return trimmed;
}

function optionalNumber(item: Item, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Item {
  if (!isRecord(value)) {
    throw invalidResponse();
  }
  return value;
}

function isRecord(value: unknown): value is Item {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function invalidResponse(): MinwonApiError {
  return new MinwonApiError("invalid_response", "민원실 정보 응답 형식이 올바르지 않습니다.");
}

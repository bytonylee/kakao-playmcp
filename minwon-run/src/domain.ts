export type OfficeOpenState = "open" | "closed" | "unknown";

export interface OperatingHours {
  readonly opensAt: string;
  readonly closesAt: string;
}

export interface ConditionalOperatingSchedule {
  readonly availability: "operating" | "closed";
  readonly explanation?: string;
}

export interface OfficeOperatingSchedule {
  readonly weekdayHours?: OperatingHours;
  readonly night?: ConditionalOperatingSchedule;
  readonly weekend?: ConditionalOperatingSchedule;
}

export interface CivilOffice {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly roadAddress?: string;
  readonly lotNumberAddress?: string;
  readonly stdgCd?: string;
  readonly serviceTypes: readonly string[];
  readonly weekdayHours?: OperatingHours;
  readonly operatingSchedule?: OfficeOperatingSchedule;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface WaitStatus {
  readonly officeId: string;
  readonly waitingCount: number;
  readonly updatedAt?: string;
}

export interface CivilVisitQuery {
  readonly serviceType: string;
  readonly at?: Date;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface RankedOffice extends CivilOffice {
  readonly serviceAvailable: boolean;
  readonly isOpen: boolean;
  readonly openState: OfficeOpenState;
  readonly waitingCount?: number;
  readonly waitUpdatedAt?: string;
  readonly distanceMeters?: number;
  readonly liveDataAvailable: boolean;
}

const KOREA_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function rankOffices(
  offices: readonly CivilOffice[],
  waits: readonly WaitStatus[],
  query: CivilVisitQuery,
): RankedOffice[] {
  const waitsByOffice = new Map(waits.map((wait) => [wait.officeId, wait]));
  const at = query.at ?? new Date();

  return offices
    .map((office) => {
      const wait = waitsByOffice.get(office.id);
      const distanceMeters = calculateDistanceMeters(office, query);

      const openState = openStateAt(office.operatingSchedule, office.weekdayHours, at);
      return {
        ...office,
        serviceAvailable: office.serviceTypes.includes(query.serviceType),
        isOpen: openState === "open",
        openState,
        waitingCount: wait?.waitingCount,
        waitUpdatedAt: wait?.updatedAt,
        distanceMeters,
        liveDataAvailable: wait !== undefined,
      };
    })
    .sort((left, right) =>
      compareBooleans(left.serviceAvailable, right.serviceAvailable) ||
      compareBooleans(left.isOpen, right.isOpen) ||
      compareWaits(left.waitingCount, right.waitingCount) ||
      compareDistances(left.distanceMeters, right.distanceMeters) ||
      left.id.localeCompare(right.id, "ko"),
    );
}

function openStateAt(
  schedule: CivilOffice["operatingSchedule"],
  legacyWeekdayHours: CivilOffice["weekdayHours"],
  at: Date,
): OfficeOpenState {
  const parts = KOREA_TIME_FORMATTER.formatToParts(at);
  const weekday = datePart(parts, "weekday");
  if (weekday === "Sun" || weekday === "Sat") {
    return schedule?.weekend?.availability === "closed" ? "closed" : "unknown";
  }

  const hours = schedule?.weekdayHours ?? legacyWeekdayHours;
  if (!hours) {
    return "unknown";
  }

  const currentTime = Number(datePart(parts, "hour")) * 60 + Number(datePart(parts, "minute"));
  if (currentTime >= parseTime(hours.opensAt) && currentTime < parseTime(hours.closesAt)) {
    return "open";
  }
  if (currentTime >= parseTime(hours.closesAt) && schedule?.night?.availability === "operating") {
    return "unknown";
  }
  return "closed";
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function parseTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculateDistanceMeters(
  office: CivilOffice,
  query: CivilVisitQuery,
): number | undefined {
  if (
    office.latitude === undefined ||
    office.longitude === undefined ||
    query.latitude === undefined ||
    query.longitude === undefined
  ) {
    return undefined;
  }

  const radians = Math.PI / 180;
  const latitudeDelta = (office.latitude - query.latitude) * radians;
  const longitudeDelta = (office.longitude - query.longitude) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(query.latitude * radians) *
      Math.cos(office.latitude * radians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function compareBooleans(left: boolean, right: boolean): number {
  return Number(right) - Number(left);
}

function compareWaits(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

function compareDistances(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

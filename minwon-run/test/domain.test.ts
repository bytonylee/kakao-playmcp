import { expect, test } from "vitest";

import { getChecklist } from "../src/checklists.js";
import { rankOffices, type CivilOffice, type WaitStatus } from "../src/domain.js";

const offices: CivilOffice[] = [
  {
    id: "open-low-wait",
    name: "열린 민원실",
    address: "서울시 강남구",
    serviceTypes: ["주민등록표 등본"],
    weekdayHours: { opensAt: "09:00", closesAt: "18:00" },
    latitude: 37.5,
    longitude: 127.0,
  },
  {
    id: "open-high-wait",
    name: "열린 대기 민원실",
    address: "서울시 강남구",
    serviceTypes: ["주민등록표 등본"],
    weekdayHours: { opensAt: "09:00", closesAt: "18:00" },
    latitude: 37.51,
    longitude: 127.01,
  },
  {
    id: "closed",
    name: "닫힌 민원실",
    address: "서울시 강남구",
    serviceTypes: ["주민등록표 등본"],
    weekdayHours: { opensAt: "08:00", closesAt: "10:00" },
  },
  {
    id: "other-service",
    name: "다른 업무 민원실",
    address: "서울시 강남구",
    serviceTypes: ["여권"],
  },
];

const waits: WaitStatus[] = [
  { officeId: "open-low-wait", waitingCount: 2, updatedAt: "2026-07-14T10:00:00+09:00" },
  { officeId: "open-high-wait", waitingCount: 8, updatedAt: "2026-07-14T10:00:00+09:00" },
  { officeId: "closed", waitingCount: 0, updatedAt: "2026-07-14T10:00:00+09:00" },
];

test("joins wait data and ranks matching open offices by lower wait then distance", () => {
  const ranked = rankOffices(offices, waits, {
    serviceType: "주민등록표 등본",
    at: new Date("2026-07-14T10:30:00+09:00"),
    latitude: 37.5001,
    longitude: 127.0001,
  });

  expect(ranked.map((office) => office.id)).toEqual([
    "open-low-wait",
    "open-high-wait",
    "closed",
    "other-service",
  ]);
  expect(ranked[0]).toMatchObject({
    isOpen: true,
    waitingCount: 2,
    liveDataAvailable: true,
  });
  expect(ranked[2]).toMatchObject({ isOpen: false, waitingCount: 0 });
  expect(ranked[3]).toMatchObject({
    serviceAvailable: false,
    waitingCount: undefined,
    liveDataAvailable: false,
  });
  expect(ranked[0].distanceMeters).toBeLessThan(ranked[1].distanceMeters ?? Infinity);
});

test("uses a deterministic fallback order when live waits are unavailable", () => {
  const ranked = rankOffices(offices.slice(0, 2), [], {
    serviceType: "주민등록표 등본",
    at: new Date("2026-07-14T10:30:00+09:00"),
  });

  expect(ranked.map((office) => office.id)).toEqual(["open-high-wait", "open-low-wait"]);
  expect(ranked.every((office) => office.liveDataAvailable === false)).toBe(true);
});

test.each([
  ["주민등록표 등본", true, "400원"],
  ["인감증명", false, "600원"],
  ["전입신고", true, "무료"],
  ["여권", false, "53,000원"],
  ["가족관계증명서", true, "1,000원"],
] as const)("returns the supported %s checklist", (serviceType, onlineAvailable, fee) => {
  expect(getChecklist(serviceType)).toMatchObject({
    serviceType,
    onlineAvailable,
    fee,
  });
});

test("rejects an unsupported checklist service", () => {
  expect(() => getChecklist("운전면허")).toThrow(/지원하지 않는 민원/);
});

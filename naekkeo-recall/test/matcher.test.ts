import { expect, test } from "vitest";

import { matchRecall, normalizeProductText, type RecallRecord } from "../src/matcher.js";

const candidates: RecallRecord[] = [
  {
    id: "recall-1",
    productName: "아동용 카시트",
    modelName: "A-123 Pro, A-124 Pro",
    certificationNumbers: ["CB123A123-1234"],
  },
];

test("normalizes Korean and ASCII text before comparison", () => {
  expect(normalizeProductText("  아동용  Ａ-１２３  Pro  ")).toBe("아동용 a 123 pro");
});

test("confirms an exact certification-number match", () => {
  expect(matchRecall({ certificationNumber: "cb123a123-1234" }, candidates)).toEqual([
    {
      level: "confirmed",
      candidate: candidates[0],
      reasons: ["인증번호가 공식 리콜 정보와 정확히 일치합니다."],
    },
  ]);
});

test.each([
  ["ＭＳＩＰ－ＲＥＭ－ＴＳＤ－ＭＱ０４ＡＢＤ２００", "MSIP-REM-TSD-MQ04ABD200"],
  ["kcc-rem-sdb-rv-300hd", "KCC-REM-SDB-RV-300HD"],
  ["r-r-nid-plasmak", "R-R-Nid-PlasmaK"],
])("confirms an exact legacy or radio certification-number match (%s)", (certificationNumber, candidateCertificationNumber) => {
  const certifiedCandidate: RecallRecord = {
    ...candidates[0],
    certificationNumbers: [candidateCertificationNumber],
  };

  expect(matchRecall({ certificationNumber }, [certifiedCandidate])).toEqual([
    {
      level: "confirmed",
      candidate: certifiedCandidate,
      reasons: ["인증번호가 공식 리콜 정보와 정확히 일치합니다."],
    },
  ]);
});

test.each(["공급자적합성", "CB1", "CB 123A123-1234"])("does not confirm a description, short value, or spaced identifier (%s)", (certificationNumber) => {
  const describedCandidate: RecallRecord = {
    ...candidates[0],
    certificationNumbers: [certificationNumber],
  };

  expect(matchRecall({ certificationNumber }, [describedCandidate])).toEqual([
    {
      level: "no_match",
      reasons: ["공식 데이터에서 일치 항목을 찾지 못함. 이는 제품의 안전을 보장하지 않습니다."],
    },
  ]);
});

test("marks a normalized model token match for confirmation", () => {
  expect(matchRecall({ productName: "아동용 카시트", modelName: "Ａ １２３ pro" }, candidates)).toEqual([
    {
      level: "needs_confirmation",
      candidate: candidates[0],
      reasons: [
        "제품명 토큰이 공식 리콜 제품명에 포함됩니다.",
        "모델명 토큰이 공식 리콜 모델명에 포함됩니다.",
      ],
    },
  ]);
});

test("keeps multiple model candidates ambiguous", () => {
  const ambiguousCandidates = [
    candidates[0],
    {
      id: "recall-2",
      productName: "아동용 카시트",
      modelName: "A-123 Basic",
      certificationNumbers: [],
    },
  ];

  expect(matchRecall({ modelName: "A-123" }, ambiguousCandidates)).toEqual([
    {
      level: "needs_confirmation",
      candidate: ambiguousCandidates[0],
      reasons: [
        "모델명 토큰이 공식 리콜 모델명에 포함됩니다.",
        "공식 리콜 후보가 여러 건이라 추가 확인이 필요합니다.",
      ],
    },
    {
      level: "needs_confirmation",
      candidate: ambiguousCandidates[1],
      reasons: [
        "모델명 토큰이 공식 리콜 모델명에 포함됩니다.",
        "공식 리콜 후보가 여러 건이라 추가 확인이 필요합니다.",
      ],
    },
  ]);
});

test("does not create a recall candidate from a one-character model token", () => {
  expect(matchRecall({ modelName: "A" }, candidates)).toEqual([
    {
      level: "no_match",
      reasons: ["공식 데이터에서 일치 항목을 찾지 못함. 이는 제품의 안전을 보장하지 않습니다."],
    },
  ]);
});

test("does not create a recall candidate from a generic English product token", () => {
  const genericCandidate: RecallRecord = { ...candidates[0], productName: "Pro 카시트" };

  expect(matchRecall({ productName: "Pro" }, [genericCandidate])).toEqual([
    {
      level: "no_match",
      reasons: ["공식 데이터에서 일치 항목을 찾지 못함. 이는 제품의 안전을 보장하지 않습니다."],
    },
  ]);
});

test("matches an A-123 style model by its letter-number identifier combination", () => {
  const sameNumberDifferentPrefix: RecallRecord = {
    ...candidates[0],
    id: "recall-2",
    modelName: "B-123 Pro",
  };

  expect(matchRecall({ modelName: "A-123" }, [candidates[0], sameNumberDifferentPrefix])).toEqual([
    {
      level: "needs_confirmation",
      candidate: candidates[0],
      reasons: ["모델명 토큰이 공식 리콜 모델명에 포함됩니다."],
    },
  ]);
});

test("states that no match is not a safety guarantee", () => {
  expect(matchRecall({ modelName: "Z-999" }, candidates)).toEqual([
    {
      level: "no_match",
      reasons: ["공식 데이터에서 일치 항목을 찾지 못함. 이는 제품의 안전을 보장하지 않습니다."],
    },
  ]);
});

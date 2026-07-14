import { expect, test } from "vitest";

import type { RecallRecord } from "../src/domain.js";
import { makeRecallActionPlan } from "../src/actions.js";

const recall: RecallRecord = {
  id: "3802",
  productName: "아동용 카시트",
  modelName: "A-123 Pro",
  certificationNumbers: ["CB123A123-1234"],
  companyName: "세이프라이드코리아",
  actionGuidance: "무상 수리 또는 교환",
};

test("makes confirmed recall guidance preserve evidence and limit remedy claims to the official notice", () => {
  expect(makeRecallActionPlan(recall)).toEqual({
    steps: [
      "즉시 사용을 중지하세요.",
      "모델명과 인증번호가 보이는 사진을 보관하세요.",
      "세이프라이드코리아에 문의하세요.",
      "공식 조치 안내: 무상 수리 또는 교환",
      "제품안전정보센터의 공식 리콜 공고를 다시 확인하세요.",
    ],
  });
});

test("does not promise repair, exchange, or refund when the official notice does not specify one", () => {
  const plan = makeRecallActionPlan({
    ...recall,
    actionGuidance: undefined,
  });

  expect(plan.steps.join("\n")).not.toMatch(/수리|교환|환불/);
  expect(plan.steps).toContain("제품안전정보센터의 공식 리콜 공고를 다시 확인하세요.");
});

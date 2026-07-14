import type { RecallRecord } from "./domain.js";

export interface RecallActionPlan {
  readonly steps: readonly string[];
}

export function makeRecallActionPlan(recall: RecallRecord): RecallActionPlan {
  const contact = recall.companyName ?? recall.manufacturerName ?? "제조사";

  return {
    steps: [
      "즉시 사용을 중지하세요.",
      "모델명과 인증번호가 보이는 사진을 보관하세요.",
      `${contact}에 문의하세요.`,
      ...(recall.actionGuidance ? [`공식 조치 안내: ${recall.actionGuidance}`] : []),
      "제품안전정보센터의 공식 리콜 공고를 다시 확인하세요.",
    ],
  };
}

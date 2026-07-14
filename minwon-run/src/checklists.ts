export type Availability = "available" | "conditional";

export interface ApplicationRoute {
  readonly availability: Availability;
  readonly note: string;
}

export interface OfficialGuidance {
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly notice: "신청 전 최신 공식 안내를 확인하세요.";
}

export interface CivilChecklist {
  readonly serviceType: string;
  readonly preparations: readonly string[];
  readonly visit: ApplicationRoute;
  readonly online: ApplicationRoute;
  readonly fee: {
    readonly summary: string;
  };
  readonly officialGuidance: OfficialGuidance;
}

const CHECKED_AT = "2026-07-14";
const VERIFY_NOTICE = "신청 전 최신 공식 안내를 확인하세요." as const;
const CONDITIONAL_FEE = "신청 방식, 증명 종류 및 자격에 따라 달라질 수 있으므로 공식 안내에서 확인하세요.";

const CHECKLISTS: readonly CivilChecklist[] = [
  checklist("주민등록표 등본", ["본인 또는 대리인 여부에 맞는 신분 확인 자료", "대리 신청 시 위임장 등 공식 안내의 구비서류"], "온라인 발급은 본인 신청 등 조건에 따라 가능", "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000015&HighCtgCD=A1004"),
  checklist("인감증명", ["신분증", "대리 신청 시 위임장과 대리인 신분증"], "온라인 발급 가능 여부와 대상은 신청 유형에 따라 확인 필요", "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000025&tp_seq=01"),
  checklist("전입신고", ["신분증", "신고 대상과 거주 형태에 따른 확인 자료"], "온라인 신청은 세대 및 체류 상태 등 조건에 따라 제한될 수 있음", "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13100000016"),
  checklist("여권", ["신분증", "최근 6개월 이내 여권용 사진", "기존 여권(소지한 경우)"], "온라인 신청은 재발급 여부와 신청자 조건에 따라 가능", "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=12600000001&HighCtgCD=A07004&tp_seq=%2F"),
  checklist("가족관계증명서", ["본인 또는 대리인 여부에 맞는 신분 확인 자료", "대리 신청 시 공식 안내의 구비서류"], "온라인 발급은 신청인과 증명서 종류에 따라 가능", "https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=97400000004&HighCtgCD=A01008&tp_seq=03"),
];

export function getChecklist(serviceType: string): CivilChecklist {
  const checklist = CHECKLISTS.find((item) => item.serviceType === serviceType);
  if (!checklist) {
    throw new Error(`지원하지 않는 민원입니다: ${serviceType}`);
  }
  return checklist;
}

function checklist(
  serviceType: string,
  preparations: readonly string[],
  onlineNote: string,
  sourceUrl: string,
): CivilChecklist {
  return {
    serviceType,
    preparations,
    visit: { availability: "available", note: "방문 접수 가능 여부와 접수처는 공식 안내에서 확인" },
    online: { availability: "conditional", note: onlineNote },
    fee: { summary: CONDITIONAL_FEE },
    officialGuidance: { sourceUrl, checkedAt: CHECKED_AT, notice: VERIFY_NOTICE },
  };
}

export interface CivilChecklist {
  readonly serviceType: string;
  readonly onlineAvailable: boolean;
  readonly preparations: readonly string[];
  readonly fee: string;
}

const CHECKLISTS: readonly CivilChecklist[] = [
  {
    serviceType: "주민등록표 등본",
    onlineAvailable: true,
    preparations: ["본인 인증 수단", "대리 신청 시 위임장과 신분증"],
    fee: "400원",
  },
  {
    serviceType: "인감증명",
    onlineAvailable: false,
    preparations: ["본인 신분증", "대리 신청 시 위임장과 대리인 신분증"],
    fee: "600원",
  },
  {
    serviceType: "전입신고",
    onlineAvailable: true,
    preparations: ["본인 인증 수단", "임대차계약서 등 새 주소 확인 자료"],
    fee: "무료",
  },
  {
    serviceType: "여권",
    onlineAvailable: false,
    preparations: ["신분증", "최근 6개월 이내 여권용 사진", "기존 여권(소지한 경우)"],
    fee: "53,000원",
  },
  {
    serviceType: "가족관계증명서",
    onlineAvailable: true,
    preparations: ["본인 인증 수단", "대리 신청 시 위임장과 신분증"],
    fee: "1,000원",
  },
];

export function getChecklist(serviceType: string): CivilChecklist {
  const checklist = CHECKLISTS.find((item) => item.serviceType === serviceType);
  if (!checklist) {
    throw new Error(`지원하지 않는 민원입니다: ${serviceType}`);
  }
  return checklist;
}

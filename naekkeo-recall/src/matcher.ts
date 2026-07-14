import type { ProductInput, RecallMatch, RecallRecord } from "./domain.js";

export type { RecallMatch, RecallRecord } from "./domain.js";

const NO_MATCH_REASON = "공식 데이터에서 일치 항목을 찾지 못함. 이는 제품의 안전을 보장하지 않습니다.";
const CERTIFICATION_REASON = "인증번호가 공식 리콜 정보와 정확히 일치합니다.";
const PRODUCT_REASON = "제품명 토큰이 공식 리콜 제품명에 포함됩니다.";
const MODEL_REASON = "모델명 토큰이 공식 리콜 모델명에 포함됩니다.";
const AMBIGUOUS_REASON = "공식 리콜 후보가 여러 건이라 추가 확인이 필요합니다.";

export function matchRecall(product: ProductInput, candidates: readonly RecallRecord[]): RecallMatch[] {
  const matches = candidates.flatMap((candidate) => {
    const certificationMatch = matchesCertification(product.certificationNumber, candidate.certificationNumbers);
    const productMatch = matchesTokens(product.productName, candidate.productName);
    const modelMatch = matchesTokens(product.modelName, candidate.modelName);

    if (!certificationMatch && !productMatch && !modelMatch) {
      return [];
    }

    return [{ candidate, certificationMatch, productMatch, modelMatch }];
  });

  if (matches.length === 0) {
    return [{ level: "no_match", reasons: [NO_MATCH_REASON] }];
  }

  const isUniqueCertificationMatch = matches.length === 1 && matches[0].certificationMatch;
  return matches.map((match) => ({
    level: isUniqueCertificationMatch ? "confirmed" : "needs_confirmation",
    candidate: match.candidate,
    reasons: [
      ...(match.certificationMatch ? [CERTIFICATION_REASON] : []),
      ...(match.productMatch ? [PRODUCT_REASON] : []),
      ...(match.modelMatch ? [MODEL_REASON] : []),
      ...(matches.length > 1 ? [AMBIGUOUS_REASON] : []),
    ],
  }));
}

export function normalizeProductText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesCertification(value: string | undefined, certificationNumbers: readonly string[]): boolean {
  if (!value || normalizeCompact(value) === "") {
    return false;
  }
  return certificationNumbers.some((candidate) => normalizeCompact(candidate) === normalizeCompact(value));
}

function matchesTokens(query: string | undefined, candidate: string | undefined): boolean {
  const queryTokens = tokenSet(query);
  if (queryTokens.size === 0 || !candidate) {
    return false;
  }

  const candidateTokens = tokenSet(candidate);
  return [...queryTokens].every((token) => candidateTokens.has(token));
}

function tokenSet(value: string | undefined): Set<string> {
  return new Set(value ? normalizeProductText(value).split(" ").filter(Boolean) : []);
}

function normalizeCompact(value: string): string {
  return normalizeProductText(value).replace(/ /g, "");
}

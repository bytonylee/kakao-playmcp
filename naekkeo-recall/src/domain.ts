export interface SearchCriteria {
  readonly productName?: string;
  readonly modelName?: string;
  readonly certificationNumber?: string;
}

export interface ProductInput extends SearchCriteria {
  readonly manufacturerName?: string;
  readonly manufacturedAt?: string;
}

export interface RecallRecord {
  readonly id: string;
  readonly productName: string;
  readonly brandName?: string;
  readonly modelName?: string;
  readonly recallMeans?: string;
  readonly barcodeNumber?: string;
  readonly certificationNumbers: readonly string[];
  readonly recallType?: string;
  readonly inquiryPhone?: string;
  readonly companyName?: string;
  readonly manufacturerName?: string;
  readonly publishedAt?: string;
  readonly defectDescription?: string;
  readonly accidentDescription?: string;
  readonly actionGuidance?: string;
}

export interface CertificationRecord {
  readonly id: string;
  readonly certificationNumber: string;
  readonly status?: string;
  readonly certificationType?: string;
  readonly firstCertificationNumber?: string;
  readonly productName?: string;
  readonly brandName?: string;
  readonly modelName?: string;
  readonly categoryName?: string;
  readonly manufacturerName?: string;
  readonly importerName?: string;
  readonly certifiedAt?: string;
  readonly registeredAt?: string;
}

export type RecallMatchLevel = "confirmed" | "needs_confirmation" | "no_match";

export interface RecallMatch {
  readonly level: RecallMatchLevel;
  readonly candidate?: RecallRecord;
  readonly reasons: readonly string[];
}

export type OfficialDataAvailability = "available" | "unavailable";

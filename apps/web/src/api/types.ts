import type {
  Criticality,
  DefectSeverity,
  DefectStatus,
  DutyStatus,
  IsoDate,
  InspectionResult,
  Role,
} from "@cmp/core";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  siteIds: string[];
}

export interface Site {
  id: string;
  name: string;
  address: string;
  client: string;
  responsiblePerson: string;
}

export interface DutyStatusView {
  assetDutyId: string;
  titleEn: string;
  titleAr: string;
  authority: string;
  reference: string;
  intervalDays: number;
  graceDays: number;
  isStatutory: boolean;
  requiresCertificate: boolean;
  requiresThirdParty: boolean;
  active: boolean;
  lastCompletedOn: IsoDate | null;
  nextDueOn: IsoDate | null;
  status: DutyStatus;
}

export interface AssetStatusView {
  id: string;
  siteId: string;
  tag: string;
  name: string;
  assetType: string;
  criticality: Criticality;
  commissionedOn: IsoDate | null;
  locationDetail: string | null;
  duties: DutyStatusView[];
}

export interface AssetTypeDef {
  key: string;
  en: string;
  ar: string;
}

export interface ImportRowResult {
  row: number;
  outcome: "created" | "error";
  tag: string | null;
  assetType: string | null;
  fuzzy: boolean;
  message: string | null;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  errors: number;
  results: ImportRowResult[];
}

export interface InspectionRecord {
  id: string;
  performedOn: IsoDate;
  performedBy: string;
  performedByCompany: string | null;
  thirdPartyAccreditationRef: string | null;
  result: InspectionResult;
  findings: string | null;
  nextAction: string | null;
  certificateId: string | null;
  recordedAt: string;
  supersedesId: string | null;
  correctionReason: string | null;
  supersededBy: { id: string } | null;
  certificate: { id: string; filename: string } | null;
}

export interface Defect {
  id: string;
  severity: DefectSeverity;
  description: string;
  status: DefectStatus;
  closedByRecordId: string | null;
}

export interface FileUploadResult {
  id: string;
}

/**
 * Fields common to a record submission and a supersede. `certificateId` is filled
 * in at send time from an uploaded certificate File, so it is not part of the payload
 * the form produces. `correctionReason` is only present on a supersede.
 */
export interface RecordPayload {
  performedOn: string;
  performedBy: string;
  performedByCompany?: string;
  thirdPartyAccreditationRef?: string;
  result: InspectionResult;
  findings?: string;
  nextAction?: string;
  correctionReason?: string;
}

export type { Criticality, DefectSeverity, DefectStatus, DutyStatus, InspectionResult, Role };

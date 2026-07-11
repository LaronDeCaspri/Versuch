import type { Criticality, DutyStatus, IsoDate, InspectionResult, Role } from "@cmp/core";

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

export type { Criticality, DutyStatus, InspectionResult, Role };

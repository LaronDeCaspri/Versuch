export const CRITICALITY = ["LIFE_SAFETY", "OPERATIONAL", "NON_CRITICAL"] as const;
export type Criticality = (typeof CRITICALITY)[number];

export const AUTHORITY = [
  "CIVIL_DEFENSE",
  "SBC",
  "MUNICIPALITY",
  "MOMRA",
  "CLIENT_CONTRACT",
  "MANUFACTURER",
  "INTERNAL",
] as const;
export type Authority = (typeof AUTHORITY)[number];

export const INSPECTION_RESULT = ["PASS", "PASS_WITH_DEFECTS", "FAIL"] as const;
export type InspectionResult = (typeof INSPECTION_RESULT)[number];

export const DUTY_STATUS = ["OVERDUE", "DUE", "OK", "NEVER_DONE"] as const;
export type DutyStatus = (typeof DUTY_STATUS)[number];

export const ROLE = ["OWNER", "MANAGER", "TECHNICIAN", "VIEWER"] as const;
export type Role = (typeof ROLE)[number];

export const DEFECT_SEVERITY = ["CRITICAL", "MAJOR", "MINOR"] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITY)[number];

export const DEFECT_STATUS = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
export type DefectStatus = (typeof DEFECT_STATUS)[number];

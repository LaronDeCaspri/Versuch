import type { Authority, Criticality, DutyStatus, InspectionResult } from "@cmp/core";

// The dossier is an Arabic legal artifact; its labels live here independently of
// the web i18n catalogue.
export const STATUS_AR: Record<DutyStatus, string> = {
  OVERDUE: "متأخر",
  DUE: "مستحق",
  OK: "مطابق",
  NEVER_DONE: "لم يُنفَّذ قط",
};

export const RESULT_AR: Record<InspectionResult, string> = {
  PASS: "ناجح",
  PASS_WITH_DEFECTS: "ناجح مع ملاحظات",
  FAIL: "راسب",
};

export const CRITICALITY_AR: Record<Criticality, string> = {
  LIFE_SAFETY: "حرج للسلامة",
  OPERATIONAL: "تشغيلي",
  NON_CRITICAL: "غير حرج",
};

export const AUTHORITY_AR: Record<Authority, string> = {
  CIVIL_DEFENSE: "الدفاع المدني",
  SBC: "كود البناء السعودي",
  MUNICIPALITY: "البلدية",
  MOMRA: "وزارة الشؤون البلدية",
  CLIENT_CONTRACT: "عقد العميل",
  MANUFACTURER: "الشركة المصنّعة",
  INTERNAL: "داخلي",
};

import { toHijri, type Authority, type Criticality, type DutyStatus, type InspectionResult, type IsoDate } from "@cmp/core";
import { AUTHORITY_AR, CRITICALITY_AR, RESULT_AR, STATUS_AR } from "./labels.js";

export interface DossierRecord {
  performedOn: IsoDate;
  performedBy: string;
  performedByCompany: string | null;
  thirdPartyAccreditationRef: string | null;
  result: InspectionResult;
  findings: string | null;
  certificateFilename: string | null;
  superseded: boolean;
  correctionReason: string | null;
}

export interface DossierDuty {
  titleAr: string;
  authority: Authority;
  reference: string;
  isStatutory: boolean;
  intervalDays: number;
  status: DutyStatus;
  nextDueOn: IsoDate | null;
  lastCompletedOn: IsoDate | null;
  records: DossierRecord[];
}

export interface DossierAsset {
  tag: string;
  name: string;
  criticality: Criticality;
  locationDetail: string | null;
  duties: DossierDuty[];
}

export interface DossierData {
  orgName: string;
  site: { name: string; address: string; client: string; responsiblePerson: string };
  from: IsoDate;
  to: IsoDate;
  generatedAt: string;
  generatedBy: string;
  assets: DossierAsset[];
  fontRegularBase64: string;
  fontBoldBase64: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function gregHijri(date: IsoDate | null): string {
  if (date === null) return "—";
  return `${date} <span class="hijri">(${esc(toHijri(date, "ar-SA"))} هـ)</span>`;
}

function statusClass(status: DutyStatus): string {
  return `st-${status.toLowerCase()}`;
}

function recordRow(r: DossierRecord): string {
  const cls = r.superseded ? "superseded" : "";
  const note = r.superseded
    ? `<span class="tag">مُصحَّح</span>`
    : r.correctionReason !== null
      ? `<span class="tag">تصحيح: ${esc(r.correctionReason)}</span>`
      : "";
  return `<tr class="${cls}">
    <td>${gregHijri(r.performedOn)}</td>
    <td>${esc(r.performedBy)}${r.performedByCompany !== null ? ` — ${esc(r.performedByCompany)}` : ""}</td>
    <td>${RESULT_AR[r.result]}</td>
    <td>${r.findings !== null ? esc(r.findings) : "—"} ${note}</td>
    <td>${r.thirdPartyAccreditationRef !== null ? esc(r.thirdPartyAccreditationRef) : "—"}</td>
    <td>${r.certificateFilename !== null ? "✔" : "—"}</td>
  </tr>`;
}

function dutyBlock(d: DossierDuty): string {
  const statutory = d.isStatutory ? `<span class="statutory">نظامي</span>` : "";
  const rows = d.records.length > 0
    ? d.records.map(recordRow).join("")
    : `<tr><td colspan="6" class="empty">لا توجد سجلات ضمن الفترة</td></tr>`;
  return `<div class="duty">
    <div class="duty-head">
      <span class="badge ${statusClass(d.status)}">${STATUS_AR[d.status]}</span>
      <strong>${esc(d.titleAr)}</strong>
      ${statutory}
      <span class="auth">${AUTHORITY_AR[d.authority]} — ${esc(d.reference)}</span>
    </div>
    <div class="duty-meta">
      الاستحقاق التالي: ${gregHijri(d.nextDueOn)} · آخر تنفيذ: ${gregHijri(d.lastCompletedOn)} · الدورية: كل ${d.intervalDays} يوم
    </div>
    <table class="records">
      <thead><tr><th>تاريخ التنفيذ</th><th>المنفِّذ</th><th>النتيجة</th><th>الملاحظات</th><th>مرجع الاعتماد</th><th>شهادة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function assetBlock(a: DossierAsset): string {
  return `<div class="asset">
    <div class="asset-head">
      <span class="tag-strong">${esc(a.tag)}</span>
      <strong>${esc(a.name)}</strong>
      <span class="crit">${CRITICALITY_AR[a.criticality]}</span>
      ${a.locationDetail !== null ? `<span class="loc">${esc(a.locationDetail)}</span>` : ""}
    </div>
    ${a.duties.map(dutyBlock).join("")}
  </div>`;
}

export function buildDossierHtml(d: DossierData): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Amiri'; font-weight: 400; src: url(data:font/ttf;base64,${d.fontRegularBase64}) format('truetype'); }
  @font-face { font-family: 'Amiri'; font-weight: 700; src: url(data:font/ttf;base64,${d.fontBoldBase64}) format('truetype'); }
  * { box-sizing: border-box; }
  body { font-family: 'Amiri', serif; color: #1f2937; margin: 0; font-size: 12px; }
  .letterhead { border-bottom: 3px solid #1d4ed8; padding: 16px 0; margin-bottom: 16px; }
  .letterhead h1 { margin: 0; font-size: 22px; color: #1d4ed8; }
  .letterhead .doc { font-size: 16px; margin-top: 4px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 12px; margin-bottom: 16px; }
  .meta div { min-width: 200px; }
  .asset { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 12px; page-break-inside: avoid; }
  .asset-head { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 6px; }
  .tag-strong { background: #1e293b; color: #fff; padding: 2px 8px; border-radius: 6px; font-weight: 700; }
  .crit { color: #b45309; font-weight: 700; }
  .loc { color: #64748b; }
  .duty { margin: 8px 0; }
  .duty-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .auth { color: #475569; }
  .statutory { background: #fee2e2; color: #991b1b; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
  .duty-meta { color: #64748b; font-size: 11px; margin: 3px 0 5px; }
  .badge { color: #fff; padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
  .st-overdue { background: #b91c1c; } .st-neverdone { background: #6d28d9; }
  .st-due { background: #b45309; } .st-ok { background: #15803d; }
  table.records { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.records th, table.records td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: start; font-size: 11px; }
  table.records th { background: #f1f5f9; }
  tr.superseded { color: #94a3b8; text-decoration: line-through; }
  .tag { background: #f1f5f9; color: #475569; padding: 0 5px; border-radius: 4px; font-size: 10px; }
  .hijri { color: #64748b; font-size: 10px; }
  .empty { color: #94a3b8; text-align: center; }
</style></head><body>
  <div class="letterhead">
    <h1>${esc(d.orgName)}</h1>
    <div class="doc">ملف الامتثال والصيانة</div>
  </div>
  <div class="meta">
    <div><strong>الموقع:</strong> ${esc(d.site.name)}</div>
    <div><strong>العميل:</strong> ${esc(d.site.client)}</div>
    <div><strong>العنوان:</strong> ${esc(d.site.address)}</div>
    <div><strong>الشخص المسؤول:</strong> ${esc(d.site.responsiblePerson)}</div>
    <div><strong>الفترة:</strong> ${gregHijri(d.from)} — ${gregHijri(d.to)}</div>
    <div><strong>تاريخ الإصدار:</strong> ${esc(d.generatedAt)} · بواسطة ${esc(d.generatedBy)}</div>
  </div>
  ${d.assets.length > 0 ? d.assets.map(assetBlock).join("") : '<p class="empty">لا توجد أصول في هذا الموقع.</p>'}
</body></html>`;
}

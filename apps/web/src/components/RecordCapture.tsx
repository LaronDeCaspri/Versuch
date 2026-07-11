import { INSPECTION_RESULT, todayInRiyadh, type InspectionResult } from "@cmp/core";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../api/client.js";
import type { AssetStatusView, Defect, DutyStatusView, FileUploadResult, InspectionRecord, RecordPayload } from "../api/types.js";
import { useAuth } from "../auth/AuthContext.js";
import { useI18n } from "../i18n/index.js";
import { useOutbox } from "../offline/useOutbox.js";
import type { NewOutboxItem, OutboxItem } from "../offline/outbox.js";
import { DateLabel } from "./DateLabel.js";
import { StatusBadge } from "./StatusBadge.js";
import { Button, Field, Select, Spinner, TextInput } from "./ui.js";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-start focus-visible:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";

/** Top-level record-capture section shown on the asset detail page. */
export function RecordCapture({ asset, onSynced }: { asset: AssetStatusView; onSynced: () => void }): JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const { items } = useOutbox(onSynced);

  const role = user?.role;
  const canCapture = role === "TECHNICIAN" || role === "MANAGER" || role === "OWNER";
  const canSupersede = role === "MANAGER" || role === "OWNER";

  return (
    <section className="space-y-4" aria-label={t("asset.records")}>
      <h2 className="text-lg font-bold text-slate-800">{t("asset.records")}</h2>
      <div className="space-y-4">
        {asset.duties.map((duty) => (
          <DutyRecordCard
            key={duty.assetDutyId}
            duty={duty}
            pending={items.filter((i) => i.dutyId === duty.assetDutyId)}
            canCapture={canCapture}
            canSupersede={canSupersede}
          />
        ))}
      </div>
    </section>
  );
}

type FormTarget = { mode: "submit" } | { mode: "supersede"; record: InspectionRecord };

function DutyRecordCard({
  duty,
  pending,
  canCapture,
  canSupersede,
}: {
  duty: DutyStatusView;
  pending: OutboxItem[];
  canCapture: boolean;
  canSupersede: boolean;
}): JSX.Element {
  const { t, lang } = useI18n();
  const [records, setRecords] = useState<InspectionRecord[] | null>(null);
  const [defects, setDefects] = useState<Defect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<FormTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    let live = true;
    Promise.all([
      api.get<InspectionRecord[]>(`/asset-duties/${duty.assetDutyId}/records`),
      api.get<Defect[]>(`/asset-duties/${duty.assetDutyId}/defects`),
    ])
      .then(([recs, defs]) => {
        if (!live) return;
        setRecords([...recs].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)));
        setDefects(defs);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [duty.assetDutyId, t]);

  useEffect(() => load(), [load]);

  const onDone = useCallback(
    (outcome: "saved" | "queued") => {
      setTarget(null);
      setNotice(outcome === "queued" ? t("offline.savedOffline") : t("record.saved"));
      load();
    },
    [load, t],
  );

  const title = lang === "ar" ? duty.titleAr : duty.titleEn;

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={duty.status} />
        <h3 className="font-semibold text-slate-800">{title}</h3>
      </div>

      {notice !== null && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          {notice}
        </p>
      )}

      {canCapture && target === null && (
        <Button
          type="button"
          onClick={() => {
            setNotice(null);
            setTarget({ mode: "submit" });
          }}
          className="min-h-[44px] w-full sm:w-auto"
        >
          {t("record.capture")}
        </Button>
      )}

      {target !== null && (
        <RecordForm
          dutyId={duty.assetDutyId}
          target={target}
          requiresThirdParty={duty.requiresThirdParty}
          onDone={onDone}
          onCancel={() => setTarget(null)}
        />
      )}

      {/* History */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-600">{t("record.history")}</h4>
        {pending.map((item) => (
          <PendingRow key={item.id} item={item} />
        ))}
        {error !== null ? (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <span role="alert">{error}</span>
            <Button type="button" variant="ghost" onClick={load} className="min-h-[44px]">
              {t("common.retry")}
            </Button>
          </div>
        ) : records === null ? (
          <div className="flex items-center gap-2 py-2">
            <Spinner />
            <span className="text-sm text-slate-500">{t("common.loading")}</span>
          </div>
        ) : records.length === 0 && pending.length === 0 ? (
          <p className="text-sm text-slate-400">{t("record.none")}</p>
        ) : (
          records.map((rec) => (
            <RecordRow
              key={rec.id}
              record={rec}
              canSupersede={canSupersede}
              onCorrect={() => {
                setNotice(null);
                setTarget({ mode: "supersede", record: rec });
              }}
            />
          ))
        )}
      </div>

      {/* Defects */}
      <DefectList defects={defects} />
    </article>
  );
}

const RESULT_STYLES: Record<InspectionResult, string> = {
  PASS: "bg-ok text-white",
  PASS_WITH_DEFECTS: "bg-due text-white",
  FAIL: "bg-overdue text-white",
};

function ResultBadge({ result }: { result: InspectionResult }): JSX.Element {
  const { t } = useI18n();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${RESULT_STYLES[result]}`}>
      {t(`result.${result}`)}
    </span>
  );
}

function PendingRow({ item }: { item: OutboxItem }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ResultBadge result={item.payload.result} />
        <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-semibold text-white">
          {t("offline.queued")}
        </span>
        {item.kind === "supersede" && <span className="text-xs text-amber-800">{t("record.correct")}</span>}
      </div>
      <div className="text-sm text-slate-700">
        <span className="tnum">{item.payload.performedOn}</span>
        <span className="mx-1 text-slate-400">·</span>
        {item.payload.performedBy}
      </div>
    </div>
  );
}

function RecordRow({
  record,
  canSupersede,
  onCorrect,
}: {
  record: InspectionRecord;
  canSupersede: boolean;
  onCorrect: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const superseded = record.supersededBy !== null;
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${superseded ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ResultBadge result={record.result} />
        {superseded && (
          <span className="inline-flex items-center rounded-full bg-slate-400 px-2.5 py-0.5 text-xs font-semibold text-white line-through">
            {t("record.superseded")}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <Row label={t("record.performedOn")}>
          <DateLabel date={record.performedOn} />
        </Row>
        <Row label={t("record.performedBy")}>{record.performedBy}</Row>
        {record.performedByCompany !== null && <Row label={t("record.performedByCompany")}>{record.performedByCompany}</Row>}
        {record.thirdPartyAccreditationRef !== null && (
          <Row label={t("record.thirdPartyRef")}>{record.thirdPartyAccreditationRef}</Row>
        )}
        {record.findings !== null && <Row label={t("record.findings")}>{record.findings}</Row>}
        {record.nextAction !== null && <Row label={t("record.nextAction")}>{record.nextAction}</Row>}
      </dl>

      {record.correctionReason !== null && (
        <p className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-800">
          {t("record.supersedesNote")}: {record.correctionReason}
        </p>
      )}

      {record.certificate !== null && (
        <a
          href={`/api/files/${record.certificate.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-blue-600 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          <span aria-hidden="true">↓</span>
          {t("record.downloadCertificate")}
        </a>
      )}

      {canSupersede && !superseded && (
        <div>
          <Button type="button" variant="ghost" onClick={onCorrect} className="min-h-[44px] border border-slate-300">
            {t("record.correct")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{label}:</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}

function DefectList({ defects }: { defects: Defect[] | null }): JSX.Element | null {
  const { t } = useI18n();
  if (defects === null) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-slate-600">{t("record.defects")}</h4>
      {defects.length === 0 ? (
        <p className="text-sm text-slate-400">{t("record.defectsNone")}</p>
      ) : (
        <ul className="space-y-1">
          {defects.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center rounded-full border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {t(`defect.severity.${d.severity}`)}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${d.status === "CLOSED" ? "bg-ok text-white" : "bg-overdue text-white"}`}
              >
                {t(`defect.status.${d.status}`)}
              </span>
              <span className="text-slate-700">{d.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordForm({
  dutyId,
  target,
  requiresThirdParty,
  onDone,
  onCancel,
}: {
  dutyId: string;
  target: FormTarget;
  requiresThirdParty: boolean;
  onDone: (outcome: "saved" | "queued") => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const { enqueue } = useOutbox();
  const today = todayInRiyadh();
  const prefill = target.mode === "supersede" ? target.record : null;

  const [performedOn, setPerformedOn] = useState<string>(prefill?.performedOn ?? today);
  const [performedBy, setPerformedBy] = useState<string>(prefill?.performedBy ?? "");
  const [company, setCompany] = useState<string>(prefill?.performedByCompany ?? "");
  const [thirdPartyRef, setThirdPartyRef] = useState<string>(prefill?.thirdPartyAccreditationRef ?? "");
  const [result, setResult] = useState<InspectionResult | "">(prefill?.result ?? "");
  const [findings, setFindings] = useState<string>(prefill?.findings ?? "");
  const [nextAction, setNextAction] = useState<string>(prefill?.nextAction ?? "");
  const [correctionReason, setCorrectionReason] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const idp = `${dutyId}-${target.mode}`;

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (result === "") {
      setError(t("common.required"));
      return;
    }
    setBusy(true);
    setError(null);

    const payload: RecordPayload = {
      performedOn,
      performedBy: performedBy.trim(),
      result,
      ...(company.trim() !== "" ? { performedByCompany: company.trim() } : {}),
      ...(thirdPartyRef.trim() !== "" ? { thirdPartyAccreditationRef: thirdPartyRef.trim() } : {}),
      ...(findings.trim() !== "" ? { findings: findings.trim() } : {}),
      ...(nextAction.trim() !== "" ? { nextAction: nextAction.trim() } : {}),
      ...(target.mode === "supersede" ? { correctionReason: correctionReason.trim() } : {}),
    };

    const queue = async (): Promise<void> => {
      const item: NewOutboxItem =
        target.mode === "supersede"
          ? { kind: "supersede", dutyId, recordId: target.record.id, payload, ...(file !== null ? { certificate: file } : {}) }
          : { kind: "submit", dutyId, payload, ...(file !== null ? { certificate: file } : {}) };
      await enqueue(item);
    };

    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queue();
        onDone("queued");
        return;
      }
      let certificateId: string | undefined;
      if (file !== null) {
        const uploaded = await api.upload<FileUploadResult>("/files", file);
        certificateId = uploaded.id;
      }
      const body: RecordPayload & { certificateId?: string } =
        certificateId === undefined ? payload : { ...payload, certificateId };
      if (target.mode === "supersede") {
        await api.post(`/records/${target.record.id}/supersede`, body);
      } else {
        await api.post(`/asset-duties/${dutyId}/records`, body);
      }
      onDone("saved");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        // Non-API network failure: treat as offline and queue.
        await queue();
        onDone("queued");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <Field label={t("record.performedOn")} htmlFor={`${idp}-on`}>
        <TextInput
          id={`${idp}-on`}
          type="date"
          max={today}
          value={performedOn}
          onChange={(e) => setPerformedOn(e.target.value)}
          required
        />
      </Field>

      <Field label={t("record.performedBy")} htmlFor={`${idp}-by`}>
        <TextInput id={`${idp}-by`} value={performedBy} onChange={(e) => setPerformedBy(e.target.value)} required />
      </Field>

      <Field label={`${t("record.performedByCompany")} ${t("record.optional")}`} htmlFor={`${idp}-co`}>
        <TextInput id={`${idp}-co`} value={company} onChange={(e) => setCompany(e.target.value)} />
      </Field>

      <Field
        label={requiresThirdParty ? t("record.thirdPartyRef") : `${t("record.thirdPartyRef")} ${t("record.optional")}`}
        htmlFor={`${idp}-tp`}
      >
        <TextInput
          id={`${idp}-tp`}
          value={thirdPartyRef}
          onChange={(e) => setThirdPartyRef(e.target.value)}
          required={requiresThirdParty}
        />
      </Field>

      <Field label={t("record.result")} htmlFor={`${idp}-res`}>
        <Select id={`${idp}-res`} value={result} onChange={(e) => setResult(e.target.value as InspectionResult | "")} required>
          <option value="" disabled>
            {t("record.resultSelect")}
          </option>
          {INSPECTION_RESULT.map((r) => (
            <option key={r} value={r}>
              {t(`result.${r}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={`${t("record.findings")} ${t("record.optional")}`} htmlFor={`${idp}-find`}>
        <textarea id={`${idp}-find`} rows={2} value={findings} onChange={(e) => setFindings(e.target.value)} className={inputClass} />
      </Field>

      <Field label={`${t("record.nextAction")} ${t("record.optional")}`} htmlFor={`${idp}-next`}>
        <textarea id={`${idp}-next`} rows={2} value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={inputClass} />
      </Field>

      <Field label={`${t("record.certificateUpload")} ${t("record.optional")}`} htmlFor={`${idp}-cert`}>
        <input
          id={`${idp}-cert`}
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-start file:me-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        />
      </Field>

      {target.mode === "supersede" && (
        <Field label={t("record.correctionReason")} htmlFor={`${idp}-reason`}>
          <textarea
            id={`${idp}-reason`}
            rows={2}
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            className={inputClass}
            required
          />
        </Field>
      )}

      {error !== null && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
          {target.mode === "supersede" ? t("record.submitCorrection") : t("record.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="min-h-[44px] w-full border border-slate-300 sm:w-auto">
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

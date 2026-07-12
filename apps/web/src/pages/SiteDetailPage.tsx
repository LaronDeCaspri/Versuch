import { CRITICALITY, type Criticality, type DutyStatus } from "@cmp/core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { AssetStatusView, AssetTypeDef, ImportReport, Site } from "../api/types.js";
import { useAuth } from "../auth/AuthContext.js";
import { CriticalityBadge, StatusBadge } from "../components/StatusBadge.js";
import { Button, Field, Select, Spinner, TextInput } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

/** Lower rank = worse; used to surface each asset's worst duty status. */
const STATUS_RANK: Record<DutyStatus, number> = { OVERDUE: 0, NEVER_DONE: 1, DUE: 2, OK: 3 };
const RANK_STATUS: DutyStatus[] = ["OVERDUE", "NEVER_DONE", "DUE", "OK"];

function worstStatus(asset: AssetStatusView): DutyStatus | null {
  if (asset.duties.length === 0) return null;
  const rank = asset.duties.reduce((worst, d) => Math.min(worst, STATUS_RANK[d.status]), STATUS_RANK.OK);
  return RANK_STATUS[rank] ?? "OK";
}

export function SiteDetailPage(): JSX.Element {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canManage = user?.role === "OWNER" || user?.role === "MANAGER";

  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<AssetStatusView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSite = useCallback(() => {
    if (id === undefined) return;
    setError(null);
    let live = true;
    api
      .get<Site>(`/sites/${id}`)
      .then((data) => {
        if (live) setSite(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [id, t]);

  const loadAssets = useCallback(() => {
    if (id === undefined) return;
    setAssets(null);
    let live = true;
    api
      .get<AssetStatusView[]>(`/assets?siteId=${id}`)
      .then((data) => {
        if (live) setAssets(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [id, t]);

  useEffect(() => loadSite(), [loadSite]);
  useEffect(() => loadAssets(), [loadAssets]);

  if (id === undefined) return <p className="text-slate-600">{t("common.error")}</p>;

  return (
    <div className="space-y-6">
      <Link
        to="/sites"
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <span aria-hidden="true">←</span>
        {t("common.back")}
      </Link>

      {error !== null && site === null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700" role="alert">
            {error}
          </p>
          <Button onClick={loadSite}>{t("common.retry")}</Button>
        </div>
      ) : site === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : (
        <>
          <header className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h1 className="text-2xl font-bold text-slate-800">{site.name}</h1>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label={t("site.client")} value={site.client} />
              <Detail label={t("site.address")} value={site.address} />
              <Detail label={t("site.responsible")} value={site.responsiblePerson} />
            </dl>
          </header>

          <AssetsSection assets={assets} onRetry={loadAssets} />

          {canManage && <AddAssetForm siteId={id} onCreated={loadAssets} />}
          {canManage && <ImportPanel siteId={id} onImported={loadAssets} />}

          <DossierExport siteId={id} />
        </>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <dt className="text-slate-500">{label}:</dt>
      <dd className="text-slate-800">{value === null || value === "" ? t("common.none") : value}</dd>
    </div>
  );
}

function AssetsSection({
  assets,
  onRetry,
}: {
  assets: AssetStatusView[] | null;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-800">{t("sites.assets")}</h2>
      {assets === null ? (
        <div className="flex items-center gap-3 p-4">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
          <Button variant="ghost" onClick={onRetry} className="text-sm">
            {t("common.retry")}
          </Button>
        </div>
      ) : assets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
          {t("sites.assetsEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[36rem] border-collapse text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-3 py-2 text-start font-semibold">{t("asset.tag")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("asset.name")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("asset.criticality")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("sites.status")}</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const worst = worstStatus(a);
                return (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link
                        to={`/assets/${a.id}`}
                        className="tnum font-bold text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                      >
                        {a.tag}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{a.name}</td>
                    <td className="px-3 py-2">
                      <CriticalityBadge criticality={a.criticality} />
                    </td>
                    <td className="px-3 py-2">
                      {worst === null ? <span className="text-slate-400">{t("common.none")}</span> : <StatusBadge status={worst} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AddAssetForm({ siteId, onCreated }: { siteId: string; onCreated: () => void }): JSX.Element {
  const { t, lang } = useI18n();
  const [types, setTypes] = useState<AssetTypeDef[]>([]);
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [criticality, setCriticality] = useState<Criticality | "">("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [commissionedOn, setCommissionedOn] = useState("");
  const [locationDetail, setLocationDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<AssetTypeDef[]>("/asset-types")
      .then((data) => {
        if (live) setTypes(data);
      })
      .catch(() => {
        /* the type dropdown simply stays empty; the field is still required */
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (assetType === "" || criticality === "") {
      setError(t("common.required"));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post("/assets", {
        siteId,
        tag: tag.trim(),
        name: name.trim(),
        assetType,
        criticality,
        ...(manufacturer.trim() !== "" ? { manufacturer: manufacturer.trim() } : {}),
        ...(model.trim() !== "" ? { model: model.trim() } : {}),
        ...(serialNumber.trim() !== "" ? { serialNumber: serialNumber.trim() } : {}),
        ...(commissionedOn !== "" ? { commissionedOn } : {}),
        ...(locationDetail.trim() !== "" ? { locationDetail: locationDetail.trim() } : {}),
      });
      setTag("");
      setName("");
      setAssetType("");
      setCriticality("");
      setManufacturer("");
      setModel("");
      setSerialNumber("");
      setCommissionedOn("");
      setLocationDetail("");
      setNotice(t("asset.created"));
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <h2 className="text-lg font-bold text-slate-800">{t("asset.create")}</h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("asset.tag")} htmlFor="asset-tag">
          <TextInput id="asset-tag" value={tag} onChange={(e) => setTag(e.target.value)} required />
        </Field>
        <Field label={t("asset.name")} htmlFor="asset-name">
          <TextInput id="asset-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t("asset.type")} htmlFor="asset-type">
          <Select id="asset-type" value={assetType} onChange={(e) => setAssetType(e.target.value)} required>
            <option value="" disabled>
              {t("asset.typeSelect")}
            </option>
            {types.map((ty) => (
              <option key={ty.key} value={ty.key}>
                {lang === "ar" ? ty.ar : ty.en}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("asset.criticality")} htmlFor="asset-crit">
          <Select
            id="asset-crit"
            value={criticality}
            onChange={(e) => setCriticality(e.target.value as Criticality | "")}
            required
          >
            <option value="" disabled>
              {t("asset.criticalitySelect")}
            </option>
            {CRITICALITY.map((c) => (
              <option key={c} value={c}>
                {t(`criticality.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("asset.manufacturer")} ${t("common.optional")}`} htmlFor="asset-mfr">
          <TextInput id="asset-mfr" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        </Field>
        <Field label={`${t("asset.model")} ${t("common.optional")}`} htmlFor="asset-model">
          <TextInput id="asset-model" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label={`${t("asset.serial")} ${t("common.optional")}`} htmlFor="asset-serial">
          <TextInput id="asset-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
        </Field>
        <Field label={`${t("asset.commissioned")} ${t("common.optional")}`} htmlFor="asset-commissioned">
          <TextInput
            id="asset-commissioned"
            type="date"
            value={commissionedOn}
            onChange={(e) => setCommissionedOn(e.target.value)}
          />
        </Field>
        <Field label={`${t("asset.location")} ${t("common.optional")}`} htmlFor="asset-location">
          <TextInput id="asset-location" value={locationDetail} onChange={(e) => setLocationDetail(e.target.value)} />
        </Field>
      </div>

      {notice !== null && (
        <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok" role="status">
          {notice}
        </p>
      )}
      {error !== null && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
        {t("asset.create")}
      </Button>
    </form>
  );
}

function ImportPanel({ siteId, onImported }: { siteId: string; onImported: () => void }): JSX.Element {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (file === null) {
      setError(t("import.noFile"));
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = await api.upload<ImportReport>(`/assets/import?siteId=${siteId}`, file);
      setReport(result);
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <h2 className="text-lg font-bold text-slate-800">{t("import.heading")}</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t("import.file")} htmlFor="import-file">
          <input
            id="import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-start file:me-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          />
        </Field>
        {error !== null && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
          {busy ? t("import.importing") : t("import.submit")}
        </Button>
      </form>

      {report !== null && <ImportReportView report={report} />}
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <h3 className="font-semibold text-slate-800">{t("import.resultsHeading")}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold tnum text-slate-800">{report.totalRows}</div>
          <div className="text-xs text-slate-500">{t("import.totalRows")}</div>
        </div>
        <div className="rounded-lg border border-ok bg-ok/10 p-3 text-center">
          <div className="text-2xl font-bold tnum text-ok">{report.created}</div>
          <div className="text-xs text-ok">{t("import.created")}</div>
        </div>
        <div className="rounded-lg border border-overdue bg-overdue/10 p-3 text-center">
          <div className="text-2xl font-bold tnum text-overdue">{report.errors}</div>
          <div className="text-xs text-overdue">{t("import.errors")}</div>
        </div>
      </div>

      {report.results.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[40rem] border-collapse text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-3 py-2 text-start font-semibold">{t("import.row")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("import.outcome")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("asset.tag")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("asset.type")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("import.fuzzy")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("import.message")}</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((r) => (
                <tr
                  key={r.row}
                  className={`border-b border-slate-100 last:border-0 ${r.outcome === "error" ? "bg-overdue/5" : ""}`}
                >
                  <td className="px-3 py-2 tnum text-slate-700">{r.row}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        r.outcome === "created" ? "bg-ok text-white" : "bg-overdue text-white"
                      }`}
                    >
                      {r.outcome === "created" ? t("import.outcomeCreated") : t("import.outcomeError")}
                    </span>
                  </td>
                  <td className="px-3 py-2 tnum text-slate-700">{r.tag ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{r.assetType ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {r.fuzzy ? (
                      <span className="inline-flex items-center rounded-full border border-due px-2 py-0.5 text-xs font-semibold text-due">
                        {t("import.fuzzyYes")}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DossierExport({ siteId }: { siteId: string }): JSX.Element {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.download(`/sites/${siteId}/dossier?from=${from}&to=${to}`, `dossier-${siteId}.pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("dossier.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-bold text-slate-800">{t("dossier.heading")}</h2>
      <p className="text-sm text-slate-500">{t("dossier.hint")}</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("dossier.from")} htmlFor="dossier-from">
            <TextInput id="dossier-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label={t("dossier.to")} htmlFor="dossier-to">
            <TextInput id="dossier-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </Field>
        </div>
        {error !== null && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
          {busy ? t("dossier.exporting") : t("dossier.export")}
        </Button>
      </form>
    </section>
  );
}

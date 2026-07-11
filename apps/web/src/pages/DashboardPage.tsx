import { CRITICALITY, type DutyStatus } from "@cmp/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { AssetStatusView, DutyStatusView, Site } from "../api/types.js";
import { DateLabel } from "../components/DateLabel.js";
import { AuthorityLabel, CriticalityBadge, StatusBadge } from "../components/StatusBadge.js";
import { Button, Field, Select, Spinner } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

/** Lower rank = worse; drives both sorting and the summary tile order. */
const STATUS_RANK: Record<DutyStatus, number> = {
  OVERDUE: 0,
  NEVER_DONE: 1,
  DUE: 2,
  OK: 3,
};

const SUMMARY: { status: DutyStatus; labelKey: "dashboard.summaryOverdue" | "dashboard.summaryNeverDone" | "dashboard.summaryDue" | "dashboard.summaryOk"; tile: string }[] = [
  { status: "OVERDUE", labelKey: "dashboard.summaryOverdue", tile: "border-overdue bg-overdue/10 text-overdue" },
  { status: "NEVER_DONE", labelKey: "dashboard.summaryNeverDone", tile: "border-neverdone bg-neverdone/10 text-neverdone" },
  { status: "DUE", labelKey: "dashboard.summaryDue", tile: "border-due bg-due/10 text-due" },
  { status: "OK", labelKey: "dashboard.summaryOk", tile: "border-ok bg-ok/10 text-ok" },
];

function worstRank(asset: AssetStatusView): number {
  return asset.duties.reduce((worst, d) => Math.min(worst, STATUS_RANK[d.status]), STATUS_RANK.OK);
}

/** A duty that makes its asset demand immediate attention. */
function isCritical(asset: AssetStatusView, duty: DutyStatusView): boolean {
  if (duty.status === "NEVER_DONE") return true;
  if (asset.criticality === "LIFE_SAFETY" && duty.isStatutory && duty.status === "OVERDUE") return true;
  return false;
}

function assetIsCritical(asset: AssetStatusView): boolean {
  return asset.duties.some((d) => isCritical(asset, d));
}

export function DashboardPage(): JSX.Element {
  const { t, lang } = useI18n();
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<AssetStatusView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState("");
  const [criticality, setCriticality] = useState("");

  useEffect(() => {
    let live = true;
    api
      .get<Site[]>("/sites")
      .then((s) => {
        if (live) setSites(s);
      })
      .catch(() => {
        /* the assets error surface is enough; the filter simply stays empty */
      });
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(() => {
    setAssets(null);
    setError(null);
    const params = new URLSearchParams();
    if (siteId !== "") params.set("siteId", siteId);
    if (criticality !== "") params.set("criticality", criticality);
    const query = params.toString();
    let live = true;
    api
      .get<AssetStatusView[]>(`/assets${query === "" ? "" : `?${query}`}`)
      .then((data) => {
        if (live) setAssets(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [siteId, criticality, t]);

  useEffect(() => load(), [load]);

  const counts = useMemo(() => {
    const acc: Record<DutyStatus, number> = { OVERDUE: 0, NEVER_DONE: 0, DUE: 0, OK: 0 };
    for (const a of assets ?? []) for (const d of a.duties) acc[d.status] += 1;
    return acc;
  }, [assets]);

  const sorted = useMemo(
    () =>
      [...(assets ?? [])].sort((a, b) => {
        const byStatus = worstRank(a) - worstRank(b);
        if (byStatus !== 0) return byStatus;
        return a.tag.localeCompare(b.tag);
      }),
    [assets],
  );

  const critical = useMemo(() => sorted.filter(assetIsCritical), [sorted]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">{t("dashboard.heading")}</h1>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("dashboard.filterSite")} htmlFor="filter-site">
          <Select id="filter-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{t("common.all")}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dashboard.filterCriticality")} htmlFor="filter-crit">
          <Select id="filter-crit" value={criticality} onChange={(e) => setCriticality(e.target.value)}>
            <option value="">{t("common.all")}</option>
            {CRITICALITY.map((c) => (
              <option key={c} value={c}>
                {t(`criticality.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SUMMARY.map((s) => (
          <div key={s.status} className={`rounded-xl border-2 p-4 ${s.tile}`}>
            <div className="text-3xl font-bold tnum">{counts[s.status]}</div>
            <div className="mt-1 text-sm font-medium">{t(s.labelKey)}</div>
          </div>
        ))}
      </div>

      {error !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700">{error}</p>
          <Button onClick={load}>{t("common.retry")}</Button>
        </div>
      ) : assets === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {t("dashboard.empty")}
        </p>
      ) : (
        <>
          {/* Pinned alert band — impossible to miss */}
          {critical.length > 0 && (
            <section
              className="rounded-xl border-2 border-overdue bg-overdue/10 p-4"
              role="alert"
              aria-label={t("dashboard.alertTitle")}
            >
              <h2 className="flex items-center gap-2 text-lg font-bold text-overdue">
                <span aria-hidden="true">⚠</span>
                {t("dashboard.alertTitle")}
              </h2>
              <ul className="mt-3 space-y-2">
                {critical.map((a) => {
                  const worst = a.duties.filter((d) => isCritical(a, d));
                  return (
                    <li key={a.id}>
                      <Link
                        to={`/assets/${a.id}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-3 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        <span className="tnum font-bold text-overdue">{a.tag}</span>
                        <span>{a.name}</span>
                        <CriticalityBadge criticality={a.criticality} />
                        <span className="flex flex-wrap gap-1">
                          {worst.map((d) => (
                            <StatusBadge key={d.assetDutyId} status={d.status} />
                          ))}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Main list — worst floats to top */}
          <ul className="space-y-4">
            {sorted.map((a) => (
              <li key={a.id}>
                <AssetCard asset={a} lang={lang} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AssetCard({ asset, lang }: { asset: AssetStatusView; lang: "ar" | "en" }): JSX.Element {
  const { t } = useI18n();
  const flagged = assetIsCritical(asset);
  return (
    <Link
      to={`/assets/${asset.id}`}
      className={`block rounded-xl border p-4 shadow-sm transition hover:shadow-md ${
        flagged ? "border-2 border-overdue" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`tnum font-bold ${flagged ? "text-overdue" : "text-slate-800"}`}>{asset.tag}</span>
        <span className="font-semibold text-slate-800">{asset.name}</span>
        <CriticalityBadge criticality={asset.criticality} />
        {asset.locationDetail !== null && asset.locationDetail !== "" && (
          <span className="text-sm text-slate-500">{asset.locationDetail}</span>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {asset.duties.map((d) => (
          <li
            key={d.assetDutyId}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg p-2 ${
              isCritical(asset, d) ? "bg-overdue/5" : ""
            }`}
          >
            <StatusBadge status={d.status} />
            <span className={`${isCritical(asset, d) ? "font-bold" : "font-medium"} text-slate-800`}>
              {lang === "ar" ? d.titleAr : d.titleEn}
            </span>
            <span className="text-sm text-slate-500">
              <AuthorityLabel authority={d.authority} />
            </span>
            {d.isStatutory && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                {t("asset.statutory")}
              </span>
            )}
            <span className="ms-auto flex flex-wrap items-center gap-x-3 text-sm text-slate-600">
              <span>
                <span className="text-slate-400">{t("dashboard.nextDue")}: </span>
                <DateLabel date={d.nextDueOn} />
              </span>
              <span>
                <span className="text-slate-400">{t("dashboard.lastDone")}: </span>
                <DateLabel date={d.lastCompletedOn} />
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

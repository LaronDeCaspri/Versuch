import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { AssetStatusView } from "../api/types.js";
import { DateLabel } from "../components/DateLabel.js";
import { RecordCapture } from "../components/RecordCapture.js";
import { AuthorityLabel, CriticalityBadge, StatusBadge } from "../components/StatusBadge.js";
import { Button, Spinner } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

export function AssetDetailPage(): JSX.Element {
  const { t, lang } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<AssetStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (id === undefined) return;
    setAsset(null);
    setError(null);
    let live = true;
    api
      .get<AssetStatusView>(`/assets/${id}`)
      .then((data) => {
        if (live) setAsset(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [id, t]);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
        <span aria-hidden="true">←</span>
        {t("common.back")}
      </Link>

      {error !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700">{error}</p>
          <Button onClick={load}>{t("common.retry")}</Button>
        </div>
      ) : asset === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tnum text-xl font-bold text-slate-800">{asset.tag}</span>
              <span className="text-xl font-semibold text-slate-800">{asset.name}</span>
              <CriticalityBadge criticality={asset.criticality} />
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail label={t("asset.type")} value={asset.assetType} />
              <Detail label={t("asset.location")} value={asset.locationDetail} />
              <div className="flex gap-2">
                <dt className="text-slate-500">{t("asset.commissioned")}:</dt>
                <dd className="text-slate-800">
                  <DateLabel date={asset.commissionedOn} />
                </dd>
              </div>
            </dl>
          </header>

          {/* Duties table */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">{t("asset.duties")}</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[48rem] border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-start text-slate-600">
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.status")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.duty")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.authority")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.reference")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.statutory")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("asset.interval")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("dashboard.nextDue")}</th>
                    <th className="px-3 py-2 text-start font-semibold">{t("dashboard.lastDone")}</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.duties.map((d) => (
                    <tr key={d.assetDutyId} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {lang === "ar" ? d.titleAr : d.titleEn}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        <AuthorityLabel authority={d.authority} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">{d.reference}</td>
                      <td className="px-3 py-2 text-slate-600">{d.isStatutory ? t("common.yes") : t("common.no")}</td>
                      <td className="px-3 py-2 text-slate-600">{t("asset.intervalDays", { days: d.intervalDays })}</td>
                      <td className="px-3 py-2 text-slate-600">
                        <DateLabel date={d.nextDueOn} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        <DateLabel date={d.lastCompletedOn} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <RecordCapture asset={asset} onSynced={load} />
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

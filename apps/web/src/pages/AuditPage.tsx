import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { AuditEntry } from "../api/types.js";
import { useAuth } from "../auth/AuthContext.js";
import { Button, Spinner } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

const AUDIT_LIMIT = 200;

export function AuditPage(): JSX.Element {
  const { t, lang } = useI18n();
  const { user } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short" }),
    [lang],
  );

  const load = useCallback(() => {
    setEntries(null);
    setError(null);
    let live = true;
    api
      .get<AuditEntry[]>(`/audit?limit=${AUDIT_LIMIT}`)
      .then((data) => {
        if (live) setEntries([...data].sort((a, b) => (a.at < b.at ? 1 : -1)));
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  if (user !== null && user.role !== "OWNER" && user.role !== "MANAGER") return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">{t("audit.heading")}</h1>

      {error !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700" role="alert">
            {error}
          </p>
          <Button onClick={load}>{t("common.retry")}</Button>
        </div>
      ) : entries === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {t("audit.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[44rem] border-collapse text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-3 py-2 text-start font-semibold">{t("audit.time")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("audit.user")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("audit.action")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("audit.entityType")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("audit.entityId")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 tnum text-slate-700">{formatter.format(new Date(entry.at))}</td>
                  <td className="px-3 py-2 text-slate-800">{entry.userName ?? t("audit.system")}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{entry.action}</td>
                  <td className="px-3 py-2 text-slate-600">{entry.entityType}</td>
                  <td className="px-3 py-2 tnum text-slate-500">{entry.entityId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

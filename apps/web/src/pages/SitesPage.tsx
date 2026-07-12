import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { Site } from "../api/types.js";
import { useAuth } from "../auth/AuthContext.js";
import { Button, Field, Spinner, TextInput } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

export function SitesPage(): JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "OWNER" || user?.role === "MANAGER";

  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setSites(null);
    setError(null);
    let live = true;
    api
      .get<Site[]>("/sites")
      .then((data) => {
        if (live) setSites(data);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{t("sites.heading")}</h1>
        {canManage && !adding && (
          <Button type="button" onClick={() => setAdding(true)} className="min-h-[44px]">
            {t("sites.add")}
          </Button>
        )}
      </div>

      {canManage && adding && (
        <SiteForm
          onCreated={() => {
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {error !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700" role="alert">
            {error}
          </p>
          <Button onClick={load}>{t("common.retry")}</Button>
        </div>
      ) : sites === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : sites.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {t("sites.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sites/${s.id}`}
                className="block h-full rounded-xl border border-slate-200 p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <h2 className="font-semibold text-slate-800">{s.name}</h2>
                <dl className="mt-2 space-y-1 text-sm text-slate-600">
                  <div className="flex gap-2">
                    <dt className="text-slate-400">{t("site.client")}:</dt>
                    <dd>{s.client}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-400">{t("site.address")}:</dt>
                    <dd>{s.address}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-slate-400">{t("site.responsible")}:</dt>
                    <dd>{s.responsiblePerson}</dd>
                  </div>
                </dl>
                <span className="mt-3 inline-block text-sm font-medium text-blue-600">{t("sites.view")} →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SiteForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [client, setClient] = useState("");
  const [responsiblePerson, setResponsiblePerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/sites", {
        name: name.trim(),
        address: address.trim(),
        client: client.trim(),
        responsiblePerson: responsiblePerson.trim(),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <h2 className="font-semibold text-slate-800">{t("sites.newHeading")}</h2>
      <Field label={t("site.name")} htmlFor="site-name">
        <TextInput id="site-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={t("site.address")} htmlFor="site-address">
        <TextInput id="site-address" value={address} onChange={(e) => setAddress(e.target.value)} required />
      </Field>
      <Field label={t("site.client")} htmlFor="site-client">
        <TextInput id="site-client" value={client} onChange={(e) => setClient(e.target.value)} required />
      </Field>
      <Field label={t("site.responsible")} htmlFor="site-responsible">
        <TextInput
          id="site-responsible"
          value={responsiblePerson}
          onChange={(e) => setResponsiblePerson(e.target.value)}
          required
        />
      </Field>

      {error !== null && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
          {t("common.create")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] w-full border border-slate-300 sm:w-auto"
        >
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

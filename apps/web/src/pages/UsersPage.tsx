import { ROLE, type Role } from "@cmp/core";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../api/client.js";
import type { Site, UserView } from "../api/types.js";
import { useAuth } from "../auth/AuthContext.js";
import { Button, Field, Select, Spinner, TextInput } from "../components/ui.js";
import { useI18n } from "../i18n/index.js";

function RoleBadge({ role }: { role: Role }): JSX.Element {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
      {t(`role.${role}`)}
    </span>
  );
}

export function UsersPage(): JSX.Element {
  const { t } = useI18n();
  const { user } = useAuth();

  const [users, setUsers] = useState<UserView[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setUsers(null);
    setError(null);
    let live = true;
    Promise.all([api.get<UserView[]>("/users"), api.get<Site[]>("/sites")])
      .then(([u, s]) => {
        if (!live) return;
        setUsers(u);
        setSites(s);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof ApiError ? e.message : t("common.error"));
      });
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => load(), [load]);

  if (user !== null && user.role !== "OWNER") return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">{t("users.heading")}</h1>
        {!creating && (
          <Button type="button" onClick={() => setCreating(true)} className="min-h-[44px]">
            {t("users.create")}
          </Button>
        )}
      </div>

      {creating && (
        <CreateUserForm
          sites={sites}
          onCreated={() => {
            setCreating(false);
            load();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error !== null ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 p-6">
          <p className="text-slate-700" role="alert">
            {error}
          </p>
          <Button onClick={load}>{t("common.retry")}</Button>
        </div>
      ) : users === null ? (
        <div className="flex items-center gap-3 p-6">
          <Spinner />
          <span className="text-slate-600">{t("common.loading")}</span>
        </div>
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          {t("users.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {users.map((u) => (
            <li key={u.id}>
              <UserRow user={u} sites={sites} onUpdated={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function siteNames(sites: Site[], siteIds: string[]): string[] {
  return siteIds.map((sid) => sites.find((s) => s.id === sid)?.name ?? sid);
}

function UserRow({ user, sites, onUpdated }: { user: UserView; sites: Site[]; onUpdated: () => void }): JSX.Element {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const names = siteNames(sites, user.siteIds);

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-semibold text-slate-800">{user.name}</span>
        <span className="text-sm text-slate-500">{user.email}</span>
        <RoleBadge role={user.role} />
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            user.active ? "bg-ok text-white" : "bg-slate-400 text-white"
          }`}
        >
          {user.active ? t("users.active") : t("users.inactive")}
        </span>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="ms-auto min-h-[44px] border border-slate-300 text-sm"
          >
            {t("common.edit")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="text-slate-400">{t("users.sites")}:</span>
        {names.length === 0 ? (
          <span>{t("common.none")}</span>
        ) : (
          names.map((name, i) => (
            <span key={user.siteIds[i] ?? name} className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
              {name}
            </span>
          ))
        )}
      </div>

      {editing && (
        <EditUserForm user={user} sites={sites} onSaved={onUpdated} onCancel={() => setEditing(false)} />
      )}
    </article>
  );
}

function SiteCheckboxes({
  sites,
  selected,
  onToggle,
  idPrefix,
}: {
  sites: Site[];
  selected: string[];
  onToggle: (siteId: string, checked: boolean) => void;
  idPrefix: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-300 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{t("users.sites")}</legend>
      {sites.length === 0 ? (
        <p className="text-sm text-slate-400">{t("common.none")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {sites.map((s) => {
            const cbId = `${idPrefix}-site-${s.id}`;
            return (
              <label key={s.id} htmlFor={cbId} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  id={cbId}
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) => onToggle(s.id, e.target.checked)}
                  className="h-4 w-4"
                />
                <span>{s.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function CreateUserForm({
  sites,
  onCreated,
  onCancel,
}: {
  sites: Site[];
  onCreated: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(siteId: string, checked: boolean): void {
    setSiteIds((prev) => (checked ? [...prev, siteId] : prev.filter((id) => id !== siteId)));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (role === "") {
      setError(t("common.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/users", { email: email.trim(), name: name.trim(), password, role, siteIds });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-4">
      <h2 className="text-lg font-bold text-slate-800">{t("users.newHeading")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("users.email")} htmlFor="new-user-email">
          <TextInput
            id="new-user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label={t("users.name")} htmlFor="new-user-name">
          <TextInput id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t("users.password")} htmlFor="new-user-password">
          <TextInput
            id="new-user-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field label={t("users.role")} htmlFor="new-user-role">
          <Select id="new-user-role" value={role} onChange={(e) => setRole(e.target.value as Role | "")} required>
            <option value="" disabled>
              {t("users.roleSelect")}
            </option>
            {ROLE.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <SiteCheckboxes sites={sites} selected={siteIds} onToggle={toggle} idPrefix="new-user" />

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

function EditUserForm({
  user,
  sites,
  onSaved,
  onCancel,
}: {
  user: UserView;
  sites: Site[];
  onSaved: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [siteIds, setSiteIds] = useState<string[]>(user.siteIds);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(siteId: string, checked: boolean): void {
    setSiteIds((prev) => (checked ? [...prev, siteId] : prev.filter((id) => id !== siteId)));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/users/${user.id}`, { name: name.trim(), role, active, siteIds });
      setNotice(t("users.updated"));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("users.name")} htmlFor={`edit-${user.id}-name`}>
          <TextInput id={`edit-${user.id}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t("users.role")} htmlFor={`edit-${user.id}-role`}>
          <Select
            id={`edit-${user.id}-role`}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            required
          >
            {ROLE.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <label htmlFor={`edit-${user.id}-active`} className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          id={`edit-${user.id}-active`}
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4"
        />
        <span>{active ? t("users.active") : t("users.inactive")}</span>
      </label>

      <SiteCheckboxes sites={sites} selected={siteIds} onToggle={toggle} idPrefix={`edit-${user.id}`} />

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

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy} className="min-h-[44px] w-full sm:w-auto">
          {t("common.save")}
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

import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { ApiError } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import { Button, Field, TextInput } from "../components/ui.js";

export function LoginPage(): JSX.Element {
  const { t, toggleLang } = useI18n();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("login.error") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{t("login.heading")}</h1>
          <Button type="button" variant="ghost" onClick={toggleLang} className="text-sm">
            {t("nav.language")}
          </Button>
        </div>
        <Field label={t("login.email")} htmlFor="email">
          <TextInput id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label={t("login.password")} htmlFor="password">
          <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error !== null && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t("login.submit")}
        </Button>
      </form>
    </div>
  );
}

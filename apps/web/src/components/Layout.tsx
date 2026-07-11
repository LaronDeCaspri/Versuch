import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useI18n, type MessageKey } from "../i18n/index.js";
import { useOutbox } from "../offline/useOutbox.js";
import { Button } from "./ui.js";

const NAV: { to: string; key: MessageKey; roles?: string[] }[] = [
  { to: "/", key: "nav.dashboard" },
  { to: "/sites", key: "nav.sites" },
  { to: "/users", key: "nav.users", roles: ["OWNER"] },
  { to: "/audit", key: "nav.audit", roles: ["OWNER", "MANAGER"] },
];

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  const { t, toggleLang } = useI18n();
  const { user, logout } = useAuth();
  const { pending } = useOutbox();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <span className="text-lg font-bold text-blue-700">{t("app.title")}</span>
          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.filter((n) => n.roles === undefined || (user !== null && n.roles.includes(user.role))).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"}`
                }
              >
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          {pending > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white"
              role="status"
              aria-live="polite"
              title={t("offline.indicator")}
            >
              <span aria-hidden="true">↻</span>
              {t("offline.pendingCount", { count: pending })}
            </span>
          )}
          <Button variant="ghost" onClick={toggleLang} className="text-sm">
            {t("nav.language")}
          </Button>
          {user !== null && (
            <Button variant="ghost" onClick={() => void logout()} className="text-sm">
              {t("nav.logout")}
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

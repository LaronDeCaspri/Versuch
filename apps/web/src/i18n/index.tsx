import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ar } from "./ar.js";
import { en } from "./en.js";

export type MessageKey = keyof typeof ar;
export type Lang = "ar" | "en";

const CATALOGUES: Record<Lang, Record<MessageKey, string>> = { ar, en };
const STORAGE_KEY = "cmp_lang";

interface I18nValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return stored === "en" ? "en" : "ar";
  });

  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir,
      t: (key, vars) => interpolate(CATALOGUES[lang][key], vars),
      setLang,
      toggleLang: () => setLang(lang === "ar" ? "en" : "ar"),
    }),
    [lang, dir, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

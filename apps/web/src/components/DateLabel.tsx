import { asIsoDate, toHijri, type IsoDate } from "@cmp/core";
import { useI18n } from "../i18n/index.js";

/** Gregorian is canonical; Hijri (Um al-Qura) is shown alongside in a muted tone. */
export function DateLabel({ date }: { date: IsoDate | null }): JSX.Element {
  const { lang } = useI18n();
  if (date === null) return <span className="text-slate-400">—</span>;
  const iso = asIsoDate(date);
  return (
    <span className="tnum">
      {iso} <span className="text-xs text-slate-400">({toHijri(iso, lang === "ar" ? "ar-SA" : "en")})</span>
    </span>
  );
}
